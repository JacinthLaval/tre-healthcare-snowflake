import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { ChatInterface } from '@/components/ChatInterface';
import { ChatMessage, ToolCallResult } from '@/types/mcp';
import { getMCPClient, initMCPClient } from '@/services/mcp-client';

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
      let data: Record<string, unknown>[] | undefined;
      
      // Execute the SQL if we got one
      if (sql) {
        try {
          data = await client.executeSQL(sql);
          console.log('SQL Results:', data);
        } catch (sqlError) {
          console.error('SQL execution error:', sqlError);
        }
      }
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: parseResponse(result),
        sql: sql,
        data: data,
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
          // The text field contains a JSON array of response objects
          const parsed = JSON.parse(item.text);
          if (Array.isArray(parsed)) {
            const textParts: string[] = [];
            for (const obj of parsed) {
              if (obj.text) textParts.push(obj.text);
              if (obj.suggestions && Array.isArray(obj.suggestions)) {
                textParts.push('\n\nSuggested questions:\n• ' + obj.suggestions.join('\n• '));
              }
            }
            return textParts.join('\n\n');
          }
        } catch {
          // Not JSON, return as-is
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
          // Not JSON
        }
      }
    }
  }
  return undefined;
}

function extractData(result: ToolCallResult): Record<string, unknown>[] | undefined {
  return undefined;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
