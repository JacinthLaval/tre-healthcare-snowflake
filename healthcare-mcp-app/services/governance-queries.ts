import { getMCPClient } from '@/services/mcp-client';

export interface RBACGrant {
  privilege: string;
  granted_on: string;
  name: string;
  granted_to: string;
  grantee_name: string;
  grant_option: string;
}

export interface MaskingPolicy {
  name: string;
  database_name: string;
  schema_name: string;
  kind: string;
  created_on: string;
}

export interface NetworkPolicy {
  name: string;
  allowed_ip_list: number;
  blocked_ip_list: number;
  allowed_network_rules: number;
  blocked_network_rules: number;
}

export interface AuditEntry {
  query_type: string;
  count: number;
  earliest: string;
  latest: string;
}

export async function fetchRBACGrants(): Promise<RBACGrant[]> {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const rows = await client.executeSQL('SHOW GRANTS ON DATABASE TRE_HEALTHCARE_DB');
  const rows2 = await client.executeSQL('SHOW GRANTS ON DATABASE HEALTHCARE_DATABASE');
  return [...rows, ...rows2].map((r: any) => ({
    privilege: r.privilege || r.PRIVILEGE || '',
    granted_on: r.granted_on || r.GRANTED_ON || '',
    name: r.name || r.NAME || '',
    granted_to: r.granted_to || r.GRANTED_TO || '',
    grantee_name: r.grantee_name || r.GRANTEE_NAME || '',
    grant_option: r.grant_option || r.GRANT_OPTION || '',
  }));
}

export async function fetchMaskingPolicies(): Promise<MaskingPolicy[]> {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const rows = await client.executeSQL('SHOW MASKING POLICIES IN ACCOUNT');
  return (rows || []).map((r: any) => ({
    name: r.name || r.NAME || '',
    database_name: r.database_name || r.DATABASE_NAME || '',
    schema_name: r.schema_name || r.SCHEMA_NAME || '',
    kind: r.kind || r.KIND || '',
    created_on: r.created_on || r.CREATED_ON || '',
  }));
}

export async function fetchRowAccessPolicies(): Promise<any[]> {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const rows = await client.executeSQL('SHOW ROW ACCESS POLICIES IN ACCOUNT');
  return (rows || []).map((r: any) => ({
    name: r.name || r.NAME || '',
    database_name: r.database_name || r.DATABASE_NAME || '',
    schema_name: r.schema_name || r.SCHEMA_NAME || '',
    created_on: r.created_on || r.CREATED_ON || '',
  }));
}

export async function fetchNetworkPolicies(): Promise<NetworkPolicy[]> {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const rows = await client.executeSQL('SHOW NETWORK POLICIES');
  return (rows || []).map((r: any) => ({
    name: r.name || r.NAME || '',
    allowed_ip_list: parseInt(r.entries_in_allowed_ip_list || r.ENTRIES_IN_ALLOWED_IP_LIST || '0'),
    blocked_ip_list: parseInt(r.entries_in_blocked_ip_list || r.ENTRIES_IN_BLOCKED_IP_LIST || '0'),
    allowed_network_rules: parseInt(r.entries_in_allowed_network_rules || r.ENTRIES_IN_ALLOWED_NETWORK_RULES || '0'),
    blocked_network_rules: parseInt(r.entries_in_blocked_network_rules || r.ENTRIES_IN_BLOCKED_NETWORK_RULES || '0'),
  }));
}

export async function fetchQueryAudit(): Promise<AuditEntry[]> {
  const client = getMCPClient();
  if (!client) throw new Error('MCP client not initialized');
  const rows = await client.executeSQL(`
    SELECT query_type, COUNT(*) as cnt,
           MIN(start_time) as earliest, MAX(start_time) as latest
    FROM SNOWFLAKE.ACCOUNT_USAGE.QUERY_HISTORY
    WHERE start_time >= DATEADD('day', -7, CURRENT_TIMESTAMP())
    AND database_name IN ('TRE_HEALTHCARE_DB', 'HEALTHCARE_DATABASE')
    GROUP BY query_type ORDER BY cnt DESC LIMIT 10
  `);
  return (rows || []).map((r: any) => ({
    query_type: r.QUERY_TYPE || r.query_type || '',
    count: parseInt(r.CNT || r.cnt || '0'),
    earliest: r.EARLIEST || r.earliest || '',
    latest: r.LATEST || r.latest || '',
  }));
}

export async function fetchEncryptionStatus(): Promise<{ encrypted: boolean; keyRotation: string }> {
  return { encrypted: true, keyRotation: 'AES-256, automatic rotation' };
}

export interface GovernanceSummary {
  roles: number;
  maskingPolicies: number;
  rowAccessPolicies: number;
  networkPolicies: number;
  encryptionActive: boolean;
  auditActive: boolean;
  dataShares: number;
}

export async function fetchGovernanceSummary(): Promise<GovernanceSummary> {
  const [grants, masks, raps, netPols] = await Promise.all([
    fetchRBACGrants(),
    fetchMaskingPolicies(),
    fetchRowAccessPolicies(),
    fetchNetworkPolicies(),
  ]);
  const uniqueRoles = new Set(grants.filter(g => g.granted_to === 'ROLE').map(g => g.grantee_name));
  const shares = grants.filter(g => g.granted_to === 'SHARE').length;
  return {
    roles: uniqueRoles.size,
    maskingPolicies: masks.length,
    rowAccessPolicies: raps.length,
    networkPolicies: netPols.length,
    encryptionActive: true,
    auditActive: true,
    dataShares: shares,
  };
}
