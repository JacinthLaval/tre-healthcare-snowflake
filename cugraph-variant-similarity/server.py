import os
import json
import logging
from typing import Optional

import cudf
import cugraph
import cupy as cp
import numpy as np
import pandas as pd
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("cugraph-variant-similarity")

app = FastAPI(title="Pharmacogenomic Variant Similarity — cuGraph", version="1.0.0")
app.add_middleware(CORSMiddleware, allow_origins=["*"], allow_methods=["*"], allow_headers=["*"])

GRAPH_CACHE = {}


def get_snowflake_connection():
    import snowflake.connector
    token_path = os.environ.get("SNOWFLAKE_TOKEN_PATH", "/snowflake/session/token")
    is_spcs = os.path.exists(token_path)

    if is_spcs:
        token = open(token_path).read().strip()
        logger.info("Using SPCS OAuth authentication")
        params = {
            "host": os.environ.get("SNOWFLAKE_HOST", "sfsehol-si_industry_demos_healthcare_lmszks.snowflakecomputing.com"),
            "account": os.environ.get("SNOWFLAKE_ACCOUNT", "sfsehol-si_industry_demos_healthcare_lmszks"),
            "authenticator": "oauth",
            "token": token,
            "database": "HEALTHCARE_DATABASE",
            "schema": "DEFAULT_SCHEMA",
            "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", "SI_DEMO_WH"),
        }
    else:
        logger.info("Using PAT authentication (local dev)")
        token_file = os.environ.get("SNOWFLAKE_TOKEN_FILE",
                                     os.path.join(os.environ.get("HOME", "/root"), ".snowflake", "tokens", "HealthcareDemos_token"))
        params = {
            "account": os.environ.get("SNOWFLAKE_ACCOUNT", "sfsehol-si_industry_demos_healthcare_lmszks"),
            "user": os.environ.get("SNOWFLAKE_USER", "USER"),
            "authenticator": "PROGRAMMATIC_ACCESS_TOKEN",
            "token": open(token_file).read().strip(),
            "database": "HEALTHCARE_DATABASE",
            "schema": "DEFAULT_SCHEMA",
            "warehouse": os.environ.get("SNOWFLAKE_WAREHOUSE", "SI_DEMO_WH"),
        }

    return snowflake.connector.connect(**params)


def load_pgx_data():
    logger.info("Loading PGx profiles from Snowflake...")
    conn = get_snowflake_connection()
    cur = conn.cursor()
    cur.execute("""
        SELECT SAMPLE_ID, PATIENT_ID, PATIENT_NAME, POPULATION, SUPERPOPULATION,
               RACE, ETHNICITY, CITY, STATE,
               GENE, VARIANT_NAME, ZYGOSITY, ALT_ALLELE_COUNT
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_PGX_PROFILES
    """)
    columns = [desc[0] for desc in cur.description]
    rows = cur.fetchall()
    cur.close()
    conn.close()
    df = pd.DataFrame(rows, columns=columns)
    logger.info(f"Loaded {len(df)} rows for {df['SAMPLE_ID'].nunique()} patients")
    return df


def build_variant_vectors(pdf):
    variants = sorted(pdf[['GENE', 'VARIANT_NAME']].drop_duplicates().apply(
        lambda r: f"{r['GENE']}:{r['VARIANT_NAME']}", axis=1).tolist())
    variant_idx = {v: i for i, v in enumerate(variants)}

    samples = sorted(pdf['SAMPLE_ID'].unique())
    sample_idx = {s: i for i, s in enumerate(samples)}

    matrix = np.zeros((len(samples), len(variants)), dtype=np.int8)
    for _, row in pdf.iterrows():
        si = sample_idx[row['SAMPLE_ID']]
        vi = variant_idx[f"{row['GENE']}:{row['VARIANT_NAME']}"]
        matrix[si, vi] = row['ALT_ALLELE_COUNT']

    return matrix, samples, variants, sample_idx


def build_similarity_graph(matrix, samples, threshold=0.3):
    logger.info(f"Building similarity graph for {len(samples)} patients on GPU...")
    n = len(samples)
    mat_gpu = cp.asarray(matrix, dtype=cp.float32)

    binary = (mat_gpu > 0).astype(cp.float32)
    intersection = binary @ binary.T
    row_sums = binary.sum(axis=1).reshape(-1, 1)
    union = row_sums + row_sums.T - intersection
    union = cp.maximum(union, 1e-10)
    jaccard = intersection / union
    cp.fill_diagonal(jaccard, 0)

    jaccard_cpu = cp.asnumpy(jaccard)
    src_list, dst_list, weight_list = [], [], []
    for i in range(n):
        for j in range(i + 1, n):
            w = jaccard_cpu[i, j]
            if w >= threshold:
                src_list.append(i)
                dst_list.append(j)
                weight_list.append(float(w))

    logger.info(f"Graph: {n} nodes, {len(src_list)} edges (threshold={threshold})")

    edge_df = cudf.DataFrame({
        "src": src_list,
        "dst": dst_list,
        "weight": weight_list
    })

    G = cugraph.Graph()
    G.from_cudf_edgelist(edge_df, source="src", destination="dst", edge_attr="weight")
    return G, edge_df


def run_louvain(G):
    logger.info("Running Louvain community detection...")
    parts, modularity = cugraph.louvain(G)
    logger.info(f"Louvain modularity: {modularity:.4f}, communities: {parts['partition'].nunique()}")
    return parts.to_pandas(), modularity


def run_pagerank(G, top_n=20):
    logger.info("Running PageRank...")
    pr = cugraph.pagerank(G)
    pr_pdf = pr.to_pandas().sort_values("pagerank", ascending=False).head(top_n)
    return pr_pdf


def compute_layout(G, edge_df, n_nodes):
    logger.info(f"Computing force-directed layout for {n_nodes} nodes...")
    try:
        pos = cugraph.force_atlas2(G, max_iter=500, scaling_ratio=5.0, gravity=1.0)
        pos_pdf = pos.to_pandas().sort_values('vertex').reset_index(drop=True)
        xs = pos_pdf['x'].values.astype(float)
        ys = pos_pdf['y'].values.astype(float)
    except Exception as e:
        logger.warning(f"force_atlas2 failed ({e}), using spectral fallback")
        np.random.seed(42)
        xs = np.random.randn(n_nodes).astype(float)
        ys = np.random.randn(n_nodes).astype(float)

    x_min, x_max = xs.min(), xs.max()
    y_min, y_max = ys.min(), ys.max()
    x_range = max(x_max - x_min, 1e-6)
    y_range = max(y_max - y_min, 1e-6)
    xs = (xs - x_min) / x_range
    ys = (ys - y_min) / y_range

    logger.info("Layout computed and normalized to [0,1]")
    return {"x": xs.tolist(), "y": ys.tolist()}


@app.on_event("startup")
async def startup():
    logger.info("Starting cuGraph Variant Similarity service...")
    try:
        pdf = load_pgx_data()
        matrix, samples, variants, sample_idx = build_variant_vectors(pdf)

        patient_meta = pdf.drop_duplicates(subset=['SAMPLE_ID'])[[
            'SAMPLE_ID', 'PATIENT_ID', 'PATIENT_NAME', 'POPULATION',
            'SUPERPOPULATION', 'RACE', 'ETHNICITY', 'CITY', 'STATE'
        ]].set_index('SAMPLE_ID')

        G, edge_df = build_similarity_graph(matrix, samples, threshold=0.2)
        louvain_parts, modularity = run_louvain(G)
        pagerank_df = run_pagerank(G, top_n=50)

        GRAPH_CACHE['pdf'] = pdf
        GRAPH_CACHE['matrix'] = matrix
        GRAPH_CACHE['samples'] = samples
        GRAPH_CACHE['variants'] = variants
        GRAPH_CACHE['sample_idx'] = sample_idx
        GRAPH_CACHE['patient_meta'] = patient_meta
        GRAPH_CACHE['G'] = G
        GRAPH_CACHE['edge_df'] = edge_df
        GRAPH_CACHE['louvain'] = louvain_parts
        GRAPH_CACHE['modularity'] = modularity
        GRAPH_CACHE['pagerank'] = pagerank_df

        layout_pos = compute_layout(G, edge_df, len(samples))
        GRAPH_CACHE['layout'] = layout_pos
        logger.info("Startup complete — graph cached.")
    except Exception as e:
        logger.error(f"Startup failed: {e}", exc_info=True)


@app.api_route("/health", methods=["GET", "POST"])
async def health():
    ready = 'G' in GRAPH_CACHE
    return {
        "status": "ready" if ready else "loading",
        "patients": len(GRAPH_CACHE.get('samples', [])),
        "variants": len(GRAPH_CACHE.get('variants', [])),
        "edges": len(GRAPH_CACHE.get('edge_df', [])),
    }


@app.api_route("/api/graph/summary", methods=["GET", "POST"])
async def graph_summary():
    if 'G' not in GRAPH_CACHE:
        raise HTTPException(503, "Graph not ready")
    louvain = GRAPH_CACHE['louvain']
    community_counts = louvain['partition'].value_counts().to_dict()
    return {
        "patients": len(GRAPH_CACHE['samples']),
        "variants": GRAPH_CACHE['variants'],
        "edges": len(GRAPH_CACHE['edge_df']),
        "modularity": round(GRAPH_CACHE['modularity'], 4),
        "communities": len(community_counts),
        "community_sizes": {str(k): int(v) for k, v in sorted(community_counts.items())},
    }


@app.api_route("/api/graph/communities", methods=["GET", "POST"])
async def communities(limit: int = Query(default=500)):
    if 'louvain' not in GRAPH_CACHE:
        raise HTTPException(503, "Graph not ready")

    louvain = GRAPH_CACHE['louvain']
    meta = GRAPH_CACHE['patient_meta']
    samples = GRAPH_CACHE['samples']

    results = []
    for _, row in louvain.iterrows():
        idx = int(row['vertex'])
        if idx >= len(samples):
            continue
        sample_id = samples[idx]
        m = meta.loc[sample_id] if sample_id in meta.index else {}
        results.append({
            "vertex": idx,
            "sample_id": sample_id,
            "community": int(row['partition']),
            "patient_id": int(m.get('PATIENT_ID', 0)) if isinstance(m, pd.Series) else 0,
            "patient_name": str(m.get('PATIENT_NAME', '')) if isinstance(m, pd.Series) else '',
            "superpopulation": str(m.get('SUPERPOPULATION', '')) if isinstance(m, pd.Series) else '',
            "population": str(m.get('POPULATION', '')) if isinstance(m, pd.Series) else '',
        })
        if len(results) >= limit:
            break

    return results


@app.api_route("/api/graph/pagerank", methods=["GET", "POST"])
async def pagerank(top_n: int = Query(default=20)):
    if 'pagerank' not in GRAPH_CACHE:
        raise HTTPException(503, "Graph not ready")

    pr = GRAPH_CACHE['pagerank'].head(top_n)
    meta = GRAPH_CACHE['patient_meta']
    samples = GRAPH_CACHE['samples']

    results = []
    for _, row in pr.iterrows():
        idx = int(row['vertex'])
        if idx >= len(samples):
            continue
        sample_id = samples[idx]
        m = meta.loc[sample_id] if sample_id in meta.index else {}
        results.append({
            "vertex": idx,
            "sample_id": sample_id,
            "pagerank": round(float(row['pagerank']), 6),
            "patient_name": str(m.get('PATIENT_NAME', '')) if isinstance(m, pd.Series) else '',
            "superpopulation": str(m.get('SUPERPOPULATION', '')) if isinstance(m, pd.Series) else '',
        })
    return results


@app.api_route("/api/graph/edges", methods=["GET", "POST"])
async def edges(limit: int = Query(default=1000)):
    if 'edge_df' not in GRAPH_CACHE:
        raise HTTPException(503, "Graph not ready")

    edf = GRAPH_CACHE['edge_df'].to_pandas().head(limit)
    samples = GRAPH_CACHE['samples']
    return [{
        "src": int(r['src']),
        "dst": int(r['dst']),
        "src_sample": samples[int(r['src'])] if int(r['src']) < len(samples) else '',
        "dst_sample": samples[int(r['dst'])] if int(r['dst']) < len(samples) else '',
        "weight": round(float(r['weight']), 4),
    } for _, r in edf.iterrows()]


@app.api_route("/api/patient/{sample_id}/similar", methods=["GET", "POST"])
async def patient_similar(sample_id: str, top_n: int = Query(default=10)):
    if 'matrix' not in GRAPH_CACHE:
        raise HTTPException(503, "Graph not ready")

    sample_idx = GRAPH_CACHE['sample_idx']
    if sample_id not in sample_idx:
        raise HTTPException(404, f"Sample {sample_id} not found")

    idx = sample_idx[sample_id]
    matrix = GRAPH_CACHE['matrix']
    variants = GRAPH_CACHE['variants']
    samples = GRAPH_CACHE['samples']
    meta = GRAPH_CACHE['patient_meta']

    query_vec = (matrix[idx] > 0).astype(np.float32)
    all_binary = (matrix > 0).astype(np.float32)

    intersection = np.dot(all_binary, query_vec)
    query_sum = query_vec.sum()
    row_sums = all_binary.sum(axis=1)
    union = row_sums + query_sum - intersection
    union = np.maximum(union, 1e-10)
    jaccard = intersection / union
    jaccard[idx] = -1

    top_indices = np.argsort(jaccard)[::-1][:top_n]

    query_variants = [variants[i] for i in range(len(variants)) if matrix[idx][i] > 0]

    results = []
    for ti in top_indices:
        sid = samples[ti]
        m = meta.loc[sid] if sid in meta.index else {}
        shared = [variants[i] for i in range(len(variants))
                  if matrix[idx][i] > 0 and matrix[ti][i] > 0]
        results.append({
            "sample_id": sid,
            "similarity": round(float(jaccard[ti]), 4),
            "patient_name": str(m.get('PATIENT_NAME', '')) if isinstance(m, pd.Series) else '',
            "superpopulation": str(m.get('SUPERPOPULATION', '')) if isinstance(m, pd.Series) else '',
            "population": str(m.get('POPULATION', '')) if isinstance(m, pd.Series) else '',
            "shared_variants": shared,
            "shared_count": len(shared),
        })

    return {
        "query_sample": sample_id,
        "query_variants": query_variants,
        "similar_patients": results,
    }


@app.api_route("/api/community/{community_id}/profile", methods=["GET", "POST"])
async def community_profile(community_id: int):
    if 'louvain' not in GRAPH_CACHE:
        raise HTTPException(503, "Graph not ready")

    louvain = GRAPH_CACHE['louvain']
    members = louvain[louvain['partition'] == community_id]['vertex'].tolist()
    if not members:
        raise HTTPException(404, f"Community {community_id} not found")

    matrix = GRAPH_CACHE['matrix']
    variants = GRAPH_CACHE['variants']
    samples = GRAPH_CACHE['samples']
    meta = GRAPH_CACHE['patient_meta']

    member_indices = [int(m) for m in members if int(m) < len(samples)]
    member_matrix = matrix[member_indices]

    variant_freq = {}
    for vi, vname in enumerate(variants):
        carriers = int((member_matrix[:, vi] > 0).sum())
        variant_freq[vname] = {
            "carriers": carriers,
            "total": len(member_indices),
            "frequency": round(carriers / max(len(member_indices), 1), 3),
        }

    pop_dist = {}
    for mi in member_indices:
        sid = samples[mi]
        if sid in meta.index:
            sp = str(meta.loc[sid].get('SUPERPOPULATION', 'Unknown'))
            pop_dist[sp] = pop_dist.get(sp, 0) + 1

    return {
        "community_id": community_id,
        "size": len(member_indices),
        "variant_frequencies": variant_freq,
        "superpopulation_distribution": pop_dist,
    }


from pydantic import BaseModel
from fastapi import Request


@app.post("/api/service/similar")
async def service_similar(request: Request):
    body = await request.json()
    rows = body.get("data", [])
    results = []
    for row in rows:
        row_idx = row[0]
        sample_id = str(row[1])
        top_n = int(row[2]) if len(row) > 2 else 10

        if 'matrix' not in GRAPH_CACHE:
            results.append([row_idx, json.dumps({"error": "Graph not ready"})])
            continue

        sample_idx = GRAPH_CACHE['sample_idx']
        if sample_id not in sample_idx:
            results.append([row_idx, json.dumps({"error": f"Sample {sample_id} not found"})])
            continue

        idx = sample_idx[sample_id]
        matrix = GRAPH_CACHE['matrix']
        variants = GRAPH_CACHE['variants']
        samples = GRAPH_CACHE['samples']
        meta = GRAPH_CACHE['patient_meta']
        louvain = GRAPH_CACHE['louvain']

        query_vec = (matrix[idx] > 0).astype(np.float32)
        all_binary = (matrix > 0).astype(np.float32)
        intersection = np.dot(all_binary, query_vec)
        query_sum = query_vec.sum()
        row_sums = all_binary.sum(axis=1)
        union = row_sums + query_sum - intersection
        union = np.maximum(union, 1e-10)
        jaccard = intersection / union
        jaccard[idx] = -1

        top_indices = np.argsort(jaccard)[::-1][:top_n]
        query_variants = [variants[i] for i in range(len(variants)) if matrix[idx][i] > 0]

        patient_community = None
        patient_row = louvain[louvain['vertex'] == idx]
        if len(patient_row) > 0:
            patient_community = int(patient_row.iloc[0]['partition'])

        similar = []
        for ti in top_indices:
            sid = samples[ti]
            m = meta.loc[sid] if sid in meta.index else {}
            shared = [variants[i] for i in range(len(variants))
                      if matrix[idx][i] > 0 and matrix[ti][i] > 0]
            ti_community = None
            ti_row = louvain[louvain['vertex'] == ti]
            if len(ti_row) > 0:
                ti_community = int(ti_row.iloc[0]['partition'])
            similar.append({
                "sample_id": sid,
                "similarity": round(float(jaccard[ti]), 4),
                "patient_name": str(m.get('PATIENT_NAME', '')) if isinstance(m, pd.Series) else '',
                "superpopulation": str(m.get('SUPERPOPULATION', '')) if isinstance(m, pd.Series) else '',
                "population": str(m.get('POPULATION', '')) if isinstance(m, pd.Series) else '',
                "shared_variants": shared,
                "shared_count": len(shared),
                "community_id": ti_community,
            })

        result = {
            "query_sample": sample_id,
            "query_variants": query_variants,
            "community_id": patient_community,
            "similar_patients": similar,
            "backend": "cugraph_gpu",
            "graph_stats": {
                "total_patients": len(samples),
                "total_edges": len(GRAPH_CACHE['edge_df']),
                "communities": int(GRAPH_CACHE['louvain']['partition'].nunique()),
                "modularity": round(GRAPH_CACHE['modularity'], 4),
            }
        }
        results.append([row_idx, json.dumps(result)])

    return {"data": results}


@app.api_route("/api/graph/layout", methods=["GET", "POST"])
async def graph_layout(max_edges: int = Query(default=5000)):
    if 'layout' not in GRAPH_CACHE:
        raise HTTPException(503, "Layout not ready")

    layout = GRAPH_CACHE['layout']
    samples = GRAPH_CACHE['samples']
    louvain = GRAPH_CACHE['louvain']
    meta = GRAPH_CACHE['patient_meta']
    edge_df = GRAPH_CACHE['edge_df']

    community_map = {}
    for _, row in louvain.iterrows():
        community_map[int(row['vertex'])] = int(row['partition'])

    nodes = []
    for i, sid in enumerate(samples):
        m = meta.loc[sid] if sid in meta.index else {}
        nodes.append({
            "i": i,
            "x": round(layout['x'][i], 5),
            "y": round(layout['y'][i], 5),
            "c": community_map.get(i, -1),
            "s": sid,
            "n": str(m.get('PATIENT_NAME', '')) if isinstance(m, pd.Series) else '',
            "p": str(m.get('SUPERPOPULATION', '')) if isinstance(m, pd.Series) else '',
        })

    edf = edge_df.to_pandas().nlargest(max_edges, 'weight')
    edges = [[int(r['src']), int(r['dst']), round(float(r['weight']), 3)] for _, r in edf.iterrows()]

    community_sizes = louvain['partition'].value_counts().to_dict()

    return {
        "nodes": nodes,
        "edges": edges,
        "communities": len(community_sizes),
        "community_sizes": {str(k): int(v) for k, v in sorted(community_sizes.items())},
        "modularity": round(GRAPH_CACHE['modularity'], 4),
    }


@app.post("/api/service/graph_layout")
async def service_graph_layout(request: Request):
    body = await request.json()
    rows = body.get("data", [])
    results = []
    for row in rows:
        row_idx = row[0]
        max_edges = int(row[1]) if len(row) > 1 else 5000

        if 'layout' not in GRAPH_CACHE:
            results.append([row_idx, json.dumps({"error": "Layout not ready"})])
            continue

        layout = GRAPH_CACHE['layout']
        samples = GRAPH_CACHE['samples']
        louvain = GRAPH_CACHE['louvain']
        meta = GRAPH_CACHE['patient_meta']
        edge_df = GRAPH_CACHE['edge_df']

        community_map = {}
        for _, row_l in louvain.iterrows():
            community_map[int(row_l['vertex'])] = int(row_l['partition'])

        nodes = []
        for i, sid in enumerate(samples):
            m = meta.loc[sid] if sid in meta.index else {}
            nodes.append([
                round(layout['x'][i], 4),
                round(layout['y'][i], 4),
                community_map.get(i, -1),
                sid,
                str(m.get('PATIENT_NAME', '')) if isinstance(m, pd.Series) else '',
                str(m.get('SUPERPOPULATION', '')) if isinstance(m, pd.Series) else '',
            ])

        edf = edge_df.to_pandas().nlargest(max_edges, 'weight')
        edges = [[int(r['src']), int(r['dst']), round(float(r['weight']), 3)] for _, r in edf.iterrows()]

        community_sizes = louvain['partition'].value_counts().to_dict()

        result = {
            "nodes": nodes,
            "edges": edges,
            "communities": len(community_sizes),
            "community_sizes": {str(k): int(v) for k, v in sorted(community_sizes.items())},
            "modularity": round(GRAPH_CACHE['modularity'], 4),
            "backend": "cugraph_gpu",
        }
        results.append([row_idx, json.dumps(result)])

    return {"data": results}


@app.post("/api/service/community_profile")
async def service_community_profile(request: Request):
    body = await request.json()
    rows = body.get("data", [])
    results = []
    for row in rows:
        row_idx = row[0]
        cid = int(row[1])

        if 'louvain' not in GRAPH_CACHE:
            results.append([row_idx, json.dumps({"error": "Graph not ready"})])
            continue

        louvain = GRAPH_CACHE['louvain']
        members = louvain[louvain['partition'] == cid]['vertex'].tolist()
        if not members:
            results.append([row_idx, json.dumps({"error": f"Community {cid} not found"})])
            continue

        matrix = GRAPH_CACHE['matrix']
        variants = GRAPH_CACHE['variants']
        samples = GRAPH_CACHE['samples']
        meta = GRAPH_CACHE['patient_meta']

        member_indices = [int(m) for m in members if int(m) < len(samples)]
        member_matrix = matrix[member_indices]

        variant_freq = {}
        for vi, vname in enumerate(variants):
            carriers = int((member_matrix[:, vi] > 0).sum())
            variant_freq[vname] = {
                "carriers": carriers,
                "total": len(member_indices),
                "frequency": round(carriers / max(len(member_indices), 1), 3),
            }

        pop_dist = {}
        for mi in member_indices:
            sid = samples[mi]
            if sid in meta.index:
                sp = str(meta.loc[sid].get('SUPERPOPULATION', 'Unknown'))
                pop_dist[sp] = pop_dist.get(sp, 0) + 1

        result = {
            "community_id": cid,
            "size": len(member_indices),
            "variant_frequencies": variant_freq,
            "superpopulation_distribution": pop_dist,
            "backend": "cugraph_gpu",
        }
        results.append([row_idx, json.dumps(result)])

    return {"data": results}
