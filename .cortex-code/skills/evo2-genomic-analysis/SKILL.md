---
name: evo2-genomic-analysis
description: "Genomic variant analysis using Evo2 foundation model on SPCS. Use for: variant effect prediction, sequence scoring, embedding-based variant clustering, novel variant screening, VUS classification, pharmacogenomics, any gene variant analysis. Triggers: evo2, variant effect, sequence score, genomic embeddings, variant screening, VUS, pharmacogenomics, gene variant, functional impact."
---

# Evo2 Genomic Analysis

Evo2 is a 7B-parameter genomic foundation model running on Snowpark Container Services (SPCS). It scores DNA sequences, predicts variant effects, generates embeddings, and screens novel variants for any gene.

## Prerequisites

- Evo2 SPCS service running: `HEALTHCARE_DATABASE.DEFAULT_SCHEMA.EVO2_SERVICE`
- Compute pool: `EVO2_COMPUTE_POOL` (GPU_NV_M, A10G 24GB)
- Service endpoint: query via `SHOW ENDPOINTS IN SERVICE HEALTHCARE_DATABASE.DEFAULT_SCHEMA.EVO2_SERVICE`

## API Reference

**Base URL**: Retrieve from SPCS endpoint (see Prerequisites)

| Endpoint | Method | Purpose |
|----------|--------|---------|
| `/health` | GET | Check model status and GPU memory |
| `/score` | POST | Score sequence log-likelihood |
| `/generate` | POST | Generate DNA sequence continuation |
| `/embeddings` | POST | Extract layer embeddings |
| `/variant-score` | POST | Compare ref vs alt allele impact |

### Request/Response Schemas

**POST /score**
```json
{"sequence": "ATCG...", "reduce_method": "mean"}
```
Returns: `{"sequence_length": N, "score": -1.234}`

**POST /variant-score**
```json
{"reference": "ATCG...", "alternative": "ATCG...", "position": 42}
```
Returns: `{"position": 42, "ref_base": "G", "alt_base": "A", "ref_score": -1.1, "alt_score": -1.8, "delta_score": -0.7, "prediction": "Likely pathogenic"}`

**POST /embeddings**
```json
{"sequence": "ATCG...", "layer_name": "blocks.28.mlp.l3"}
```
Returns: `{"layer_name": "...", "shape": [1, N, D], "embedding_norm": 45.2}`

**POST /generate**
```json
{"sequence": "ATCG...", "n_tokens": 100, "temperature": 1.0, "top_k": 4}
```
Returns: `{"prompt": "...", "generated": "...", "full_sequence": "..."}`

### Delta Score Interpretation

| Delta Score | Prediction |
|-------------|------------|
| < -0.5 | Likely pathogenic |
| -0.5 to -0.1 | Possibly damaging |
| -0.1 to 0.1 | Benign/Neutral |
| > 0.1 | Possibly beneficial |

## Workflow

### Step 1: Identify Gene and Context

**Goal:** Determine the gene, variants, and clinical question.

**Actions:**

1. **Ask** the user:
   - Which gene? (e.g., CYP2C19, BRCA1, CFTR, TP53, DPYD, TPMT)
   - What variants or alleles? (e.g., star alleles, rsIDs, specific mutations)
   - Clinical context? (pharmacogenomics, cancer risk, carrier screening, VUS classification)

2. **Query** ClinVar for known variants:
   ```sql
   SELECT GENESYMBOL, NAME, CLNSIG, TYPE, RSID
   FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CLINVAR
   WHERE GENESYMBOL = '<GENE>'
   ORDER BY CLNSIG
   ```

3. **Retrieve** reference sequence for the gene region from available genomic data.

**Output:** Gene name, variant list, reference sequence context.

### Step 2: Select Use Case

**Goal:** Route to the appropriate Evo2 analysis.

| Use Case | When to Use | Endpoint |
|----------|-------------|----------|
| **Variant Effect Prediction** | Score known variants (star alleles, pathogenic, benign) | `/variant-score` |
| **Sequence Scoring** | Compare wild-type vs mutant sequence likelihood | `/score` |
| **Embedding Clustering** | Group variants by functional similarity | `/embeddings` |
| **Novel Variant Screening** | Score VUS or newly discovered variants | `/variant-score` + `/score` |

Route to the matching use case below.

---

### Use Case 1: Variant Effect Prediction

**Goal:** Score known variants against reference to predict functional impact.

**When:** Star alleles (e.g., CYP2C19\*2), known pathogenic/benign variants, drug-gene interactions.

**Steps:**

1. **Prepare** reference and alternative sequences (flanking region around the variant, ~500-1000bp recommended).

2. **Call** `/variant-score` for each variant:
   ```python
   import requests
   endpoint = "<EVO2_ENDPOINT>"
   resp = requests.post(f"{endpoint}/variant-score", json={
       "reference": ref_seq,
       "alternative": alt_seq,
       "position": variant_position
   })
   result = resp.json()
   ```

3. **Interpret** delta scores using the interpretation table above.

4. **Present** results with clinical context:
   - Delta score and prediction category
   - Concordance with ClinVar annotation
   - Implications for the specific clinical scenario (drug metabolism, disease risk, etc.)

---

### Use Case 2: Sequence Scoring

**Goal:** Compare overall log-likelihood of wild-type vs mutant gene sequences.

**When:** Assessing whether a mutation disrupts the overall sequence fitness, comparing haplotypes.

**Steps:**

1. **Score** the wild-type (reference) sequence:
   ```python
   wt_resp = requests.post(f"{endpoint}/score", json={
       "sequence": wildtype_seq,
       "reduce_method": "mean"
   })
   wt_score = wt_resp.json()["score"]
   ```

2. **Score** each mutant sequence the same way.

3. **Compare** scores:
   - Lower score = less likely under the model = potentially more disruptive
   - Rank multiple variants by score delta from wild-type
   - Larger negative delta = more deleterious

4. **Present** ranked table of variants by predicted impact.

---

### Use Case 3: Embedding-Based Variant Clustering

**Goal:** Group gene variants by functional similarity using Evo2 internal representations.

**When:** Exploring relationships between multiple alleles, identifying functionally similar variants, unsupervised variant classification.

**Steps:**

1. **Extract** embeddings for each variant sequence:
   ```python
   emb_resp = requests.post(f"{endpoint}/embeddings", json={
       "sequence": variant_seq,
       "layer_name": "blocks.28.mlp.l3"
   })
   ```

2. **Collect** embedding vectors for all variants of interest.

3. **Cluster** using dimensionality reduction (PCA/UMAP) + clustering (k-means/HDBSCAN):
   - Group by functional similarity
   - Visualize clusters

4. **Interpret:** Variants clustering together likely share functional characteristics. Compare cluster membership against known phenotype categories (e.g., loss-of-function vs gain-of-function).

---

### Use Case 4: Novel Variant Screening

**Goal:** Score variants of uncertain significance (VUS) or newly discovered variants.

**When:** Patient has a variant not in ClinVar, novel mutation found in sequencing, reclassification efforts.

**Steps:**

1. **Identify** VUS from ClinVar or patient data:
   ```sql
   SELECT GENESYMBOL, NAME, CLNSIG, RSID
   FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CLINVAR
   WHERE GENESYMBOL = '<GENE>'
     AND CLNSIG ILIKE '%uncertain%'
   ```

2. **Score** each VUS using `/variant-score` (same as Use Case 1).

3. **Benchmark** against known pathogenic and benign variants for the same gene:
   - Score known pathogenic variants → establish pathogenic score range
   - Score known benign variants → establish benign score range
   - Compare VUS scores against these ranges

4. **Present** classification recommendation:
   - VUS score within pathogenic range → flag for review
   - VUS score within benign range → likely benign
   - VUS score in between → remains uncertain, recommend additional evidence

---

### Step 3: Clinical Decision Support

**Goal:** Integrate Evo2 predictions into clinical context.

**Actions:**

1. **Summarize** Evo2 findings for each scored variant.

2. **Cross-reference** with:
   - ClinVar clinical significance annotations
   - CPIC guidelines (for pharmacogenes)
   - Disease-specific databases (BRCA Exchange, CFTR2, etc.)

3. **Generate** clinical report:
   - Gene and variant(s) analyzed
   - Evo2 predicted functional impact (delta score + category)
   - Concordance with existing annotations
   - Recommended clinical action based on context:
     - **Pharmacogenomics**: drug selection/dosing adjustment
     - **Cancer risk**: screening/surveillance recommendations
     - **Carrier screening**: reproductive counseling implications
     - **VUS reclassification**: evidence summary for classification committees

**Example clinical workflow:**
```
Patient presents → genotype reveals [GENE] variant
  → Evo2 scores variant functional impact
    → Cross-reference ClinVar + guidelines
      → Clinical decision: adjust therapy / recommend screening / flag for review
```

## Stopping Points

- After Step 1: Confirm gene, variants, and clinical context with user
- After Use Case analysis: Present results before clinical interpretation
- After Step 3: Review clinical recommendation before finalizing

## Troubleshooting

**Service not responding:**
```sql
SELECT SYSTEM$GET_SERVICE_STATUS('HEALTHCARE_DATABASE.DEFAULT_SCHEMA.EVO2_SERVICE');
SHOW ENDPOINTS IN SERVICE HEALTHCARE_DATABASE.DEFAULT_SCHEMA.EVO2_SERVICE;
```

**Model still loading (503 error):**
- The 14GB model takes several minutes to load after container start
- Check `/health` endpoint - `model_loaded` should be `true`

**Sequence too long:**
- Evo2 7B handles sequences up to ~8k tokens
- For longer genes, use overlapping windows centered on variants

## Output

- Variant effect predictions with delta scores and pathogenicity classification
- Ranked variant impact tables
- Embedding-based functional clustering visualizations
- Clinical decision support recommendations tailored to gene and context
