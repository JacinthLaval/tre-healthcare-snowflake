import React, { useState, useCallback, useEffect } from 'react';
import { View, Text, StyleSheet, ScrollView, TouchableOpacity, Platform, ActivityIndicator } from 'react-native';
import { router } from 'expo-router';
import { ChatInterface } from '@/components/ChatInterface';
import { ChatMessage, ToolCallResult } from '@/types/mcp';
import { getMCPClient, initMCPClient, validateSQL } from '@/services/mcp-client';
import GovernanceBadge from '@/components/GovernanceBadge';
import {
  fetchPopulationCensus,
  fetchConditionPrevalence,
  fetchMortalityByRegion,
  fetchAgeDistribution,
  fetchCareCoordination,
} from '@/services/population-queries';

type SubTab = 'population' | 'coordination' | 'research';

interface CensusData {
  TOTAL_PATIENTS: number;
  MALE_COUNT: number;
  FEMALE_COUNT: number;
  BLACK_COUNT: number;
  WHITE_COUNT: number;
  HISPANIC_COUNT: number;
  ASIAN_COUNT: number;
  OTHER_RACE_COUNT: number;
  AVG_AGE: number;
  MEDIAN_AGE: number;
  TOTAL_DEATHS: number;
  MORTALITY_RATE_PER_1000: number;
}

interface ConditionRow {
  CONDITION_CONCEPT_ID: number;
  CONDITION_NAME: string;
  PATIENT_COUNT: number;
  PREVALENCE_PCT: number;
}

interface MortalityRow {
  COUNTY: string;
  TOTAL_PATIENTS: number;
  DEATHS: number;
  MORTALITY_RATE_PER_1000: number;
  SDOH_VULNERABILITY_SCORE: number;
  POVERTY_PCT: number;
}

interface AgeRow {
  AGE_GROUP: string;
  PATIENT_COUNT: number;
  DEATHS: number;
}

interface CoordinationRow {
  PERSON_ID: number;
  PATIENT_NAME: string;
  AGE: number;
  COUNTY: string;
  RISK_TIER: string;
  CONDITION_COUNT: number;
  TOP_CONDITIONS: string;
  SDOH_VULNERABILITY: number;
  INTERVENTIONS: string;
}

export default function OmopScreen() {
  const [activeTab, setActiveTab] = useState<SubTab>('population');
  const [census, setCensus] = useState<CensusData | null>(null);
  const [conditions, setConditions] = useState<ConditionRow[]>([]);
  const [mortality, setMortality] = useState<MortalityRow[]>([]);
  const [ageData, setAgeData] = useState<AgeRow[]>([]);
  const [coordination, setCoordination] = useState<CoordinationRow[]>([]);
  const [coordFilter, setCoordFilter] = useState<string | undefined>(undefined);
  const [isLoadingPop, setIsLoadingPop] = useState(false);
  const [isLoadingCoord, setIsLoadingCoord] = useState(false);

  const [messages, setMessages] = useState<ChatMessage[]>([
    {
      id: '1',
      role: 'assistant',
      content: 'Hello! I can help you analyze TRE healthcare data in OMOP CDM format. Ask me about patient demographics, visits, conditions, medications, and procedures.',
      timestamp: new Date(),
    },
  ]);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingSql, setPendingSql] = useState<Map<string, string>>(new Map());

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

  useEffect(() => {
    if (activeTab === 'population' && !census) {
      loadPopulationData();
    }
    if (activeTab === 'coordination' && coordination.length === 0) {
      loadCoordinationData();
    }
  }, [activeTab]);

  const loadPopulationData = async () => {
    setIsLoadingPop(true);
    try {
      const [censusRes, condRes, mortRes, ageRes] = await Promise.all([
        fetchPopulationCensus(),
        fetchConditionPrevalence(),
        fetchMortalityByRegion(),
        fetchAgeDistribution(),
      ]);
      if (censusRes && censusRes.length > 0) setCensus(censusRes[0] as unknown as CensusData);
      setConditions((condRes || []) as unknown as ConditionRow[]);
      setMortality((mortRes || []) as unknown as MortalityRow[]);
      setAgeData((ageRes || []) as unknown as AgeRow[]);
    } catch (err) {
      console.error('Failed to load population data:', err);
    } finally {
      setIsLoadingPop(false);
    }
  };

  const loadCoordinationData = async (filter?: string) => {
    setIsLoadingCoord(true);
    try {
      const res = await fetchCareCoordination(filter);
      setCoordination((res || []) as unknown as CoordinationRow[]);
    } catch (err) {
      console.error('Failed to load coordination data:', err);
    } finally {
      setIsLoadingCoord(false);
    }
  };

  const handleConfirmSQL = useCallback(async (messageId: string) => {
    const sql = pendingSql.get(messageId);
    if (!sql) return;
    setPendingSql((prev) => { const next = new Map(prev); next.delete(messageId); return next; });
    setMessages((prev) => prev.map((m) => m.id === messageId ? { ...m, sqlPending: false } : m));
    setIsLoading(true);
    try {
      const client = getMCPClient();
      if (!client) throw new Error('Not connected');
      const data = await client.executeSQL(sql);
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
      const result = await client.askOmop(text);
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
        content: parseResponse(result) + (sqlBlocked ? '\n\n\ud83d\udee1\ufe0f This query was blocked by the guardrail \u2014 only SELECT statements are allowed.' : ''),
        sql: sql,
        sqlPending: sql && !sqlBlocked ? true : false,
        sqlBlocked,
        data: undefined,
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

  const riskTiers = ['CRITICAL', 'HIGH', 'MODERATE', 'LOW'];
  const tierColors: Record<string, string> = { CRITICAL: '#e74c3c', HIGH: '#e67e22', MODERATE: '#f1c40f', LOW: '#27ae60' };

  const renderPopulation = () => {
    if (isLoadingPop) {
      return <View style={styles.center}><ActivityIndicator size="large" color="#29B5E8" /><Text style={styles.loadingText}>Loading population data...</Text></View>;
    }
    if (!census) {
      return <View style={styles.center}><Text style={styles.noData}>No population data available</Text></View>;
    }
    return (
      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollPadding}>
        <View style={styles.kpiRow}>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{census.TOTAL_PATIENTS?.toLocaleString()}</Text>
            <Text style={styles.kpiLabel}>Total Patients</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={[styles.kpiValue, { color: '#e74c3c' }]}>{census.MORTALITY_RATE_PER_1000}</Text>
            <Text style={styles.kpiLabel}>Mortality / 1000</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{census.TOTAL_DEATHS}</Text>
            <Text style={styles.kpiLabel}>Total Deaths</Text>
          </View>
          <View style={styles.kpiCard}>
            <Text style={styles.kpiValue}>{Math.round(census.AVG_AGE || 0)}</Text>
            <Text style={styles.kpiLabel}>Avg Age</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Demographics</Text>
        <View style={styles.card}>
          <View style={styles.barGroup}>
            <Text style={styles.barLabel}>Gender</Text>
            <View style={styles.barContainer}>
              <View style={[styles.barFill, { flex: census.FEMALE_COUNT, backgroundColor: '#e84393' }]} />
              <View style={[styles.barFill, { flex: census.MALE_COUNT, backgroundColor: '#0984e3' }]} />
            </View>
            <Text style={styles.barLegend}>Female {((census.FEMALE_COUNT / census.TOTAL_PATIENTS) * 100).toFixed(0)}% | Male {((census.MALE_COUNT / census.TOTAL_PATIENTS) * 100).toFixed(0)}%</Text>
          </View>
          <View style={styles.barGroup}>
            <Text style={styles.barLabel}>Race</Text>
            <View style={styles.barContainer}>
              <View style={[styles.barFill, { flex: census.WHITE_COUNT || 0, backgroundColor: '#74b9ff' }]} />
              <View style={[styles.barFill, { flex: census.BLACK_COUNT || 0, backgroundColor: '#a29bfe' }]} />
              <View style={[styles.barFill, { flex: census.HISPANIC_COUNT || 0, backgroundColor: '#fd79a8' }]} />
              <View style={[styles.barFill, { flex: (census.ASIAN_COUNT || 0) + (census.OTHER_RACE_COUNT || 0), backgroundColor: '#ffeaa7' }]} />
            </View>
            <Text style={styles.barLegend}>White {((census.WHITE_COUNT / census.TOTAL_PATIENTS) * 100).toFixed(0)}% | Black {((census.BLACK_COUNT / census.TOTAL_PATIENTS) * 100).toFixed(0)}% | Hispanic {(((census.HISPANIC_COUNT || 0) / census.TOTAL_PATIENTS) * 100).toFixed(0)}% | Other {((((census.ASIAN_COUNT || 0) + (census.OTHER_RACE_COUNT || 0)) / census.TOTAL_PATIENTS) * 100).toFixed(0)}%</Text>
          </View>
        </View>

        <Text style={styles.sectionTitle}>Age Distribution</Text>
        <View style={styles.card}>
          {ageData.map((row) => (
            <View key={row.AGE_GROUP} style={styles.ageRow}>
              <Text style={styles.ageLabel}>{row.AGE_GROUP}</Text>
              <View style={styles.ageBarOuter}>
                <View style={[styles.ageBarInner, { width: `${Math.min((row.PATIENT_COUNT / (census?.TOTAL_PATIENTS || 1)) * 100 * 3, 100)}%` }]} />
              </View>
              <Text style={styles.ageCount}>{row.PATIENT_COUNT?.toLocaleString()}</Text>
              {row.DEATHS > 0 && <Text style={styles.ageDeaths}>{row.DEATHS}d</Text>}
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Top Conditions</Text>
        <View style={styles.card}>
          {conditions.slice(0, 10).map((c, i) => (
            <View key={i} style={styles.condRow}>
              <View style={styles.condRank}><Text style={styles.condRankText}>{i + 1}</Text></View>
              <View style={styles.condInfo}>
                <Text style={styles.condName} numberOfLines={1}>{c.CONDITION_NAME}</Text>
                <Text style={styles.condDetail}>{c.PATIENT_COUNT?.toLocaleString()} patients ({c.PREVALENCE_PCT}%)</Text>
              </View>
              <View style={[styles.condBar, { width: `${Math.min(c.PREVALENCE_PCT * 2, 100)}%` }]} />
            </View>
          ))}
        </View>

        <Text style={styles.sectionTitle}>Top 10 Counties by Mortality</Text>
        <View style={styles.card}>
          {mortality.slice(0, 10).map((m, i) => (
            <View key={i} style={styles.countyRow}>
              <Text style={styles.countyName}>{m.COUNTY}</Text>
              <Text style={styles.countyRate}>{m.MORTALITY_RATE_PER_1000}/1K</Text>
              <View style={[styles.sdohBadge, { backgroundColor: (m.SDOH_VULNERABILITY_SCORE || 0) >= 0.75 ? '#e74c3c' : (m.SDOH_VULNERABILITY_SCORE || 0) >= 0.5 ? '#e67e22' : '#27ae60' }]}>
                <Text style={styles.sdohText}>SDOH {((m.SDOH_VULNERABILITY_SCORE || 0) * 100).toFixed(0)}%</Text>
              </View>
            </View>
          ))}
        </View>
      </ScrollView>
    );
  };

  const renderCoordination = () => {
    if (isLoadingCoord) {
      return <View style={styles.center}><ActivityIndicator size="large" color="#29B5E8" /><Text style={styles.loadingText}>Loading care coordination...</Text></View>;
    }
    const grouped = riskTiers.reduce((acc, tier) => {
      acc[tier] = coordination.filter(p => p.RISK_TIER === tier);
      return acc;
    }, {} as Record<string, CoordinationRow[]>);

    return (
      <ScrollView style={styles.scrollContent} contentContainerStyle={styles.scrollPadding}>
        <View style={styles.filterRow}>
          <TouchableOpacity
            style={[styles.filterChip, !coordFilter && styles.filterChipActive]}
            onPress={() => { setCoordFilter(undefined); loadCoordinationData(); }}
          >
            <Text style={[styles.filterChipText, !coordFilter && styles.filterChipTextActive]}>All</Text>
          </TouchableOpacity>
          {riskTiers.map(tier => (
            <TouchableOpacity
              key={tier}
              style={[styles.filterChip, coordFilter === tier && { backgroundColor: tierColors[tier] }]}
              onPress={() => { setCoordFilter(tier); loadCoordinationData(tier); }}
            >
              <Text style={[styles.filterChipText, coordFilter === tier && { color: '#fff' }]}>{tier}</Text>
            </TouchableOpacity>
          ))}
        </View>

        {riskTiers.map(tier => {
          const patients = grouped[tier] || [];
          if (patients.length === 0) return null;
          return (
            <View key={tier}>
              <View style={styles.tierHeader}>
                <View style={[styles.tierDot, { backgroundColor: tierColors[tier] }]} />
                <Text style={styles.tierTitle}>{tier}</Text>
                <Text style={styles.tierCount}>{patients.length} patients</Text>
              </View>
              {patients.slice(0, 10).map((p, i) => {
                let interventions: string[] = [];
                try { interventions = JSON.parse(p.INTERVENTIONS || '[]'); } catch {}
                return (
                  <View key={i} style={styles.coordCard}>
                    <View style={styles.coordHeader}>
                      <Text style={styles.coordName}>{p.PATIENT_NAME || `Patient ${p.PERSON_ID}`}</Text>
                      <Text style={styles.coordAge}>Age {p.AGE}</Text>
                      {p.COUNTY && <Text style={styles.coordCounty}>{p.COUNTY} County</Text>}
                    </View>
                    <Text style={styles.coordConditions} numberOfLines={2}>{p.TOP_CONDITIONS}</Text>
                    {p.SDOH_VULNERABILITY > 0 && (
                      <View style={[styles.sdohBadge, { backgroundColor: p.SDOH_VULNERABILITY >= 0.75 ? '#e74c3c' : p.SDOH_VULNERABILITY >= 0.5 ? '#e67e22' : '#27ae60', alignSelf: 'flex-start', marginTop: 4 }]}>
                        <Text style={styles.sdohText}>SDOH Vulnerability {(p.SDOH_VULNERABILITY * 100).toFixed(0)}%</Text>
                      </View>
                    )}
                    {interventions.length > 0 && (
                      <View style={styles.interventionList}>
                        {interventions.map((intv, j) => (
                          <View key={j} style={styles.interventionItem}>
                            <Text style={styles.interventionDot}>{'\u2022'}</Text>
                            <Text style={styles.interventionText}>{intv}</Text>
                          </View>
                        ))}
                      </View>
                    )}
                  </View>
                );
              })}
            </View>
          );
        })}
        {coordination.length === 0 && <View style={styles.center}><Text style={styles.noData}>No patients found for selected filter</Text></View>}
      </ScrollView>
    );
  };

  return (
    <View style={styles.container}>
      <GovernanceBadge />
      <View style={styles.subTabBar}>
        {(['population', 'coordination', 'research'] as SubTab[]).map(tab => (
          <TouchableOpacity
            key={tab}
            style={[styles.subTab, activeTab === tab && styles.subTabActive]}
            onPress={() => setActiveTab(tab)}
          >
            <Text style={[styles.subTabText, activeTab === tab && styles.subTabTextActive]}>
              {tab === 'population' ? 'Population' : tab === 'coordination' ? 'Care Coordination' : 'Research'}
            </Text>
          </TouchableOpacity>
        ))}
      </View>

      {activeTab === 'population' && renderPopulation()}
      {activeTab === 'coordination' && renderCoordination()}
      {activeTab === 'research' && (
        <ChatInterface
          messages={messages}
          onSendMessage={handleSendMessage}
          onConfirmSQL={handleConfirmSQL}
          onRejectSQL={handleRejectSQL}
          isLoading={isLoading}
          placeholder="Ask about patient data..."
        />
      )}
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
    backgroundColor: '#f5f5f5',
  },
  subTabBar: {
    flexDirection: 'row',
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    paddingHorizontal: 8,
  },
  subTab: {
    flex: 1,
    paddingVertical: 12,
    alignItems: 'center',
    borderBottomWidth: 2,
    borderBottomColor: 'transparent',
  },
  subTabActive: {
    borderBottomColor: '#29B5E8',
  },
  subTabText: {
    fontSize: 13,
    fontWeight: '500',
    color: '#999',
  },
  subTabTextActive: {
    color: '#29B5E8',
    fontWeight: '600',
  },
  scrollContent: {
    flex: 1,
  },
  scrollPadding: {
    padding: 16,
    paddingBottom: 40,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 40,
  },
  loadingText: {
    marginTop: 12,
    color: '#666',
    fontSize: 14,
  },
  noData: {
    color: '#999',
    fontSize: 14,
  },
  kpiRow: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    gap: 8,
    marginBottom: 16,
  },
  kpiCard: {
    flex: 1,
    minWidth: 140,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  kpiValue: {
    fontSize: 24,
    fontWeight: '700',
    color: '#29B5E8',
  },
  kpiLabel: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
    textTransform: 'uppercase',
    letterSpacing: 0.5,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '700',
    color: '#333',
    marginBottom: 8,
    marginTop: 8,
  },
  card: {
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    marginBottom: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.08,
    shadowRadius: 4,
    elevation: 2,
  },
  barGroup: {
    marginBottom: 16,
  },
  barLabel: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
    marginBottom: 6,
  },
  barContainer: {
    flexDirection: 'row',
    height: 24,
    borderRadius: 12,
    overflow: 'hidden',
  },
  barFill: {
    height: 24,
  },
  barLegend: {
    fontSize: 11,
    color: '#666',
    marginTop: 4,
  },
  ageRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  ageLabel: {
    width: 130,
    fontSize: 12,
    color: '#333',
  },
  ageBarOuter: {
    flex: 1,
    height: 16,
    backgroundColor: '#f0f0f0',
    borderRadius: 8,
    overflow: 'hidden',
    marginHorizontal: 8,
  },
  ageBarInner: {
    height: 16,
    backgroundColor: '#29B5E8',
    borderRadius: 8,
  },
  ageCount: {
    width: 50,
    fontSize: 11,
    color: '#666',
    textAlign: 'right',
  },
  ageDeaths: {
    width: 30,
    fontSize: 11,
    color: '#e74c3c',
    textAlign: 'right',
    fontWeight: '600',
  },
  condRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  condRank: {
    width: 24,
    height: 24,
    borderRadius: 12,
    backgroundColor: '#29B5E8',
    justifyContent: 'center',
    alignItems: 'center',
    marginRight: 10,
  },
  condRankText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '700',
  },
  condInfo: {
    flex: 1,
  },
  condName: {
    fontSize: 13,
    fontWeight: '600',
    color: '#333',
  },
  condDetail: {
    fontSize: 11,
    color: '#666',
  },
  condBar: {
    height: 6,
    backgroundColor: '#29B5E8',
    borderRadius: 3,
    position: 'absolute',
    bottom: 0,
    left: 34,
    opacity: 0.15,
  },
  countyRow: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  countyName: {
    flex: 1,
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
  },
  countyRate: {
    fontSize: 13,
    fontWeight: '700',
    color: '#e74c3c',
    marginRight: 8,
  },
  sdohBadge: {
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 10,
  },
  sdohText: {
    color: '#fff',
    fontSize: 10,
    fontWeight: '600',
  },
  filterRow: {
    flexDirection: 'row',
    gap: 8,
    marginBottom: 16,
    flexWrap: 'wrap',
  },
  filterChip: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: '#e0e0e0',
  },
  filterChipActive: {
    backgroundColor: '#29B5E8',
  },
  filterChipText: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
  },
  filterChipTextActive: {
    color: '#fff',
  },
  tierHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 8,
  },
  tierDot: {
    width: 12,
    height: 12,
    borderRadius: 6,
    marginRight: 8,
  },
  tierTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  tierCount: {
    fontSize: 12,
    color: '#666',
    marginLeft: 8,
  },
  coordCard: {
    backgroundColor: '#fff',
    borderRadius: 10,
    padding: 14,
    marginBottom: 8,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.06,
    shadowRadius: 3,
    elevation: 1,
  },
  coordHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 4,
  },
  coordName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  coordAge: {
    fontSize: 12,
    color: '#666',
  },
  coordCounty: {
    fontSize: 12,
    color: '#999',
  },
  coordConditions: {
    fontSize: 12,
    color: '#555',
    marginTop: 2,
  },
  interventionList: {
    marginTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
    paddingTop: 8,
  },
  interventionItem: {
    flexDirection: 'row',
    marginBottom: 3,
  },
  interventionDot: {
    color: '#29B5E8',
    marginRight: 6,
    fontSize: 12,
  },
  interventionText: {
    fontSize: 12,
    color: '#444',
    flex: 1,
  },
});
