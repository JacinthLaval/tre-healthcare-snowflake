import React, { useState, useEffect } from 'react';
import { View, Text, StyleSheet } from 'react-native';
import { fetchGovernanceSummary, GovernanceSummary } from '@/services/governance-queries';

interface BadgeItem {
  label: string;
  active: boolean;
  color: string;
}

export default function GovernanceBadge() {
  const [summary, setSummary] = useState<GovernanceSummary | null>(null);

  useEffect(() => {
    fetchGovernanceSummary()
      .then(setSummary)
      .catch(() => {});
  }, []);

  if (!summary) return null;

  const badges: BadgeItem[] = [
    { label: `RBAC: ${summary.roles} roles`, active: summary.roles > 0, color: '#29B5E8' },
    { label: `Masking: ${summary.maskingPolicies}`, active: summary.maskingPolicies > 0, color: '#8E44AD' },
    { label: summary.rowAccessPolicies > 0 ? `RAP: ${summary.rowAccessPolicies}` : 'RAP', active: summary.rowAccessPolicies > 0, color: '#E67E22' },
    { label: 'AES-256', active: summary.encryptionActive, color: '#27AE60' },
    { label: 'Audit ON', active: summary.auditActive, color: '#2ECC71' },
    { label: `Network: ${summary.networkPolicies}`, active: summary.networkPolicies > 0, color: '#3498DB' },
  ];

  const activeBadges = badges.filter(b => b.active);

  return (
    <View style={styles.container}>
      <View style={styles.shieldIcon}>
        <Text style={styles.shieldText}>&#9632;</Text>
      </View>
      {activeBadges.map((b, i) => (
        <View key={i} style={[styles.badge, { backgroundColor: b.color + '18', borderColor: b.color + '40' }]}>
          <View style={[styles.dot, { backgroundColor: b.color }]} />
          <Text style={[styles.badgeText, { color: b.color }]}>{b.label}</Text>
        </View>
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 6,
    backgroundColor: '#f8fafb',
    borderBottomWidth: 1,
    borderBottomColor: '#e8ecef',
    gap: 6,
  },
  shieldIcon: {
    width: 20,
    height: 20,
    borderRadius: 4,
    backgroundColor: '#29B5E8',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shieldText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '900',
  },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
    borderWidth: 1,
    gap: 4,
  },
  dot: {
    width: 6,
    height: 6,
    borderRadius: 3,
  },
  badgeText: {
    fontSize: 10,
    fontWeight: '600',
  },
});
