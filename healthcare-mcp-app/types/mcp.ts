export interface MCPTool {
  name: string;
  title: string;
  description: string;
  inputSchema?: Record<string, unknown>;
}

export interface MCPRequest {
  jsonrpc: '2.0';
  id: string | number;
  method: string;
  params?: Record<string, unknown>;
}

export interface MCPResponse {
  jsonrpc: '2.0';
  id: string | number;
  result?: unknown;
  error?: {
    code: number;
    message: string;
    data?: unknown;
  };
}

export interface ToolCallResult {
  content: Array<{
    type: 'text' | 'sql' | 'data';
    text?: string;
    sql?: string;
    data?: unknown;
  }>;
}

export interface ChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  toolName?: string;
  sql?: string;
  data?: Record<string, unknown>[];
  timestamp: Date;
}
