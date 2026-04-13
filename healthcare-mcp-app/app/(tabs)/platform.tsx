import React, { useState, useEffect, useCallback } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, ScrollView, ActivityIndicator } from 'react-native';
import { getMCPClient } from '@/services/mcp-client';
import {
  fetchRBACGrants, fetchMaskingPolicies, fetchRowAccessPolicies,
  fetchNetworkPolicies, fetchQueryAudit,
  RBACGrant, MaskingPolicy, NetworkPolicy, AuditEntry,
} from '@/services/governance-queries';
import DataFlowDiagram from '@/components/DataFlowDiagram';

type SubTab = 'overview' | 'rbac' | 'audit';

export default function PlatformScreen() {
  const [activeTab, setActiveTab] = useState<SubTab>('overview');
  const [loading, setLoading] = useState(false);
  const [grants, setGrants] = useState<RBACGrant[]>([]);
  const [masks, setMasks] = useState<MaskingPolicy[]>([]);
  const [raps, setRaps] = useState<any[]>([]);
  const [netPols, setNetPols] = useState<NetworkPolicy[]>([]);
  const [audit, setAudit] = useState<AuditEntry[]>([]);

  const loadData = useCallback(async () => {
    const client = getMCPClient();
    if (!client) return;
    setLoading(true);
    try {
      const [g, m, r, n, a] = await Promise.all([
        fetchRBACGrants().catch(() => []),
        fetchMaskingPolicies().catch(() => []),
        fetchRowAccessPolicies().catch(() => []),
        fetchNetworkPolicies().catch(() => []),
        fetchQueryAudit().catch(() => []),
      ]);
      setGrants(g);
      setMasks(m);
      setRaps(r);
      setNetPols(n);
      setAudit(a);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { loadData(); }, [loadData]);

  const uniqueRoles = [...new Set(grants.filter(g => g.granted_to === 'ROLE').map(g => g.grantee_name))];
  const shares = grants.filter(g => g.granted_to === 'SHARE');
  const totalQueries = audit.reduce((s, a) => s + a.count, 0);

  const tabs: { key: SubTab; label: string }[] = [
    { key: 'overview', label: 'Overview' },
    { key: 'rbac', label: 'RBAC & Policies' },
    { key: 'audit', label: 'Audit Trail' },
  ];

  return (
    <ScrollView style={styles.container}>
      <View style={styles.hero}>
        <Text style={styles.heroTitle}>Built on Snowflake</Text>
        <Text style={styles.heroSubtitle}>
          Every query, every model, every patient record — secured by enterprise-grade governance that comes built-in, not bolted on.
        </Text>
      </View>

      <View style={styles.kpiRow}>
        <View style={styles.kpi}>
          <Text style={[styles.kpiValue, { color: '#29B5E8' }]}>{uniqueRoles.length}</Text>
          <Text style={styles.kpiLabel}>RBAC Roles</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={[styles.kpiValue, { color: '#8E44AD' }]}>{masks.length}</Text>
          <Text style={styles.kpiLabel}>Masking Policies</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={[styles.kpiValue, { color: '#E67E22' }]}>{raps.length}</Text>
          <Text style={styles.kpiLabel}>Row Access Policies</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={[styles.kpiValue, { color: '#3498DB' }]}>{netPols.length}</Text>
          <Text style={styles.kpiLabel}>Network Policies</Text>
        </View>
        <View style={styles.kpi}>
          <Text style={[styles.kpiValue, { color: '#27AE60' }]}>{shares.length}</Text>
          <Text style={styles.kpiLabel}>Data Shares</Text>
        </View>
      </View>

      <View style={styles.encryptionBanner}>
        <View style={styles.encryptionIcon}>
          <Text style={styles.encryptionIconText}>&#128274;</Text>
        </View>
        <View style={{ flex: 1 }}>
          <Text style={styles.encryptionTitle}>End-to-End Encryption</Text>
          <Text style={styles.encryptionDesc}>AES-256 encryption at rest &bull; TLS 1.2+ in transit &bull; Automatic key rotation &bull; Customer-managed keys available</Text>
        </View>
      </View>

      <DataFlowDiagram />

      <View style={styles.tabRow}>
        {tabs.map(t => (
          <TouchableOpacity
            key={t.key}
            style={[styles.tab, activeTab === t.key && styles.tabActive]}
            onPress={() => setActiveTab(t.key)}
          >
            <Text style={[styles.tabText, activeTab === t.key && styles.tabTextActive]}>{t.label}</Text>
          </TouchableOpacity>
        ))}
        <TouchableOpacity style={styles.refreshBtn} onPress={loadData}>
          {loading ? <ActivityIndicator size="small" color="#29B5E8" /> : <Text style={styles.refreshText}>Refresh</Text>}
        </TouchableOpacity>
      </View>

      {activeTab === 'overview' && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>WHAT SNOWFLAKE PROVIDES</Text>
            {[
              { title: 'Role-Based Access Control', desc: `${uniqueRoles.length} roles enforce least-privilege access across ${grants.length} grants. Clinicians see only what they need.`, color: '#29B5E8' },
              { title: 'Dynamic Data Masking', desc: `${masks.length} masking policies protect PII (SSN, addresses, timestamps). Researchers see de-identified data while clinicians see full records.`, color: '#8E44AD' },
              { title: 'Row-Level Security', desc: `${raps.length} row access policy enforces consent-based data access. Only consented patient records are visible per role.`, color: '#E67E22' },
              { title: 'Network Security', desc: `${netPols.length} network policies restrict access by IP range and network rules. All traffic routed through authorized paths only.`, color: '#3498DB' },
              { title: 'SQL Guardrails (App-Level)', desc: 'Regex-based SQL validator blocks DML, DDL, and unauthorized CALL statements. Only SELECT and whitelisted stored procedures are permitted.', color: '#E74C3C' },
              { title: 'Automatic Audit Trail', desc: `${totalQueries.toLocaleString()} queries logged in the last 7 days across healthcare databases. Full lineage of who accessed what, when.`, color: '#27AE60' },
            ].map((item, i) => (
              <View key={i} style={[styles.featureCard, { borderLeftColor: item.color }]}>
                <Text style={[styles.featureTitle, { color: item.color }]}>{item.title}</Text>
                <Text style={styles.featureDesc}>{item.desc}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>WHAT YOU&apos;D BUILD YOURSELF</Text>
            <Text style={styles.altIntro}>Without Snowflake, each of these requires separate infrastructure, vendors, and ongoing maintenance:</Text>
            {[
              { what: 'RBAC / IAM', cost: '$50-200K', time: '3-6 months' },
              { what: 'Column-level encryption & masking', cost: '$100-300K', time: '6-12 months' },
              { what: 'Consent-based row filtering', cost: '$80-150K', time: '4-8 months' },
              { what: 'Network perimeter security', cost: '$40-100K', time: '2-4 months' },
              { what: 'Query audit & compliance logging', cost: '$60-120K', time: '3-6 months' },
              { what: 'Key management & rotation', cost: '$30-80K', time: '2-3 months' },
            ].map((item, i) => (
              <View key={i} style={styles.altRow}>
                <Text style={styles.altWhat}>{item.what}</Text>
                <Text style={styles.altCost}>{item.cost}</Text>
                <Text style={styles.altTime}>{item.time}</Text>
              </View>
            ))}
            <View style={styles.altTotalRow}>
              <Text style={styles.altTotalLabel}>Total (build yourself)</Text>
              <Text style={styles.altTotalValue}>$360K-950K / 20-39 months</Text>
            </View>
            <View style={[styles.altTotalRow, { backgroundColor: '#e8f8e8', borderRadius: 8 }]}>
              <Text style={[styles.altTotalLabel, { color: '#27AE60' }]}>With Snowflake</Text>
              <Text style={[styles.altTotalValue, { color: '#27AE60' }]}>Included / Day 1</Text>
            </View>
          </View>
        </>
      )}

      {activeTab === 'rbac' && (
        <>
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>RBAC GRANTS ({grants.length})</Text>
            {uniqueRoles.map(role => {
              const roleGrants = grants.filter(g => g.grantee_name === role && g.granted_to === 'ROLE');
              return (
                <View key={role} style={styles.roleCard}>
                  <View style={styles.roleHeader}>
                    <View style={[styles.roleDot, { backgroundColor: '#29B5E8' }]} />
                    <Text style={styles.roleName}>{role}</Text>
                    <Text style={styles.roleCount}>{roleGrants.length} grants</Text>
                  </View>
                  {roleGrants.map((g, j) => (
                    <View key={j} style={styles.grantRow}>
                      <Text style={styles.grantPriv}>{g.privilege}</Text>
                      <Text style={styles.grantTarget}>{g.name}</Text>
                    </View>
                  ))}
                </View>
              );
            })}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>MASKING POLICIES ({masks.length})</Text>
            {masks.map((m, i) => (
              <View key={i} style={[styles.policyCard, { borderLeftColor: '#8E44AD' }]}>
                <Text style={styles.policyName}>{m.name}</Text>
                <Text style={styles.policyMeta}>{m.database_name}.{m.schema_name} &bull; {m.kind}</Text>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>ROW ACCESS POLICIES ({raps.length})</Text>
            {raps.map((r: any, i: number) => (
              <View key={i} style={[styles.policyCard, { borderLeftColor: '#E67E22' }]}>
                <Text style={styles.policyName}>{r.name}</Text>
                <Text style={styles.policyMeta}>{r.database_name}.{r.schema_name}</Text>
              </View>
            ))}
            {raps.length === 0 && <Text style={styles.emptyText}>No row access policies found</Text>}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>NETWORK POLICIES ({netPols.length})</Text>
            {netPols.map((n, i) => (
              <View key={i} style={[styles.policyCard, { borderLeftColor: '#3498DB' }]}>
                <Text style={styles.policyName}>{n.name}</Text>
                <View style={styles.netDetails}>
                  <Text style={styles.netDetail}>Allow Rules: {n.allowed_network_rules}</Text>
                  <Text style={styles.netDetail}>Block Rules: {n.blocked_network_rules}</Text>
                </View>
              </View>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>DATA SHARES ({shares.length})</Text>
            {shares.map((s, i) => (
              <View key={i} style={[styles.policyCard, { borderLeftColor: '#27AE60' }]}>
                <Text style={styles.policyName}>{s.grantee_name}</Text>
                <Text style={styles.policyMeta}>{s.privilege} on {s.name}</Text>
              </View>
            ))}
          </View>
        </>
      )}

      {activeTab === 'audit' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>QUERY AUDIT &mdash; LAST 7 DAYS</Text>
          <Text style={styles.auditTotal}>{totalQueries.toLocaleString()} total queries across healthcare databases</Text>
          <View style={styles.auditHeader}>
            <Text style={[styles.auditCol, { flex: 2 }]}>Query Type</Text>
            <Text style={[styles.auditCol, { flex: 1, textAlign: 'right' }]}>Count</Text>
            <Text style={[styles.auditCol, { flex: 2, textAlign: 'right' }]}>Latest</Text>
          </View>
          {audit.map((a, i) => {
            const pct = totalQueries > 0 ? (a.count / totalQueries) * 100 : 0;
            return (
              <View key={i} style={styles.auditRow}>
                <View style={[styles.auditBar, { width: `${Math.min(pct, 100)}%` as any }]} />
                <Text style={[styles.auditType, { flex: 2 }]}>{a.query_type}</Text>
                <Text style={[styles.auditCount, { flex: 1, textAlign: 'right' }]}>{a.count.toLocaleString()}</Text>
                <Text style={[styles.auditTime, { flex: 2, textAlign: 'right' }]}>
                  {a.latest ? new Date(a.latest).toLocaleDateString() : '—'}
                </Text>
              </View>
            );
          })}
          {audit.length === 0 && <Text style={styles.emptyText}>No audit data available</Text>}
        </View>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
    padding: 16,
  },
  hero: {
    backgroundColor: '#29B5E8',
    borderRadius: 12,
    padding: 20,
    marginBottom: 16,
  },
  heroTitle: {
    fontSize: 22,
    fontWeight: '800',
    color: '#fff',
    marginBottom: 6,
  },
  heroSubtitle: {
    fontSize: 13,
    color: 'rgba(255,255,255,0.9)',
    lineHeight: 19,
  },
  kpiRow: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    justifyContent: 'space-around',
  },
  kpi: {
    alignItems: 'center',
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '800',
  },
  kpiLabel: {
    fontSize: 9,
    color: '#999',
    marginTop: 2,
    textAlign: 'center',
    fontWeight: '600',
  },
  encryptionBanner: {
    flexDirection: 'row',
    backgroundColor: '#f0faf3',
    borderRadius: 12,
    padding: 14,
    marginBottom: 12,
    borderWidth: 1,
    borderColor: '#d4efdf',
    alignItems: 'center',
    gap: 12,
  },
  encryptionIcon: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: '#27AE60',
    alignItems: 'center',
    justifyContent: 'center',
  },
  encryptionIconText: {
    fontSize: 18,
  },
  encryptionTitle: {
    fontSize: 14,
    fontWeight: '700',
    color: '#27AE60',
    marginBottom: 2,
  },
  encryptionDesc: {
    fontSize: 11,
    color: '#555',
    lineHeight: 16,
  },
  tabRow: {
    flexDirection: 'row',
    backgroundColor: '#e8e8e8',
    borderRadius: 10,
    padding: 3,
    marginBottom: 16,
    alignItems: 'center',
  },
  tab: {
    flex: 1,
    paddingVertical: 10,
    alignItems: 'center',
    borderRadius: 8,
  },
  tabActive: {
    backgroundColor: '#fff',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  tabText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#999',
  },
  tabTextActive: {
    color: '#29B5E8',
  },
  refreshBtn: {
    paddingHorizontal: 12,
    paddingVertical: 8,
    marginLeft: 4,
  },
  refreshText: {
    fontSize: 11,
    fontWeight: '600',
    color: '#29B5E8',
  },
  section: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: '700',
    color: '#999',
    letterSpacing: 1,
    marginBottom: 12,
  },
  featureCard: {
    backgroundColor: '#fafbfc',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  featureTitle: {
    fontSize: 13,
    fontWeight: '700',
    marginBottom: 3,
  },
  featureDesc: {
    fontSize: 12,
    color: '#555',
    lineHeight: 17,
  },
  altIntro: {
    fontSize: 12,
    color: '#666',
    marginBottom: 12,
    lineHeight: 17,
  },
  altRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  altWhat: {
    flex: 3,
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  altCost: {
    flex: 2,
    fontSize: 12,
    color: '#E74C3C',
    fontWeight: '600',
    textAlign: 'right',
  },
  altTime: {
    flex: 2,
    fontSize: 11,
    color: '#999',
    textAlign: 'right',
  },
  altTotalRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    paddingVertical: 10,
    marginTop: 8,
  },
  altTotalLabel: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E74C3C',
  },
  altTotalValue: {
    fontSize: 13,
    fontWeight: '700',
    color: '#E74C3C',
  },
  roleCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
  },
  roleHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
    gap: 8,
  },
  roleDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  roleName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    flex: 1,
  },
  roleCount: {
    fontSize: 11,
    color: '#999',
  },
  grantRow: {
    flexDirection: 'row',
    paddingVertical: 3,
    paddingLeft: 16,
    gap: 8,
  },
  grantPriv: {
    fontSize: 11,
    fontWeight: '600',
    color: '#29B5E8',
    width: 80,
  },
  grantTarget: {
    fontSize: 11,
    color: '#666',
    flex: 1,
  },
  policyCard: {
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
    padding: 12,
    marginBottom: 8,
    borderLeftWidth: 4,
  },
  policyName: {
    fontSize: 13,
    fontWeight: '700',
    color: '#333',
    marginBottom: 2,
  },
  policyMeta: {
    fontSize: 11,
    color: '#999',
  },
  netDetails: {
    flexDirection: 'row',
    gap: 16,
    marginTop: 4,
  },
  netDetail: {
    fontSize: 11,
    color: '#666',
  },
  emptyText: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    paddingVertical: 12,
  },
  auditTotal: {
    fontSize: 13,
    color: '#333',
    fontWeight: '600',
    marginBottom: 12,
  },
  auditHeader: {
    flexDirection: 'row',
    paddingVertical: 6,
    borderBottomWidth: 2,
    borderBottomColor: '#e0e0e0',
  },
  auditCol: {
    fontSize: 10,
    fontWeight: '700',
    color: '#999',
    textTransform: 'uppercase',
  },
  auditRow: {
    flexDirection: 'row',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f5f5f5',
    alignItems: 'center',
    position: 'relative',
  },
  auditBar: {
    position: 'absolute',
    left: 0,
    top: 0,
    bottom: 0,
    backgroundColor: 'rgba(41,181,232,0.08)',
    borderRadius: 2,
  },
  auditType: {
    fontSize: 12,
    color: '#333',
    fontWeight: '500',
  },
  auditCount: {
    fontSize: 12,
    color: '#29B5E8',
    fontWeight: '700',
  },
  auditTime: {
    fontSize: 11,
    color: '#999',
  },
});
