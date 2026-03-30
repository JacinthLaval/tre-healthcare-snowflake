import { MCPRequest, MCPResponse, MCPTool, ToolCallResult } from '@/types/mcp';

const SNOWFLAKE_API_BASE = 'https://sfsehol-si_industry_demos_healthcare_lmszks.snowflakecomputing.com';

function getBaseUrl(): string {
  if (typeof window !== 'undefined' && window.location.hostname.endsWith('.snowflakecomputing.app')) {
    return '';
  }
  return SNOWFLAKE_API_BASE;
}

function getMcpEndpoint(): string {
  return `${getBaseUrl()}/api/v2/databases/TRE_HEALTHCARE_DB/schemas/OMOP_CDM/mcp-servers/HEALTHCARE_MCP_SERVER`;
}

function getSqlEndpoint(): string {
  return `${getBaseUrl()}/api/v2/statements`;
}

export class MCPClient {
  private patToken: string;
  private requestId = 0;

  constructor(patToken: string) {
    this.patToken = patToken;
  }

  private async request<T>(method: string, params?: Record<string, unknown>): Promise<T> {
    const body: MCPRequest = {
      jsonrpc: '2.0',
      id: ++this.requestId,
      method,
      params,
    };

    const response = await fetch(getMcpEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.patToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify(body),
    });

    if (!response.ok) {
      throw new Error(`MCP request failed: ${response.status} ${response.statusText}`);
    }

    const data: MCPResponse = await response.json();
    
    if (data.error) {
      throw new Error(`MCP error: ${data.error.message}`);
    }

    return data.result as T;
  }

  async executeSQL(sql: string, timeout: number = 30): Promise<Record<string, unknown>[]> {
    const response = await fetch(getSqlEndpoint(), {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${this.patToken}`,
        'Accept': 'application/json',
      },
      body: JSON.stringify({
        statement: sql,
        timeout: timeout,
        database: 'TRE_HEALTHCARE_DB',
        schema: 'OMOP_CDM',
        warehouse: 'COMPUTE_WH',
      }),
    });

    let data: Record<string, unknown>;

    if (response.status === 408) {
      data = await response.json();
      const handle = data.statementHandle || data.statementStatusUrl;
      if (handle) {
        const h = typeof handle === 'string' && handle.includes('/') ? handle.split('/').pop()! : handle as string;
        data = await this.pollForResults(h);
      } else {
        throw new Error(`SQL execution timed out (408) with no statement handle`);
      }
    } else if (!response.ok) {
      const text = await response.text();
      throw new Error(`SQL execution failed: ${response.status} - ${text}`);
    } else {
      data = await response.json();
    }

    if (data.code === '333334' || (data.message as string)?.includes?.('Asynchronous execution')) {
      const statementHandle = data.statementHandle as string;
      if (statementHandle) {
        data = await this.pollForResults(statementHandle);
      }
    }
    
    if (data.code && data.code !== '090001' && data.code !== '333334') {
      throw new Error(`SQL error: ${data.message}`);
    }

    // Parse the results
    const columns = data.resultSetMetaData?.rowType?.map((col: { name: string }) => col.name) || [];
    let allRows: unknown[][] = (data.data || []) as unknown[][];

    const partitionInfo = (data.resultSetMetaData as any)?.partitionInfo as any[];
    const statementHandle = data.statementHandle as string;
    if (partitionInfo && partitionInfo.length > 1 && statementHandle) {
      for (let i = 1; i < partitionInfo.length; i++) {
        try {
          const partitionUrl = `${getSqlEndpoint()}/${statementHandle}?partition=${i}`;
          const partResp = await fetch(partitionUrl, {
            method: 'GET',
            headers: {
              'Authorization': `Bearer ${this.patToken}`,
              'Accept': 'application/json',
            },
          });
          if (partResp.ok) {
            const partData = await partResp.json();
            if (partData.data) {
              allRows = allRows.concat(partData.data as unknown[][]);
            }
          }
        } catch (e) {
          console.warn(`[MCP] Failed to fetch partition ${i}:`, e);
        }
      }
    }

    return allRows.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  private waitForTabVisible(): Promise<void> {
    if (typeof document === 'undefined' || document.visibilityState === 'visible') {
      return Promise.resolve();
    }
    return new Promise(resolve => {
      const handler = () => {
        if (document.visibilityState === 'visible') {
          document.removeEventListener('visibilitychange', handler);
          resolve();
        }
      };
      document.addEventListener('visibilitychange', handler);
    });
  }

  private async pollForResults(statementHandle: string, maxAttempts: number = 120): Promise<Record<string, unknown>> {
    const pollUrl = `${getSqlEndpoint()}/${statementHandle}`;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await this.waitForTabVisible();
      await new Promise(resolve => setTimeout(resolve, 2000));
      
      let response: Response;
      try {
        response = await fetch(pollUrl, {
          method: 'GET',
          headers: {
            'Authorization': `Bearer ${this.patToken}`,
            'Accept': 'application/json',
          },
        });
      } catch {
        await this.waitForTabVisible();
        continue;
      }

      if (response.status === 202 || response.status === 408) {
        continue;
      }

      if (!response.ok) {
        throw new Error(`Poll failed: ${response.status}`);
      }

      const data = await response.json();
      
      if (data.code === '090001' || (data.data && data.data.length > 0)) {
        return data;
      }
      
      if (data.code === '333334') {
        continue;
      }
      
      if (data.code && data.code !== '090001' && data.code !== '333334') {
        throw new Error(`Query error: ${data.message}`);
      }
    }
    
    throw new Error('Query timed out after polling');
  }

  async listTools(): Promise<MCPTool[]> {
    const result = await this.request<{ tools: MCPTool[] }>('tools/list');
    return result.tools;
  }

  async callTool(name: string, arguments_: Record<string, unknown>): Promise<ToolCallResult> {
    return this.request<ToolCallResult>('tools/call', {
      name,
      arguments: arguments_,
    });
  }

  async askCibmtr(question: string): Promise<ToolCallResult> {
    return this.callTool('cibmtr-analyst', { message: question });
  }

  async askOmop(question: string): Promise<ToolCallResult> {
    return this.callTool('tre-omop-analyst', { message: question });
  }
}

let clientInstance: MCPClient | null = null;

export function initMCPClient(patToken: string): MCPClient {
  clientInstance = new MCPClient(patToken);
  return clientInstance;
}

export function getMCPClient(): MCPClient | null {
  return clientInstance;
}
