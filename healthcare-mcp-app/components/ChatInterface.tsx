import React, { useState, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  FlatList,
  StyleSheet,
  KeyboardAvoidingView,
  Platform,
  ActivityIndicator,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { ChatMessage } from '@/types/mcp';

interface ChatInterfaceProps {
  messages: ChatMessage[];
  onSendMessage: (text: string) => void;
  isLoading: boolean;
  placeholder?: string;
}

export function ChatInterface({ messages, onSendMessage, isLoading, placeholder }: ChatInterfaceProps) {
  const [inputText, setInputText] = useState('');
  const flatListRef = useRef<FlatList>(null);

  const handleSend = () => {
    if (inputText.trim() && !isLoading) {
      onSendMessage(inputText.trim());
      setInputText('');
    }
  };

  const renderMessage = ({ item }: { item: ChatMessage }) => (
    <View style={[styles.messageBubble, item.role === 'user' ? styles.userMessage : styles.assistantMessage]}>
      <Text style={[styles.messageText, item.role === 'user' && styles.userMessageText]}>
        {item.content}
      </Text>
      {item.data && item.data.length > 0 && (
        <View style={styles.dataContainer}>
          <Text style={styles.dataLabel}>📊 Results ({item.data.length} {item.data.length === 1 ? 'row' : 'rows'})</Text>
          <View style={styles.table}>
            <View style={styles.tableHeader}>
              {Object.keys(item.data[0]).map((col) => (
                <Text key={col} style={styles.tableHeaderCell}>{col.replace(/_/g, ' ')}</Text>
              ))}
            </View>
            {item.data.slice(0, 10).map((row, i) => (
              <View key={i} style={[styles.tableRow, i % 2 === 0 && styles.tableRowEven]}>
                {Object.values(row).map((val, j) => (
                  <Text key={j} style={styles.tableCell}>{formatValue(val)}</Text>
                ))}
              </View>
            ))}
          </View>
          {item.data.length > 10 && (
            <Text style={styles.dataMore}>+ {item.data.length - 10} more rows</Text>
          )}
        </View>
      )}
      {item.sql && (
        <View style={styles.sqlContainer}>
          <Text style={styles.sqlLabel}>🔍 SQL Query</Text>
          <Text style={styles.sqlText}>{item.sql}</Text>
        </View>
      )}
    </View>
  );

  function formatValue(val: unknown): string {
    if (val === null || val === undefined) return '—';
    if (typeof val === 'number') {
      if (Number.isInteger(val)) return val.toLocaleString();
      return val.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }
    return String(val);
  }

  return (
    <KeyboardAvoidingView 
      style={styles.container} 
      behavior={Platform.OS === 'ios' ? 'padding' : 'height'}
      keyboardVerticalOffset={100}
    >
      <FlatList
        ref={flatListRef}
        data={messages}
        keyExtractor={(item) => item.id}
        renderItem={renderMessage}
        contentContainerStyle={styles.messageList}
        onContentSizeChange={() => flatListRef.current?.scrollToEnd()}
      />
      
      <View style={styles.inputContainer}>
        <TextInput
          style={styles.input}
          value={inputText}
          onChangeText={setInputText}
          placeholder={placeholder || 'Ask a question...'}
          placeholderTextColor="#999"
          multiline={Platform.OS !== 'web'}
          maxLength={1000}
          editable={!isLoading}
          onSubmitEditing={handleSend}
          onKeyPress={(e) => {
            if (Platform.OS === 'web' && e.nativeEvent.key === 'Enter' && !e.nativeEvent.shiftKey) {
              e.preventDefault();
              handleSend();
            }
          }}
          blurOnSubmit={false}
        />
        <TouchableOpacity 
          style={[styles.sendButton, (!inputText.trim() || isLoading) && styles.sendButtonDisabled]}
          onPress={handleSend}
          disabled={!inputText.trim() || isLoading}
        >
          {isLoading ? (
            <ActivityIndicator color="#fff" size="small" />
          ) : (
            <Ionicons name="send" size={20} color="#fff" />
          )}
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  messageList: {
    padding: 16,
    paddingBottom: 8,
  },
  messageBubble: {
    maxWidth: '80%',
    padding: 12,
    borderRadius: 16,
    marginBottom: 8,
  },
  userMessage: {
    alignSelf: 'flex-end',
    backgroundColor: '#29B5E8',
  },
  assistantMessage: {
    alignSelf: 'flex-start',
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  messageText: {
    fontSize: 16,
    color: '#333',
  },
  userMessageText: {
    color: '#fff',
  },
  sqlContainer: {
    marginTop: 8,
    padding: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 6,
    borderLeftWidth: 3,
    borderLeftColor: '#29B5E8',
  },
  sqlLabel: {
    fontSize: 11,
    fontWeight: '600',
    color: '#666',
    marginBottom: 6,
  },
  sqlText: {
    fontSize: 12,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    color: '#333',
  },
  dataContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f8fdf8',
    borderRadius: 8,
    borderLeftWidth: 3,
    borderLeftColor: '#4caf50',
  },
  dataLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#2e7d32',
    marginBottom: 8,
  },
  table: {
    borderRadius: 6,
    overflow: 'hidden',
    borderWidth: 1,
    borderColor: '#e0e0e0',
  },
  tableHeader: {
    flexDirection: 'row',
    backgroundColor: '#29B5E8',
    paddingVertical: 8,
    paddingHorizontal: 4,
  },
  tableHeaderCell: {
    flex: 1,
    fontSize: 11,
    fontWeight: '700',
    color: '#fff',
    textTransform: 'uppercase',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  tableRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    paddingHorizontal: 4,
    backgroundColor: '#fff',
  },
  tableRowEven: {
    backgroundColor: '#f5f5f5',
  },
  tableCell: {
    flex: 1,
    fontSize: 13,
    color: '#333',
    textAlign: 'center',
    paddingHorizontal: 4,
  },
  dataMore: {
    fontSize: 11,
    color: '#666',
    fontStyle: 'italic',
    marginTop: 8,
    textAlign: 'center',
  },
  inputContainer: {
    flexDirection: 'row',
    padding: 12,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    alignItems: 'flex-end',
  },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 100,
    paddingHorizontal: 16,
    paddingVertical: 10,
    backgroundColor: '#f5f5f5',
    borderRadius: 20,
    fontSize: 16,
    color: '#333',
  },
  sendButton: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#29B5E8',
    justifyContent: 'center',
    alignItems: 'center',
    marginLeft: 8,
  },
  sendButtonDisabled: {
    backgroundColor: '#ccc',
  },
});
