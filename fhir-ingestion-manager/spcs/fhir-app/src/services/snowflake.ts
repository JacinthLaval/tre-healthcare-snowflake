import type { SQLResult } from '../types';

const API_BASE = '/api';

export async function executeSQL(sql: string): Promise<SQLResult> {
  const response = await fetch(`${API_BASE}/v2/statements`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ statement: sql }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`SQL error ${response.status}: ${err}`);
  }
  const json = await response.json();
  const columns = (json.resultSetMetaData?.rowType || []).map((c: { name: string }) => c.name);
  return { columns, data: json.data || [] };
}

export async function executePgSQL(sql: string, params?: unknown[]): Promise<SQLResult> {
  const response = await fetch(`${API_BASE}/pg/query`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sql, params }),
  });
  if (!response.ok) {
    const err = await response.text();
    throw new Error(`PG error ${response.status}: ${err}`);
  }
  return response.json();
}

export async function healthCheck(): Promise<{ snowflake: string; postgres: string }> {
  const response = await fetch(`${API_BASE}/health`);
  return response.json();
}
