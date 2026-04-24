import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { ChatInterface } from '@/components/ChatInterface';
import { ChatMessage, ToolCallResult } from '@/types/mcp';
import { getMCPClient, initMCPClient, validateSQL } from '@/services/mcp-client';

export default function CibmtrScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I can help you analyze CIBMTR stem cell transplant data. Ask me about survival rates, TMA outcomes, PBSC collection yields, and more.',
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSql, setPendingSql] = useState<Map<string, string>>(new Map());

  const getActiveRole = () => Platform.OS === 'web' ? (localStorage.getItem('snowflake_active_role') || undefined) : undefined;

  useEffect(() => {
    if (!getMCPClient()) {
      const pat = Platform.OS === 'web' 
        ? localStorage.getItem('snowflake_pat')
        : null;
      if (pat) {
        initMCPClient(pat);
      } else {
        router.replace('/');
      }
    }
  }, []);

  const handleConfirmSQL = useCallback(async (messageId: string) => {
    const sql = pendingSql.get(messageId);
    if (!sql) return;

    setPendingSql((prev) => { const next = new Map(prev); next.delete(messageId); return next; });
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, sqlPending: false } : m));
    setIsLoading(true);

    try {
      const client = getMCPClient();
      if (!client) throw new Error('Not connected');
      const data = await client.executeSQL(sql, 30, getActiveRole());
      setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, data } : m));
    } catch (err) {
      setMessages((prev) => prev.map((m) => m.id === messageId
        ? { ...m, content: m.content + `\n\nSQL execution error: ${err instanceof Error ? err.message : 'Unknown error'}` }
        : m));
    } finally {
      setIsLoading(false);
    }
  }, [pendingSql]);

  const handleRejectSQL = useCallback((messageId: string) => {
    setPendingSql((prev) => { const next = new Map(prev); next.delete(messageId); return next; });
    setMessages((prev) => prev.map((m) => m.id === messageId
      ? { ...m, sqlPending: false, content: m.content + '\n\n(SQL execution was rejected by user)' }
      : m));
  }, []);

  const handleSendMessage = useCallback(async (text: string) => {
    const userMessage: ChatMessage = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };
    setMessages((prev) => [...prev, userMessage]);
    setIsLoading(true);

    try {
      const client = getMCPClient();
      if (!client) throw new Error('Not connected');

      const result = await client.askCibmtr(text);
      console.log('MCP Response:', JSON.stringify(result, null, 2));
      
      const sql = extractSql(result);
      const msgId = (Date.now() + 1).toString();

      let sqlBlocked = false;
      if (sql) {
        const validation = validateSQL(sql);
        if (!validation.safe) {
          sqlBlocked = true;
        } else {
          setPendingSql((prev) => new Map(prev).set(msgId, sql));
        }
      }

      const assistantMessage: ChatMessage = {
        id: msgId,
        role: 'assistant',
        content: parseResponse(result) + (sqlBlocked ? '\n\n\ud83d\udee1\ufe0f This query was blocked by the guardrail — only SELECT statements are allowed.' : ''),
        sql: sql,
        sqlPending: sql && !sqlBlocked ? true : false,
        sqlBlocked,
        data: undefined,
        toolName: 'cibmtr-analyst',
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, assistantMessage]);
    } catch (error) {
      const errorMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: `Error: ${error instanceof Error ? error.message : 'Failed to get response'}`,
        timestamp: new Date(),
      };
      setMessages((prev) => [...prev, errorMessage]);
    } finally {
      setIsLoading(false);
    }
  }, []);

  return (
    <View style={styles.container}>
      <ChatInterface
        messages={messages}
        onSendMessage={handleSendMessage}
        onConfirmSQL={handleConfirmSQL}
        onRejectSQL={handleRejectSQL}
        isLoading={isLoading}
        placeholder="Ask about transplant outcomes..."
      />
    </View>
  );
}

function parseResponse(result: ToolCallResult): string {
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed)) {
            const textParts: string[] = [];
            for (const obj of parsed) {
              if (obj.text) textParts.push(obj.text);
              if (obj.suggestions && Array.isArray(obj.suggestions)) {
                textParts.push('\n\nSuggested questions:\n\u2022 ' + obj.suggestions.join('\n\u2022 '));
              }
            }
            return textParts.join('\n\n');
          }
        } catch {
          return item.text;
        }
      }
    }
  }
  return 'No response received';
}

function extractSql(result: ToolCallResult): string | undefined {
  if (Array.isArray(result.content)) {
    for (const item of result.content) {
      if (item.type === 'text' && item.text) {
        try {
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed)) {
            for (const obj of parsed) {
              if (obj.statement) return obj.statement;
            }
          }
        } catch {
        }
      }
    }
  }
  return undefined;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
