import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Platform, Alert } from 'react-native';
import { router } from 'expo-router';
import { initMCPClient } from '@/services/mcp-client';

export default function LoginScreen() {
  const [patToken, setPatToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [errorMsg, setErrorMsg] = useState('');

  const handleLogin = async () => {
    if (!patToken.trim()) {
      if (Platform.OS === 'web') {
        setErrorMsg('Please enter your PAT token');
      } else {
        Alert.alert('Error', 'Please enter your PAT token');
      }
      return;
    }

    setIsLoading(true);
    setErrorMsg('');
    try {
      const client = initMCPClient(patToken.trim());
      console.log('Testing MCP connection...');
      const tools = await client.listTools();
      console.log('MCP tools:', tools);
      
      if (Platform.OS !== 'web') {
        const SecureStore = require('expo-secure-store');
        await SecureStore.setItemAsync('snowflake_pat', patToken.trim());
      } else {
        localStorage.setItem('snowflake_pat', patToken.trim());
      }
      router.replace('/(tabs)');
    } catch (error) {
      console.error('Login error:', error);
      const msg = `Connection failed: ${error instanceof Error ? error.message : 'Unknown error'}`;
      if (Platform.OS === 'web') {
        setErrorMsg(msg);
      } else {
        Alert.alert('Connection Failed', msg);
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <View style={styles.container}>
      <View style={styles.logoContainer}>
        <Text style={styles.snowflake}>❄️</Text>
        <Text style={styles.title}>Healthcare MCP</Text>
        <Text style={styles.subtitle}>Connect to Snowflake Cortex Agents</Text>
      </View>

      <View style={styles.formContainer}>
        <Text style={styles.label}>Snowflake PAT Token</Text>
        <TextInput
          style={styles.input}
          value={patToken}
          onChangeText={setPatToken}
          placeholder="Enter your PAT token"
          placeholderTextColor="#999"
          secureTextEntry
          autoCapitalize="none"
          autoCorrect={false}
        />

        {errorMsg ? <Text style={styles.errorText}>{errorMsg}</Text> : null}

        <TouchableOpacity 
          style={[styles.button, isLoading && styles.buttonDisabled]}
          onPress={handleLogin}
          disabled={isLoading}
        >
          <Text style={styles.buttonText}>
            {isLoading ? 'Connecting...' : 'Connect'}
          </Text>
        </TouchableOpacity>
      </View>

      <Text style={styles.helpText}>
        Generate a PAT token in Snowsight under{'\n'}
        Settings → Developer → Personal Access Tokens
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 24,
    justifyContent: 'center',
  },
  logoContainer: {
    alignItems: 'center',
    marginBottom: 48,
  },
  snowflake: {
    fontSize: 64,
    marginBottom: 16,
  },
  title: {
    fontSize: 28,
    fontWeight: '700',
    color: '#29B5E8',
    marginBottom: 8,
  },
  subtitle: {
    fontSize: 16,
    color: '#666',
  },
  formContainer: {
    marginBottom: 32,
  },
  label: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 16,
    fontSize: 16,
    marginBottom: 16,
  },
  button: {
    height: 50,
    backgroundColor: '#29B5E8',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
  },
  buttonDisabled: {
    backgroundColor: '#9dd6eb',
  },
  buttonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
  errorText: {
    color: '#e74c3c',
    fontSize: 14,
    marginBottom: 12,
    textAlign: 'center',
  },
  helpText: {
    textAlign: 'center',
    color: '#999',
    fontSize: 12,
    lineHeight: 18,
  },
});
