import { MCPRequest, MCPResponse, MCPTool, ToolCallResult } from '@/types/mcp';

const MCP_ENDPOINT = 'https://sfsehol-si_industry_demos_healthcare_lmszks.snowflakecomputing.com/api/v2/databases/TRE_HEALTHCARE_DB/schemas/OMOP_CDM/mcp-servers/HEALTHCARE_MCP_SERVER';
const SQL_ENDPOINT = 'https://sfsehol-si_industry_demos_healthcare_lmszks.snowflakecomputing.com/api/v2/statements';

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

    const response = await fetch(MCP_ENDPOINT, {
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

  async executeSQL(sql: string, timeout: number = 60): Promise<Record<string, unknown>[]> {
    const response = await fetch(SQL_ENDPOINT, {
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

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`SQL execution failed: ${response.status} - ${text}`);
    }

    let data = await response.json();
    
    // Handle async execution - poll for results
    if (data.code === '333334' || data.message?.includes('Asynchronous execution')) {
      const statementHandle = data.statementHandle;
      if (statementHandle) {
        data = await this.pollForResults(statementHandle);
      }
    }
    
    if (data.code && data.code !== '090001' && data.code !== '333334') {
      throw new Error(`SQL error: ${data.message}`);
    }

    // Parse the results
    const columns = data.resultSetMetaData?.rowType?.map((col: { name: string }) => col.name) || [];
    const rows = data.data || [];
    
    return rows.map((row: unknown[]) => {
      const obj: Record<string, unknown> = {};
      columns.forEach((col: string, i: number) => {
        obj[col] = row[i];
      });
      return obj;
    });
  }

  private async pollForResults(statementHandle: string, maxAttempts: number = 60): Promise<Record<string, unknown>> {
    const pollUrl = `${SQL_ENDPOINT}/${statementHandle}`;
    
    for (let attempt = 0; attempt < maxAttempts; attempt++) {
      await new Promise(resolve => setTimeout(resolve, 2000)); // Wait 2 seconds between polls
      
      const response = await fetch(pollUrl, {
        method: 'GET',
        headers: {
          'Authorization': `Bearer ${this.patToken}`,
          'Accept': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Poll failed: ${response.status}`);
      }

      const data = await response.json();
      
      // Check if query is complete
      if (data.code === '090001' || (data.data && data.data.length > 0)) {
        return data;
      }
      
      // If still running, continue polling
      if (data.code === '333334') {
        continue;
      }
      
      // If error, throw
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
