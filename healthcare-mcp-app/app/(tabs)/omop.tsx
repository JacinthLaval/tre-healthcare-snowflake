import React, { useState, useCallback, useEffect } from 'react';
import { View, StyleSheet, Platform } from 'react-native';
import { router } from 'expo-router';
import { ChatInterface } from '@/components/ChatInterface';
import { ChatMessage, ToolCallResult } from '@/types/mcp';
import { getMCPClient, initMCPClient } from '@/services/mcp-client';

export default function OmopScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I can help you analyze TRE healthcare data in OMOP CDM format. Ask me about patient demographics, visits, conditions, medications, and procedures.',
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

      const result = await client.askOmop(text);
      
      const assistantMessage: ChatMessage = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: parseResponse(result),
        sql: extractSql(result),
        data: extractData(result),
        toolName: 'tre-omop-analyst',
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
        placeholder="Ask about patient data..."
      />
    </View>
  );
}

function parseResponse(result: ToolCallResult): string {
  const textContent = result.content?.find((c) => c.type === 'text');
  return textContent?.text || 'No response received';
}

function extractSql(result: ToolCallResult): string | undefined {
  const sqlContent = result.content?.find((c) => c.type === 'sql');
  return sqlContent?.sql;
}

function extractData(result: ToolCallResult): Record<string, unknown>[] | undefined {
  const dataContent = result.content?.find((c) => c.type === 'data');
  return dataContent?.data as Record<string, unknown>[] | undefined;
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
  },
});
