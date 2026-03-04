import React from 'react';
import { View, Text, TouchableOpacity, StyleSheet, Alert } from 'react-native';
import { router } from 'expo-router';
import * as SecureStore from 'expo-secure-store';

export default function SettingsScreen() {
  const handleLogout = async () => {
    Alert.alert(
      'Disconnect',
      'Are you sure you want to disconnect from Snowflake?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Disconnect',
          style: 'destructive',
          onPress: async () => {
            await SecureStore.deleteItemAsync('snowflake_pat');
            router.replace('/');
          },
        },
      ]
    );
  };

  return (
    <View style={styles.container}>
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Connection</Text>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Account</Text>
          <Text style={styles.value}>SFSEHOL-SI_INDUSTRY_DEMOS_HEALTHCARE_LMSZKS</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Database</Text>
          <Text style={styles.value}>TRE_HEALTHCARE_DB</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>Schema</Text>
          <Text style={styles.value}>OMOP_CDM</Text>
        </View>
        <View style={styles.infoRow}>
          <Text style={styles.label}>MCP Server</Text>
          <Text style={styles.value}>HEALTHCARE_MCP_SERVER</Text>
        </View>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>Available Tools</Text>
        <View style={styles.toolCard}>
          <Text style={styles.toolName}>cibmtr-analyst</Text>
          <Text style={styles.toolDesc}>CIBMTR Transplant data analysis</Text>
        </View>
        <View style={styles.toolCard}>
          <Text style={styles.toolName}>tre-omop-analyst</Text>
          <Text style={styles.toolDesc}>TRE OMOP CDM healthcare analytics</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.logoutButton} onPress={handleLogout}>
        <Text style={styles.logoutText}>Disconnect</Text>
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    marginBottom: 12,
    textTransform: 'uppercase',
  },
  infoRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  label: {
    fontSize: 14,
    color: '#666',
  },
  value: {
    fontSize: 14,
    color: '#333',
    fontWeight: '500',
    flex: 1,
    textAlign: 'right',
    marginLeft: 16,
  },
  toolCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
  },
  toolName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#29B5E8',
    marginBottom: 4,
  },
  toolDesc: {
    fontSize: 12,
    color: '#666',
  },
  logoutButton: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  logoutText: {
    fontSize: 16,
    color: '#e74c3c',
    fontWeight: '600',
  },
});
