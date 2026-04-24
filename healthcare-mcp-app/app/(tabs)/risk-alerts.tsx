import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  TextInput,
  ActivityIndicator,
  Platform,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getMCPClient, initMCPClient } from '@/services/mcp-client';

interface Alert {
  PERSON_ID: string;
  SAMPLE_ID: string;
  PATIENT_NAME: string;
  METABOLIZER_PHENOTYPE: string;
  RISK_TIER: string;
  DOMINANT_ANCESTRY: string;
  COMMUNITY_ID: number;
  COMMUNITY_SIZE: number;
  CENTRALITY_SCORE: number;
  CURRENT_PGX_DRUG: string;
  CONDITION_COUNT: number;
  VISIT_COUNT: number;
  HIGH_SIM_NEIGHBORS: number;
  ALERT_PRIORITY: string;
  RECOMMENDED_ACTION: string;
}

interface AlertSummary {
  total: number;
  high: number;
  moderate: number;
  standard: number;
  phenotypes: number;
  communities: number;
}

const PRIORITY_CONFIG: Record<string, { color: string; bg: string; icon: string }> = {
  HIGH: { color: '#DC2626', bg: '#FEF2F2', icon: 'alert-circle' },
  MODERATE: { color: '#D97706', bg: '#FFFBEB', icon: 'warning' },
  STANDARD: { color: '#2563EB', bg: '#EFF6FF', icon: 'information-circle' },
};

const ANCESTRY_COLORS: Record<string, string> = {
  EUR: '#4A90D9',
  AFR: '#E67E22',
  EAS: '#27AE60',
  SAS: '#8E44AD',
  AMR: '#E74C3C',
};

const PHENOTYPE_LABELS: Record<string, { short: string; color: string }> = {
  'Poor Metabolizer': { short: 'PM', color: '#DC2626' },
  'Intermediate Metabolizer': { short: 'IM', color: '#D97706' },
  'Ultrarapid Metabolizer': { short: 'UM', color: '#7C3AED' },
  'Rapid Metabolizer': { short: 'RM', color: '#2563EB' },
  'Normal Metabolizer': { short: 'NM', color: '#059669' },
};

export default function RiskAlertsScreen() {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [summary, setSummary] = useState<AlertSummary | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [activeFilter, setActiveFilter] = useState<string>('ALL');
  const [searchText, setSearchText] = useState('');
  const [expandedAlert, setExpandedAlert] = useState<string | null>(null);
  const [activeView, setActiveView] = useState<'list' | 'heatmap'>('list');

  const getActiveRole = () =>
    Platform.OS === 'web'
      ? localStorage.getItem('snowflake_active_role') || undefined
      : undefined;

  useEffect(() => {
    const client = getMCPClient();
    if (!client) {
      const pat =
        Platform.OS === 'web'
          ? localStorage.getItem('snowflake_pat')
          : null;
      if (pat) {
        initMCPClient(pat);
      } else {
        setTimeout(() => router.replace('/'), 0);
        return;
      }
    }
    loadAlerts();
  }, []);

  const loadAlerts = async () => {
    setIsLoading(true);
    setError(null);
    try {
      const client = getMCPClient();
      if (!client) return;

      const [alertData, summaryData] = await Promise.all([
        client.executeSQL(
          `SELECT PERSON_ID, SAMPLE_ID, PATIENT_NAME, METABOLIZER_PHENOTYPE,
                  RISK_TIER, DOMINANT_ANCESTRY, COMMUNITY_ID, COMMUNITY_SIZE,
                  CENTRALITY_SCORE, CURRENT_PGX_DRUG, CONDITION_COUNT, VISIT_COUNT,
                  HIGH_SIM_NEIGHBORS, ALERT_PRIORITY, RECOMMENDED_ACTION
           FROM CORTEX_CODE_DEMO.RAW_DATA.PHARMACOGENOMIC_ALERTS
           ORDER BY CASE ALERT_PRIORITY WHEN 'HIGH' THEN 1 WHEN 'MODERATE' THEN 2 ELSE 3 END,
                    HIGH_SIM_NEIGHBORS DESC
           LIMIT 500`,
          30,
          getActiveRole(),
        ),
        client.executeSQL(
          `SELECT
              COUNT(*) AS TOTAL,
              COUNT(CASE WHEN ALERT_PRIORITY = 'HIGH' THEN 1 END) AS HIGH_COUNT,
              COUNT(CASE WHEN ALERT_PRIORITY = 'MODERATE' THEN 1 END) AS MODERATE_COUNT,
              COUNT(CASE WHEN ALERT_PRIORITY = 'STANDARD' THEN 1 END) AS STANDARD_COUNT,
              COUNT(DISTINCT METABOLIZER_PHENOTYPE) AS PHENOTYPES,
              COUNT(DISTINCT COMMUNITY_ID) AS COMMUNITIES
           FROM CORTEX_CODE_DEMO.RAW_DATA.PHARMACOGENOMIC_ALERTS`,
          15,
          getActiveRole(),
        ),
      ]);

      setAlerts(alertData as unknown as Alert[]);
      const s = summaryData[0] as any;
      setSummary({
        total: Number(s.TOTAL),
        high: Number(s.HIGH_COUNT),
        moderate: Number(s.MODERATE_COUNT),
        standard: Number(s.STANDARD_COUNT),
        phenotypes: Number(s.PHENOTYPES),
        communities: Number(s.COMMUNITIES),
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load alerts');
    } finally {
      setIsLoading(false);
    }
  };

  const filteredAlerts = alerts.filter((a) => {
    if (activeFilter !== 'ALL' && a.ALERT_PRIORITY !== activeFilter) return false;
    if (searchText.trim()) {
      const q = searchText.toLowerCase();
      return (
        a.PATIENT_NAME.toLowerCase().includes(q) ||
        a.SAMPLE_ID.toLowerCase().includes(q) ||
        a.METABOLIZER_PHENOTYPE.toLowerCase().includes(q) ||
        a.DOMINANT_ANCESTRY.toLowerCase().includes(q)
      );
    }
    return true;
  });

  const heatmapData = () => {
    const phenotypes = ['Poor Metabolizer', 'Intermediate Metabolizer', 'Ultrarapid Metabolizer', 'Rapid Metabolizer'];
    const ancestries = ['EUR', 'AFR', 'EAS', 'SAS', 'AMR'];
    const counts: Record<string, number> = {};
    let max = 0;
    for (const a of alerts) {
      const key = `${a.METABOLIZER_PHENOTYPE}|${a.DOMINANT_ANCESTRY}`;
      counts[key] = (counts[key] || 0) + 1;
      if (counts[key] > max) max = counts[key];
    }
    return { phenotypes, ancestries, counts, max };
  };

  const getHeatColor = (count: number, max: number) => {
    if (count === 0) return '#f9fafb';
    const intensity = count / max;
    if (intensity > 0.7) return '#DC2626';
    if (intensity > 0.4) return '#F59E0B';
    if (intensity > 0.15) return '#FBBF24';
    return '#FEF3C7';
  };

  const getPriorityConfig = (priority: string) =>
    PRIORITY_CONFIG[priority] || PRIORITY_CONFIG.STANDARD;

  const getPhenotypeLabel = (phenotype: string) =>
    PHENOTYPE_LABELS[phenotype] || { short: '??', color: '#666' };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="alert-circle" size={20} color="#DC2626" />
        <Text style={styles.headerTitle}>Pharmacogenomic Risk Alerts</Text>
      </View>
      <Text style={styles.headerSubtitle}>
        CYP2C19 metabolizer phenotype alerts across genomic communities — Graph-to-Value output
      </Text>
      <View style={styles.forgeBadge}>
        <Ionicons name="flash" size={12} color="#92400E" />
        <Text style={styles.forgeBadgeText}>FORGE PATTERN: Precomputed → Materialized → Query with SQL</Text>
      </View>

      {isLoading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#DC2626" />
          <Text style={styles.loadingText}>Loading pharmacogenomic alerts...</Text>
        </View>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color="#DC3545" />
          <Text style={styles.errorText}>{error}</Text>
          <TouchableOpacity onPress={loadAlerts}>
            <Text style={styles.retryText}>Retry</Text>
          </TouchableOpacity>
        </View>
      )}

      {summary && !isLoading && (
        <>
          <View style={styles.summaryRow}>
            <TouchableOpacity
              style={[styles.summaryCard, styles.summaryCardHigh, activeFilter === 'HIGH' && styles.summaryCardSelected]}
              onPress={() => setActiveFilter(activeFilter === 'HIGH' ? 'ALL' : 'HIGH')}
            >
              <Ionicons name="alert-circle" size={22} color="#DC2626" />
              <Text style={styles.summaryValue}>{summary.high}</Text>
              <Text style={styles.summaryLabel}>HIGH</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.summaryCard, styles.summaryCardModerate, activeFilter === 'MODERATE' && styles.summaryCardSelected]}
              onPress={() => setActiveFilter(activeFilter === 'MODERATE' ? 'ALL' : 'MODERATE')}
            >
              <Ionicons name="warning" size={22} color="#D97706" />
              <Text style={[styles.summaryValue, { color: '#D97706' }]}>{summary.moderate}</Text>
              <Text style={styles.summaryLabel}>MODERATE</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.summaryCard, styles.summaryCardStandard, activeFilter === 'STANDARD' && styles.summaryCardSelected]}
              onPress={() => setActiveFilter(activeFilter === 'STANDARD' ? 'ALL' : 'STANDARD')}
            >
              <Ionicons name="information-circle" size={22} color="#2563EB" />
              <Text style={[styles.summaryValue, { color: '#2563EB' }]}>{summary.standard}</Text>
              <Text style={styles.summaryLabel}>STANDARD</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.statsRow}>
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{summary.total.toLocaleString()}</Text>
              <Text style={styles.statLabel}>Total Alerts</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{summary.phenotypes}</Text>
              <Text style={styles.statLabel}>Phenotypes</Text>
            </View>
            <View style={styles.statDivider} />
            <View style={styles.statItem}>
              <Text style={styles.statValue}>{summary.communities}</Text>
              <Text style={styles.statLabel}>Communities</Text>
            </View>
          </View>

          <View style={styles.viewToggle}>
            <TouchableOpacity
              style={[styles.viewToggleBtn, activeView === 'list' && styles.viewToggleBtnActive]}
              onPress={() => setActiveView('list')}
            >
              <Ionicons name="list" size={16} color={activeView === 'list' ? '#fff' : '#DC2626'} />
              <Text style={[styles.viewToggleText, activeView === 'list' && styles.viewToggleTextActive]}>Alert List</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.viewToggleBtn, activeView === 'heatmap' && styles.viewToggleBtnActive]}
              onPress={() => setActiveView('heatmap')}
            >
              <Ionicons name="grid" size={16} color={activeView === 'heatmap' ? '#fff' : '#DC2626'} />
              <Text style={[styles.viewToggleText, activeView === 'heatmap' && styles.viewToggleTextActive]}>Risk Heatmap</Text>
            </TouchableOpacity>
          </View>

          {activeView === 'heatmap' && (() => {
            const { phenotypes, ancestries, counts, max } = heatmapData();
            return (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>
                  <Ionicons name="grid" size={16} color="#DC2626" /> Phenotype × Ancestry Risk Matrix
                </Text>
                <ScrollView horizontal showsHorizontalScrollIndicator={false}>
                  <View>
                    <View style={styles.heatRow}>
                      <View style={styles.heatLabelCell} />
                      {ancestries.map((anc) => (
                        <View key={anc} style={styles.heatHeaderCell}>
                          <View style={[styles.ancDot, { backgroundColor: ANCESTRY_COLORS[anc] }]} />
                          <Text style={styles.heatHeaderText}>{anc}</Text>
                        </View>
                      ))}
                      <View style={styles.heatHeaderCell}>
                        <Text style={styles.heatHeaderText}>Total</Text>
                      </View>
                    </View>
                    {phenotypes.map((ph) => {
                      const phLabel = getPhenotypeLabel(ph);
                      const rowTotal = ancestries.reduce((s, a) => s + (counts[`${ph}|${a}`] || 0), 0);
                      return (
                        <View key={ph} style={styles.heatRow}>
                          <View style={styles.heatLabelCell}>
                            <View style={[styles.phenoBadge, { backgroundColor: phLabel.color + '20' }]}>
                              <Text style={[styles.phenoBadgeText, { color: phLabel.color }]}>{phLabel.short}</Text>
                            </View>
                            <Text style={styles.heatLabelText} numberOfLines={1}>{ph.replace(' Metabolizer', '')}</Text>
                          </View>
                          {ancestries.map((anc) => {
                            const count = counts[`${ph}|${anc}`] || 0;
                            return (
                              <View key={anc} style={[styles.heatCell, { backgroundColor: getHeatColor(count, max) }]}>
                                <Text style={[styles.heatCellText, count > max * 0.5 && { color: '#fff' }]}>
                                  {count || '—'}
                                </Text>
                              </View>
                            );
                          })}
                          <View style={[styles.heatCell, { backgroundColor: '#f3f4f6' }]}>
                            <Text style={[styles.heatCellText, { fontWeight: '700' }]}>{rowTotal}</Text>
                          </View>
                        </View>
                      );
                    })}
                  </View>
                </ScrollView>
                <Text style={styles.heatmapNote}>Tap a summary card above to filter by priority level</Text>
              </View>
            );
          })()}

          {activeView === 'list' && (
            <View style={styles.section}>
              <View style={styles.searchContainer}>
                <Ionicons name="search" size={16} color="#999" style={{ marginRight: 8 }} />
                <TextInput
                  style={styles.searchInput}
                  placeholder="Search by name, sample ID, phenotype, ancestry..."
                  placeholderTextColor="#999"
                  value={searchText}
                  onChangeText={setSearchText}
                />
                {searchText.length > 0 && (
                  <TouchableOpacity onPress={() => setSearchText('')}>
                    <Ionicons name="close-circle" size={18} color="#999" />
                  </TouchableOpacity>
                )}
              </View>

              <Text style={styles.resultCount}>
                {filteredAlerts.length} alerts{activeFilter !== 'ALL' ? ` (${activeFilter})` : ''}
                {searchText ? ` matching "${searchText}"` : ''}
              </Text>

              {filteredAlerts.slice(0, 50).map((alert) => {
                const config = getPriorityConfig(alert.ALERT_PRIORITY);
                const phLabel = getPhenotypeLabel(alert.METABOLIZER_PHENOTYPE);
                const isExpanded = expandedAlert === alert.SAMPLE_ID;

                return (
                  <TouchableOpacity
                    key={alert.SAMPLE_ID}
                    style={[styles.alertCard, { borderLeftColor: config.color }]}
                    onPress={() => setExpandedAlert(isExpanded ? null : alert.SAMPLE_ID)}
                  >
                    <View style={styles.alertCardHeader}>
                      <View style={{ flex: 1 }}>
                        <View style={styles.alertTitleRow}>
                          <Ionicons name={config.icon as any} size={16} color={config.color} />
                          <Text style={styles.alertName}>{alert.PATIENT_NAME}</Text>
                          <View style={[styles.priorityBadge, { backgroundColor: config.bg }]}>
                            <Text style={[styles.priorityBadgeText, { color: config.color }]}>{alert.ALERT_PRIORITY}</Text>
                          </View>
                        </View>
                        <View style={styles.alertMeta}>
                          <Text style={styles.alertMetaText}>{alert.SAMPLE_ID}</Text>
                          <View style={[styles.phenoChip, { backgroundColor: phLabel.color + '15' }]}>
                            <Text style={[styles.phenoChipText, { color: phLabel.color }]}>{phLabel.short}</Text>
                          </View>
                          <View style={[styles.ancChip, { backgroundColor: (ANCESTRY_COLORS[alert.DOMINANT_ANCESTRY] || '#999') + '15' }]}>
                            <Text style={[styles.ancChipText, { color: ANCESTRY_COLORS[alert.DOMINANT_ANCESTRY] || '#999' }]}>
                              {alert.DOMINANT_ANCESTRY}
                            </Text>
                          </View>
                          <Text style={styles.alertMetaText}>C{alert.COMMUNITY_ID}</Text>
                        </View>
                      </View>
                      <Ionicons name={isExpanded ? 'chevron-up' : 'chevron-down'} size={18} color="#999" />
                    </View>

                    <View style={[styles.actionBox, { backgroundColor: config.bg }]}>
                      <Text style={[styles.actionText, { color: config.color }]}>{alert.RECOMMENDED_ACTION}</Text>
                    </View>

                    {isExpanded && (
                      <View style={styles.alertDetails}>
                        <View style={styles.detailGrid}>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Phenotype</Text>
                            <Text style={styles.detailValue}>{alert.METABOLIZER_PHENOTYPE}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Risk Tier</Text>
                            <Text style={styles.detailValue}>{alert.RISK_TIER}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Community</Text>
                            <Text style={styles.detailValue}>#{alert.COMMUNITY_ID} ({alert.COMMUNITY_SIZE} patients)</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Similar Neighbors</Text>
                            <Text style={styles.detailValue}>{Number(alert.HIGH_SIM_NEIGHBORS).toLocaleString()}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Centrality Score</Text>
                            <Text style={styles.detailValue}>{Number(alert.CENTRALITY_SCORE).toFixed(4)}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Ancestry</Text>
                            <Text style={styles.detailValue}>{alert.DOMINANT_ANCESTRY}</Text>
                          </View>
                          {alert.CURRENT_PGX_DRUG ? (
                            <View style={styles.detailItem}>
                              <Text style={styles.detailLabel}>Current PGx Drug</Text>
                              <Text style={[styles.detailValue, { color: '#DC2626', fontWeight: '700' }]}>{alert.CURRENT_PGX_DRUG}</Text>
                            </View>
                          ) : null}
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Conditions</Text>
                            <Text style={styles.detailValue}>{alert.CONDITION_COUNT}</Text>
                          </View>
                          <View style={styles.detailItem}>
                            <Text style={styles.detailLabel}>Visits</Text>
                            <Text style={styles.detailValue}>{alert.VISIT_COUNT}</Text>
                          </View>
                        </View>
                      </View>
                    )}
                  </TouchableOpacity>
                );
              })}

              {filteredAlerts.length > 50 && (
                <Text style={styles.moreText}>+ {filteredAlerts.length - 50} more alerts</Text>
              )}
            </View>
          )}
        </>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  header: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 4 },
  headerTitle: { fontSize: 18, fontWeight: '700', color: '#333', marginLeft: 8 },
  headerSubtitle: { fontSize: 12, color: '#888', paddingHorizontal: 16, marginBottom: 8 },
  forgeBadge: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start', backgroundColor: '#FEF3C7' },
  forgeBadgeText: { fontSize: 10, fontWeight: '700', marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5, color: '#92400E' },
  loadingBox: { alignItems: 'center', padding: 32, margin: 12, backgroundColor: '#fff', borderRadius: 12 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#DC2626', fontWeight: '500' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fde8e8', padding: 12, margin: 12, borderRadius: 8 },
  errorText: { flex: 1, marginLeft: 8, fontSize: 13, color: '#DC3545' },
  retryText: { color: '#DC2626', fontWeight: '700', fontSize: 13, marginLeft: 8 },
  summaryRow: { flexDirection: 'row', marginHorizontal: 12, gap: 8, marginBottom: 8 },
  summaryCard: { flex: 1, alignItems: 'center', padding: 14, borderRadius: 12, borderWidth: 2, borderColor: 'transparent' },
  summaryCardHigh: { backgroundColor: '#FEF2F2' },
  summaryCardModerate: { backgroundColor: '#FFFBEB' },
  summaryCardStandard: { backgroundColor: '#EFF6FF' },
  summaryCardSelected: { borderColor: '#333', borderWidth: 2 },
  summaryValue: { fontSize: 28, fontWeight: '800', color: '#DC2626', marginTop: 4 },
  summaryLabel: { fontSize: 10, fontWeight: '700', color: '#666', letterSpacing: 1, marginTop: 2 },
  statsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#fff', marginHorizontal: 12, marginBottom: 8, padding: 12, borderRadius: 12 },
  statItem: { alignItems: 'center', flex: 1 },
  statValue: { fontSize: 20, fontWeight: '700', color: '#333' },
  statLabel: { fontSize: 10, color: '#999', marginTop: 2 },
  statDivider: { width: 1, height: 30, backgroundColor: '#eee' },
  viewToggle: { flexDirection: 'row', marginHorizontal: 12, backgroundColor: '#FEF2F2', borderRadius: 10, padding: 3, marginBottom: 8 },
  viewToggleBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8 },
  viewToggleBtnActive: { backgroundColor: '#DC2626' },
  viewToggleText: { fontSize: 13, fontWeight: '600', color: '#DC2626', marginLeft: 6 },
  viewToggleTextActive: { color: '#fff' },
  section: { backgroundColor: '#fff', margin: 12, padding: 16, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 12 },
  searchContainer: { flexDirection: 'row', alignItems: 'center', padding: 10, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa', marginBottom: 10 },
  searchInput: { flex: 1, fontSize: 14, color: '#333', padding: 0 },
  resultCount: { fontSize: 12, color: '#888', marginBottom: 10 },
  alertCard: { padding: 14, backgroundColor: '#fafafa', borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#eee', borderLeftWidth: 4 },
  alertCardHeader: { flexDirection: 'row', alignItems: 'flex-start' },
  alertTitleRow: { flexDirection: 'row', alignItems: 'center', gap: 6, marginBottom: 4 },
  alertName: { fontSize: 15, fontWeight: '600', color: '#333' },
  priorityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  priorityBadgeText: { fontSize: 10, fontWeight: '700', letterSpacing: 0.5 },
  alertMeta: { flexDirection: 'row', alignItems: 'center', gap: 6, flexWrap: 'wrap' },
  alertMetaText: { fontSize: 11, color: '#888' },
  phenoChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  phenoChipText: { fontSize: 10, fontWeight: '700' },
  ancChip: { paddingHorizontal: 6, paddingVertical: 1, borderRadius: 6 },
  ancChipText: { fontSize: 10, fontWeight: '700' },
  actionBox: { marginTop: 8, padding: 10, borderRadius: 8 },
  actionText: { fontSize: 12, fontWeight: '500', lineHeight: 18 },
  alertDetails: { marginTop: 12, paddingTop: 12, borderTopWidth: 1, borderTopColor: '#eee' },
  detailGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  detailItem: { width: '50%', marginBottom: 10 },
  detailLabel: { fontSize: 10, color: '#999', textTransform: 'uppercase', letterSpacing: 0.5 },
  detailValue: { fontSize: 13, color: '#333', fontWeight: '500', marginTop: 2 },
  moreText: { textAlign: 'center', fontSize: 12, color: '#888', fontStyle: 'italic', marginTop: 8 },
  heatRow: { flexDirection: 'row' },
  heatLabelCell: { width: 130, paddingVertical: 8, paddingHorizontal: 6, flexDirection: 'row', alignItems: 'center' },
  heatLabelText: { fontSize: 11, color: '#333', fontWeight: '500', marginLeft: 6 },
  heatHeaderCell: { width: 60, alignItems: 'center', justifyContent: 'center', paddingVertical: 6, flexDirection: 'row', gap: 3 },
  heatHeaderText: { fontSize: 11, fontWeight: '700', color: '#333' },
  heatCell: { width: 60, height: 44, alignItems: 'center', justifyContent: 'center', borderWidth: 1, borderColor: '#fff', borderRadius: 4 },
  heatCellText: { fontSize: 13, fontWeight: '600', color: '#333' },
  heatmapNote: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 10, fontStyle: 'italic' },
  phenoBadge: { width: 28, height: 20, borderRadius: 6, alignItems: 'center', justifyContent: 'center' },
  phenoBadgeText: { fontSize: 10, fontWeight: '800' },
  ancDot: { width: 8, height: 8, borderRadius: 4 },
});
