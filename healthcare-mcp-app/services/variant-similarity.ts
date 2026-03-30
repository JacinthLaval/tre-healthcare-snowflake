import { getMCPClient } from '@/services/mcp-client';

export interface PatientVector {
  sampleId: string;
  patientName: string;
  superpopulation: string;
  population: string;
  variants: Record<string, number>;
}

export interface SimilarPatient {
  sampleId: string;
  patientName: string;
  superpopulation: string;
  population: string;
  similarity: number;
  sharedVariants: string[];
  community: number;
}

export interface CommunityProfile {
  communityId: number;
  size: number;
  variantFrequencies: Record<string, { carriers: number; total: number; frequency: number }>;
  superpopulationDistribution: Record<string, number>;
  members: { sampleId: string; patientName: string; superpopulation: string }[];
}

export interface GraphSummary {
  patients: number;
  variants: string[];
  edges: number;
  communities: number;
  communitySizes: Record<number, number>;
}

export interface GraphLayoutNode {
  x: number;
  y: number;
  community: number;
  sampleId: string;
  patientName: string;
  superpopulation: string;
}

export interface GraphLayout {
  nodes: GraphLayoutNode[];
  edges: [number, number, number][];
  communities: number;
  communitySizes: Record<string, number>;
  modularity: number;
}

interface PgxRow {
  SAMPLE_ID: string;
  PATIENT_NAME: string;
  POPULATION: string;
  SUPERPOPULATION: string;
  GENE: string;
  VARIANT_NAME: string;
  ALT_ALLELE_COUNT: string;
}

let _backend: 'cugraph' | 'sql' | null = null;

function parseVariant(val: unknown): any {
  if (typeof val !== 'string') return val;
  try {
    const parsed = JSON.parse(val);
    if (typeof parsed === 'string') return parseVariant(parsed);
    return parsed;
  } catch {
    return val;
  }
}

let cachedData: {
  patients: PatientVector[];
  variantKeys: string[];
  communities: Map<string, number>;
} | null = null;

async function detectBackend(): Promise<'cugraph' | 'sql'> {
  if (_backend) return _backend;
  try {
    const client = getMCPClient();
    if (!client) throw new Error('No client');
    const result = await client.executeSQL(
      `SELECT HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CUGRAPH_FIND_SIMILAR('HG03045', 1) AS RESULT`
    ) as any[];
    if (result && result.length > 0) {
      const val = result[0].RESULT || result[0].result;
      if (val) {
        const parsed = parseVariant(val);
        if (parsed.backend === 'cugraph_gpu' || parsed.similar_patients) {
          console.log('[VariantSim] cuGraph GPU backend detected via service function');
          _backend = 'cugraph';
          return 'cugraph';
        }
      }
    }
  } catch (e) {
    console.log('[VariantSim] cuGraph service function unavailable, using SQL fallback:', e);
  }
  _backend = 'sql';
  return 'sql';
}

export function getBackendType(): string {
  return _backend || 'detecting...';
}

async function cugraphFindSimilar(sampleId: string, topN: number): Promise<any> {
  const client = getMCPClient();
  if (!client) throw new Error('Not connected');
  const result = await client.executeSQL(
    `SELECT HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CUGRAPH_FIND_SIMILAR('${sampleId.replace(/'/g, "''")}', ${topN}) AS RESULT`
  ) as any[];
  if (!result || result.length === 0) throw new Error('No result from cuGraph');
  const val = result[0].RESULT || result[0].result;
  return parseVariant(val);
}

async function cugraphCommunityProfile(communityId: number): Promise<any> {
  const client = getMCPClient();
  if (!client) throw new Error('Not connected');
  const result = await client.executeSQL(
    `SELECT HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CUGRAPH_COMMUNITY_PROFILE(${communityId}) AS RESULT`
  ) as any[];
  if (!result || result.length === 0) throw new Error('No result from cuGraph');
  const val = result[0].RESULT || result[0].result;
  return parseVariant(val);
}

async function loadPgxData(): Promise<typeof cachedData> {
  if (cachedData) return cachedData;

  const client = getMCPClient();
  if (!client) throw new Error('Not connected');

  const rows = await client.executeSQL(`
    SELECT p.SAMPLE_ID, p.PATIENT_NAME, p.POPULATION, p.SUPERPOPULATION,
           p.GENE, p.VARIANT_NAME, p.ALT_ALLELE_COUNT
    FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_PGX_PROFILES p
  `) as unknown as PgxRow[];

  const variantSet = new Set<string>();
  const patientMap = new Map<string, PatientVector>();

  for (const row of rows) {
    const key = `${row.GENE}:${row.VARIANT_NAME}`;
    variantSet.add(key);

    if (!patientMap.has(row.SAMPLE_ID)) {
      patientMap.set(row.SAMPLE_ID, {
        sampleId: row.SAMPLE_ID,
        patientName: row.PATIENT_NAME,
        superpopulation: row.SUPERPOPULATION,
        population: row.POPULATION,
        variants: {},
      });
    }
    patientMap.get(row.SAMPLE_ID)!.variants[key] = parseInt(row.ALT_ALLELE_COUNT) || 0;
  }

  const variantKeys = [...variantSet].sort();
  const patients = [...patientMap.values()];

  const communities = assignCommunities(patients, variantKeys, 0.3);

  cachedData = { patients, variantKeys, communities };
  return cachedData;
}

function jaccardSimilarity(a: Record<string, number>, b: Record<string, number>, keys: string[]): number {
  let intersection = 0;
  let union = 0;
  for (const k of keys) {
    const av = (a[k] || 0) > 0 ? 1 : 0;
    const bv = (b[k] || 0) > 0 ? 1 : 0;
    if (av || bv) {
      union++;
      if (av && bv) intersection++;
    }
  }
  return union === 0 ? 0 : intersection / union;
}

function assignCommunities(patients: PatientVector[], variantKeys: string[], threshold: number): Map<string, number> {
  const n = patients.length;
  const adj: number[][] = Array.from({ length: n }, () => []);

  for (let i = 0; i < n; i++) {
    for (let j = i + 1; j < n; j++) {
      const sim = jaccardSimilarity(patients[i].variants, patients[j].variants, variantKeys);
      if (sim >= threshold) {
        adj[i].push(j);
        adj[j].push(i);
      }
    }
  }

  const community = new Array(n).fill(-1);
  let currentCommunity = 0;

  for (let i = 0; i < n; i++) {
    if (community[i] !== -1) continue;
    const queue = [i];
    community[i] = currentCommunity;
    while (queue.length > 0) {
      const node = queue.shift()!;
      for (const neighbor of adj[node]) {
        if (community[neighbor] === -1) {
          community[neighbor] = currentCommunity;
          queue.push(neighbor);
        }
      }
    }
    currentCommunity++;
  }

  const result = new Map<string, number>();
  for (let i = 0; i < n; i++) {
    result.set(patients[i].sampleId, community[i]);
  }
  return result;
}

export async function findSimilarPatients(sampleId: string, topN: number = 10): Promise<{ queryVariants: string[]; similar: SimilarPatient[]; communityId: number | null }> {
  const backend = await detectBackend();

  if (backend === 'cugraph') {
    try {
      const data = await cugraphFindSimilar(sampleId, topN);
      const similar: SimilarPatient[] = (data.similar_patients || []).map((sp: any) => ({
        sampleId: sp.sample_id,
        patientName: sp.patient_name,
        superpopulation: sp.superpopulation,
        population: sp.population,
        similarity: sp.similarity,
        sharedVariants: sp.shared_variants || [],
        community: sp.community_id ?? 0,
      }));
      return {
        queryVariants: data.query_variants || [],
        similar,
        communityId: data.community_id ?? null,
      };
    } catch (e) {
      console.warn('[VariantSim] cuGraph call failed, falling back to SQL:', e);
      _backend = 'sql';
    }
  }

  const pgx = await loadPgxData();
  if (!pgx) throw new Error('Failed to load data');

  const queryPatient = pgx.patients.find(p => p.sampleId === sampleId);
  if (!queryPatient) throw new Error(`Patient ${sampleId} not found in ${pgx.patients.length} loaded patients`);

  const queryVariants = pgx.variantKeys.filter(k => (queryPatient.variants[k] || 0) > 0);

  const scored: SimilarPatient[] = [];
  for (const p of pgx.patients) {
    if (p.sampleId === sampleId) continue;
    const sim = jaccardSimilarity(queryPatient.variants, p.variants, pgx.variantKeys);
    const shared = pgx.variantKeys.filter(k => (queryPatient.variants[k] || 0) > 0 && (p.variants[k] || 0) > 0);
    scored.push({
      sampleId: p.sampleId,
      patientName: p.patientName,
      superpopulation: p.superpopulation,
      population: p.population,
      similarity: Math.round(sim * 10000) / 10000,
      sharedVariants: shared,
      community: pgx.communities.get(p.sampleId) || 0,
    });
  }

  scored.sort((a, b) => b.similarity - a.similarity);
  const communityId = pgx.communities.get(sampleId) ?? null;
  return { queryVariants, similar: scored.slice(0, topN), communityId };
}

export async function getCommunityProfile(communityId: number): Promise<CommunityProfile> {
  const backend = await detectBackend();

  if (backend === 'cugraph') {
    try {
      const data = await cugraphCommunityProfile(communityId);
      const variantFrequencies: CommunityProfile['variantFrequencies'] = {};
      for (const [k, v] of Object.entries(data.variant_frequencies || {})) {
        const vf = v as any;
        variantFrequencies[k] = { carriers: vf.carriers, total: vf.total, frequency: vf.frequency };
      }
      return {
        communityId: data.community_id,
        size: data.size,
        variantFrequencies,
        superpopulationDistribution: data.superpopulation_distribution || {},
        members: [],
      };
    } catch (e) {
      console.warn('[VariantSim] cuGraph community profile failed, falling back to SQL:', e);
      _backend = 'sql';
    }
  }

  const pgx = await loadPgxData();
  if (!pgx) throw new Error('Failed to load data');

  const members = pgx.patients.filter(p => pgx.communities.get(p.sampleId) === communityId);
  if (members.length === 0) throw new Error(`Community ${communityId} not found`);

  const variantFrequencies: CommunityProfile['variantFrequencies'] = {};
  for (const vk of pgx.variantKeys) {
    const carriers = members.filter(p => (p.variants[vk] || 0) > 0).length;
    variantFrequencies[vk] = {
      carriers,
      total: members.length,
      frequency: Math.round((carriers / members.length) * 1000) / 1000,
    };
  }

  const superpopulationDistribution: Record<string, number> = {};
  for (const m of members) {
    superpopulationDistribution[m.superpopulation] = (superpopulationDistribution[m.superpopulation] || 0) + 1;
  }

  return {
    communityId,
    size: members.length,
    variantFrequencies,
    superpopulationDistribution,
    members: members.slice(0, 50).map(m => ({
      sampleId: m.sampleId,
      patientName: m.patientName,
      superpopulation: m.superpopulation,
    })),
  };
}

export async function getPatientCommunity(sampleId: string): Promise<number | null> {
  const pgx = await loadPgxData();
  if (!pgx) return null;
  return pgx.communities.get(sampleId) ?? null;
}

export async function getGraphSummary(): Promise<GraphSummary> {
  const pgx = await loadPgxData();
  if (!pgx) throw new Error('Failed to load data');

  const communitySizes: Record<number, number> = {};
  for (const c of pgx.communities.values()) {
    communitySizes[c] = (communitySizes[c] || 0) + 1;
  }

  let edgeCount = 0;
  const patients = pgx.patients;
  for (let i = 0; i < patients.length; i++) {
    for (let j = i + 1; j < patients.length; j++) {
      if (jaccardSimilarity(patients[i].variants, patients[j].variants, pgx.variantKeys) >= 0.2) {
        edgeCount++;
      }
    }
  }

  return {
    patients: pgx.patients.length,
    variants: pgx.variantKeys,
    edges: edgeCount,
    communities: Object.keys(communitySizes).length,
    communitySizes,
  };
}

export async function getGraphLayout(maxEdges: number = 5000): Promise<GraphLayout> {
  const backend = await detectBackend();

  if (backend === 'cugraph') {
    try {
      const client = getMCPClient();
      if (!client) throw new Error('Not connected');
      const result = await client.executeSQL(
        `SELECT HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CUGRAPH_GRAPH_LAYOUT(${maxEdges}) AS RESULT`
      ) as any[];
      if (!result || result.length === 0) throw new Error('No result');
      const val = result[0].RESULT || result[0].result;
      const data = parseVariant(val);
      const nodes: GraphLayoutNode[] = (data.nodes || []).map((n: any[]) => ({
        x: n[0],
        y: n[1],
        community: n[2],
        sampleId: n[3],
        patientName: n[4],
        superpopulation: n[5],
      }));
      return {
        nodes,
        edges: data.edges || [],
        communities: data.communities,
        communitySizes: data.community_sizes || {},
        modularity: data.modularity,
      };
    } catch (e) {
      console.warn('[VariantSim] cuGraph layout failed, using SQL fallback:', e);
      _backend = 'sql';
    }
  }

  const pgx = await loadPgxData();
  if (!pgx) throw new Error('Failed to load data');

  const n = pgx.patients.length;
  const nodes: GraphLayoutNode[] = [];
  const communityGroups = new Map<number, number[]>();

  for (let i = 0; i < n; i++) {
    const c = pgx.communities.get(pgx.patients[i].sampleId) || 0;
    if (!communityGroups.has(c)) communityGroups.set(c, []);
    communityGroups.get(c)!.push(i);
  }

  const commEntries = [...communityGroups.entries()].sort((a, b) => b[1].length - a[1].length);
  const angleStep = (2 * Math.PI) / commEntries.length;

  for (let ci = 0; ci < commEntries.length; ci++) {
    const [cid, members] = commEntries[ci];
    const cx = 0.5 + 0.3 * Math.cos(ci * angleStep);
    const cy = 0.5 + 0.3 * Math.sin(ci * angleStep);
    const spread = Math.min(0.15, 0.05 + members.length * 0.0001);

    for (let mi = 0; mi < members.length; mi++) {
      const a = (mi / members.length) * 2 * Math.PI;
      const r = spread * Math.sqrt(mi / members.length);
      const idx = members[mi];
      const p = pgx.patients[idx];
      nodes[idx] = {
        x: cx + r * Math.cos(a),
        y: cy + r * Math.sin(a),
        community: cid,
        sampleId: p.sampleId,
        patientName: p.patientName,
        superpopulation: p.superpopulation,
      };
    }
  }

  const edges: [number, number, number][] = [];
  const sampleIdxMap = new Map<string, number>();
  pgx.patients.forEach((p, i) => sampleIdxMap.set(p.sampleId, i));

  let edgeCount = 0;
  for (let i = 0; i < n && edgeCount < maxEdges; i++) {
    for (let j = i + 1; j < n && edgeCount < maxEdges; j++) {
      const sim = jaccardSimilarity(pgx.patients[i].variants, pgx.patients[j].variants, pgx.variantKeys);
      if (sim >= 0.5) {
        edges.push([i, j, Math.round(sim * 1000) / 1000]);
        edgeCount++;
      }
    }
  }

  const communitySizes: Record<string, number> = {};
  for (const [k, v] of communityGroups.entries()) {
    communitySizes[String(k)] = v.length;
  }

  return {
    nodes,
    edges,
    communities: communityGroups.size,
    communitySizes,
    modularity: 0,
  };
}

export function clearCache(): void {
  cachedData = null;
  _backend = null;
}
