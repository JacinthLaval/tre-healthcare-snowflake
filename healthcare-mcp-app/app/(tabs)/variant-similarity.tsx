import React, { useState, useEffect, useRef, useCallback } from 'react';
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
import {
  findSimilarPatients,
  getCommunityProfile,
  getPatientCommunity,
  getBackendType,
  getGraphLayout,
  SimilarPatient,
  CommunityProfile,
  GraphLayout,
  GraphLayoutNode,
} from '@/services/variant-similarity';

interface Patient {
  SAMPLE_ID: string;
  PATIENT_NAME: string;
  SUPERPOPULATION: string;
  POPULATION: string;
}

const POP_COLORS: Record<string, string> = {
  EUR: '#4A90D9',
  AFR: '#E67E22',
  EAS: '#27AE60',
  SAS: '#8E44AD',
  AMR: '#E74C3C',
};

export default function VariantSimilarityScreen() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [similarPatients, setSimilarPatients] = useState<SimilarPatient[]>([]);
  const [queryVariants, setQueryVariants] = useState<string[]>([]);
  const [communityProfile, setCommunityProfile] = useState<CommunityProfile | null>(null);
  const [communityId, setCommunityId] = useState<number | null>(null);
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);
  const [isLoadingSimilar, setIsLoadingSimilar] = useState(false);
  const [isLoadingCommunity, setIsLoadingCommunity] = useState(false);
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [activeView, setActiveView] = useState<'similar' | 'community' | 'network'>('similar');
  const [topN, setTopN] = useState(15);
  const [error, setError] = useState<string | null>(null);
  const [backend, setBackend] = useState<string>('detecting...');
  const [graphLayout, setGraphLayout] = useState<GraphLayout | null>(null);
  const [isLoadingGraph, setIsLoadingGraph] = useState(false);
  const [graphHighlight, setGraphHighlight] = useState<string | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [canvasSize, setCanvasSize] = useState({ width: 800, height: 600 });

  useEffect(() => {
    const client = getMCPClient();
    if (!client) {
      const pat = Platform.OS === 'web' ? localStorage.getItem('snowflake_pat') : null;
      if (pat) {
        initMCPClient(pat);
      } else {
        setTimeout(() => router.replace('/'), 0);
        return;
      }
    }
    loadPatients();
  }, []);

  const loadPatients = async () => {
    try {
      const client = getMCPClient();
      if (!client) return;
      const data = await client.executeSQL(`
        SELECT DISTINCT SAMPLE_ID, PATIENT_NAME, SUPERPOPULATION, POPULATION
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_PGX_PROFILES
        ORDER BY PATIENT_NAME
        LIMIT 100
      `);
      setPatients(data as unknown as Patient[]);
    } catch (err) {
      console.error('Failed to load patients:', err);
    } finally {
      setIsLoadingPatients(false);
    }
  };

  const handlePatientSelect = async (patient: Patient) => {
    setSelectedPatient(patient);
    setShowPatientPicker(false);
    setPatientSearch('');
    setError(null);
    setSimilarPatients([]);
    setCommunityProfile(null);
    setActiveView('similar');

    setIsLoadingSimilar(true);
    try {
      const result = await findSimilarPatients(patient.SAMPLE_ID, topN);
      setSimilarPatients(result.similar);
      setQueryVariants(result.queryVariants);
      setBackend(getBackendType());

      const cid = result.communityId ?? await getPatientCommunity(patient.SAMPLE_ID);
      setCommunityId(cid);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to find similar patients');
    } finally {
      setIsLoadingSimilar(false);
    }
  };

  const loadCommunity = async (cid: number) => {
    setIsLoadingCommunity(true);
    setActiveView('community');
    try {
      const profile = await getCommunityProfile(cid);
      setCommunityProfile(profile);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load community');
    } finally {
      setIsLoadingCommunity(false);
    }
  };

  const loadGraphLayout = async () => {
    if (graphLayout) {
      setActiveView('network');
      return;
    }
    setIsLoadingGraph(true);
    setActiveView('network');
    try {
      const layout = await getGraphLayout(5000);
      setGraphLayout(layout);
      setBackend(getBackendType());
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load graph layout');
    } finally {
      setIsLoadingGraph(false);
    }
  };

  const COMMUNITY_COLORS = ['#6C5CE7', '#E67E22', '#27AE60', '#E74C3C', '#3498DB', '#F39C12', '#1ABC9C', '#9B59B6'];

  const drawGraph = useCallback(() => {
    if (Platform.OS !== 'web' || !graphLayout || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    const W = canvas.width;
    const H = canvas.height;
    const pad = 40;
    const drawW = W - pad * 2;
    const drawH = H - pad * 2;

    ctx.clearRect(0, 0, W, H);
    ctx.fillStyle = '#fafafa';
    ctx.fillRect(0, 0, W, H);

    const toX = (nx: number) => pad + nx * drawW;
    const toY = (ny: number) => pad + ny * drawH;

    ctx.globalAlpha = 0.06;
    ctx.strokeStyle = '#999';
    ctx.lineWidth = 0.5;
    for (const [src, dst] of graphLayout.edges) {
      const a = graphLayout.nodes[src];
      const b = graphLayout.nodes[dst];
      if (!a || !b) continue;
      ctx.beginPath();
      ctx.moveTo(toX(a.x), toY(a.y));
      ctx.lineTo(toX(b.x), toY(b.y));
      ctx.stroke();
    }
    ctx.globalAlpha = 1.0;

    for (const node of graphLayout.nodes) {
      if (!node) continue;
      const x = toX(node.x);
      const y = toY(node.y);
      const color = COMMUNITY_COLORS[node.community % COMMUNITY_COLORS.length];
      const isHighlighted = graphHighlight === node.sampleId;
      const isSelected = selectedPatient?.SAMPLE_ID === node.sampleId;

      ctx.beginPath();
      ctx.arc(x, y, isHighlighted || isSelected ? 5 : 2, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();

      if (isSelected) {
        ctx.strokeStyle = '#000';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }

    const sizesEntries = Object.entries(graphLayout.communitySizes).sort(([, a], [, b]) => b - a);
    ctx.font = '11px sans-serif';
    ctx.textAlign = 'left';
    let ly = 14;
    for (const [cid, size] of sizesEntries) {
      const color = COMMUNITY_COLORS[parseInt(cid) % COMMUNITY_COLORS.length];
      ctx.fillStyle = color;
      ctx.fillRect(W - 140, ly - 8, 10, 10);
      ctx.fillStyle = '#333';
      ctx.fillText(`C${cid}: ${size} patients`, W - 125, ly);
      ly += 16;
    }
    ctx.fillStyle = '#888';
    ctx.font = '10px sans-serif';
    ctx.fillText(`${graphLayout.nodes.length} nodes, ${graphLayout.edges.length} edges`, W - 140, ly + 4);
    ctx.fillText(`Modularity: ${graphLayout.modularity}`, W - 140, ly + 18);
  }, [graphLayout, graphHighlight, selectedPatient]);

  useEffect(() => {
    if (activeView === 'network' && graphLayout) {
      requestAnimationFrame(drawGraph);
    }
  }, [activeView, graphLayout, drawGraph]);

  const handleCanvasClick = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graphLayout || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = e.clientX - rect.left;
    const my = e.clientY - rect.top;
    const scaleX = canvas.width / rect.width;
    const scaleY = canvas.height / rect.height;
    const cx = mx * scaleX;
    const cy = my * scaleY;
    const pad = 40;
    const drawW = canvas.width - pad * 2;
    const drawH = canvas.height - pad * 2;

    let closest: GraphLayoutNode | null = null;
    let closestDist = Infinity;
    for (const node of graphLayout.nodes) {
      if (!node) continue;
      const nx = pad + node.x * drawW;
      const ny = pad + node.y * drawH;
      const d = Math.sqrt((cx - nx) ** 2 + (cy - ny) ** 2);
      if (d < closestDist && d < 15) {
        closestDist = d;
        closest = node;
      }
    }
    if (closest) {
      setGraphHighlight(closest.sampleId);
      const p = patients.find(pt => pt.SAMPLE_ID === closest!.sampleId);
      if (p) handlePatientSelect(p);
    }
  }, [graphLayout, patients]);

  const handleCanvasMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!graphLayout || !canvasRef.current) return;
    const canvas = canvasRef.current;
    const rect = canvas.getBoundingClientRect();
    const mx = (e.clientX - rect.left) * (canvas.width / rect.width);
    const my = (e.clientY - rect.top) * (canvas.height / rect.height);
    const pad = 40;
    const drawW = canvas.width - pad * 2;
    const drawH = canvas.height - pad * 2;

    let found: GraphLayoutNode | null = null;
    for (const node of graphLayout.nodes) {
      if (!node) continue;
      const nx = pad + node.x * drawW;
      const ny = pad + node.y * drawH;
      if (Math.sqrt((mx - nx) ** 2 + (my - ny) ** 2) < 8) {
        found = node;
        break;
      }
    }
    canvas.style.cursor = found ? 'pointer' : 'default';
    canvas.title = found ? `${found.patientName} (${found.sampleId})\n${found.superpopulation} — Community #${found.community}` : '';
  }, [graphLayout]);

  const filteredPatients = patients.filter(p =>
    p.PATIENT_NAME.toLowerCase().includes(patientSearch.toLowerCase()) ||
    p.SAMPLE_ID.toLowerCase().includes(patientSearch.toLowerCase())
  );

  const getPopColor = (pop: string) => POP_COLORS[pop] || '#999';

  const renderSimilarityBar = (sim: number) => {
    const pct = Math.round(sim * 100);
    const color = sim >= 0.8 ? '#DC3545' : sim >= 0.5 ? '#FFC107' : sim >= 0.3 ? '#29B5E8' : '#6c757d';
    return (
      <View style={styles.simBarContainer}>
        <View style={[styles.simBar, { width: `${pct}%`, backgroundColor: color }]} />
        <Text style={[styles.simBarText, { color }]}>{pct}%</Text>
      </View>
    );
  };

  const renderFrequencyBar = (freq: number) => {
    const pct = Math.round(freq * 100);
    return (
      <View style={styles.freqBarContainer}>
        <View style={[styles.freqBar, { width: `${pct}%` }]} />
        <Text style={styles.freqBarText}>{pct}%</Text>
      </View>
    );
  };

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Ionicons name="git-network" size={20} color="#6C5CE7" />
        <Text style={styles.headerTitle}>Pharmacogenomic Variant Similarity</Text>
      </View>
      <Text style={styles.headerSubtitle}>
        Jaccard similarity across 12 pharmacogene variant positions for {patients.length > 0 ? `${patients.length}+` : '...'} patients
      </Text>
      <View style={[styles.backendBadge, { backgroundColor: backend === 'cugraph' ? '#d4edda' : '#d1ecf1' }]}>
        <Ionicons name={backend === 'cugraph' ? 'hardware-chip' : 'code-slash'} size={12} color={backend === 'cugraph' ? '#155724' : '#0c5460'} />
        <Text style={[styles.backendText, { color: backend === 'cugraph' ? '#155724' : '#0c5460' }]}>
          {backend === 'cugraph' ? 'NVIDIA cuGraph GPU (SPCS)' : 'SQL FALLBACK (CPU)'}
        </Text>
      </View>

      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          <Ionicons name="person" size={16} color="#29B5E8" /> Select Patient
        </Text>
        <TouchableOpacity
          style={styles.patientSelector}
          onPress={() => setShowPatientPicker(!showPatientPicker)}
        >
          {isLoadingPatients ? (
            <ActivityIndicator size="small" color="#29B5E8" />
          ) : (
            <>
              <Text style={styles.patientSelectorText}>
                {selectedPatient ? `${selectedPatient.PATIENT_NAME} (${selectedPatient.SAMPLE_ID})` : 'Choose a patient...'}
              </Text>
              <Ionicons name={showPatientPicker ? 'chevron-up' : 'chevron-down'} size={20} color="#666" />
            </>
          )}
        </TouchableOpacity>
        {showPatientPicker && (
          <View style={styles.patientList}>
            <View style={styles.searchContainer}>
              <Ionicons name="search" size={16} color="#999" style={{ marginRight: 8 }} />
              <TextInput
                style={styles.searchInput}
                placeholder="Search by name or sample ID..."
                placeholderTextColor="#999"
                value={patientSearch}
                onChangeText={setPatientSearch}
                autoFocus
              />
              {patientSearch.length > 0 && (
                <TouchableOpacity onPress={() => setPatientSearch('')}>
                  <Ionicons name="close-circle" size={18} color="#999" />
                </TouchableOpacity>
              )}
            </View>
            <ScrollView style={{ maxHeight: 240 }} nestedScrollEnabled>
              {filteredPatients.slice(0, 30).map((patient) => (
                <TouchableOpacity key={patient.SAMPLE_ID} style={styles.patientItem} onPress={() => handlePatientSelect(patient)}>
                  <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.patientName}>{patient.PATIENT_NAME}</Text>
                      <Text style={styles.patientInfo}>{patient.SAMPLE_ID} · {patient.POPULATION}</Text>
                    </View>
                    <View style={[styles.popBadge, { backgroundColor: getPopColor(patient.SUPERPOPULATION) + '20' }]}>
                      <Text style={[styles.popBadgeText, { color: getPopColor(patient.SUPERPOPULATION) }]}>{patient.SUPERPOPULATION}</Text>
                    </View>
                  </View>
                </TouchableOpacity>
              ))}
            </ScrollView>
          </View>
        )}
      </View>

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color="#DC3545" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {!selectedPatient && !isLoadingSimilar && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.networkMapBtn} onPress={loadGraphLayout}>
            <Ionicons name="git-network" size={20} color="#fff" />
            <Text style={styles.networkMapBtnText}>View Cohort Network Map</Text>
          </TouchableOpacity>
          <Text style={styles.networkMapHint}>Explore the full patient similarity graph with Louvain communities</Text>
        </View>
      )}

      {activeView === 'network' && !selectedPatient && isLoadingGraph && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.loadingText}>Computing graph layout on GPU...</Text>
          <Text style={styles.loadingSubtext}>Force-directed layout for 3,192 patients (force_atlas2)</Text>
        </View>
      )}

      {activeView === 'network' && !selectedPatient && graphLayout && !isLoadingGraph && Platform.OS === 'web' && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="git-network" size={16} color="#6C5CE7" /> Cohort Similarity Network
          </Text>
          <View style={styles.graphStats}>
            <View style={styles.graphStat}>
              <Text style={styles.graphStatValue}>{graphLayout.nodes.length.toLocaleString()}</Text>
              <Text style={styles.graphStatLabel}>Patients</Text>
            </View>
            <View style={styles.graphStat}>
              <Text style={styles.graphStatValue}>{graphLayout.edges.length.toLocaleString()}</Text>
              <Text style={styles.graphStatLabel}>Edges Shown</Text>
            </View>
            <View style={styles.graphStat}>
              <Text style={styles.graphStatValue}>{graphLayout.communities}</Text>
              <Text style={styles.graphStatLabel}>Communities</Text>
            </View>
            <View style={styles.graphStat}>
              <Text style={styles.graphStatValue}>{graphLayout.modularity}</Text>
              <Text style={styles.graphStatLabel}>Modularity</Text>
            </View>
          </View>
          <View style={styles.canvasContainer}>
            <canvas
              ref={(el: HTMLCanvasElement | null) => {
                canvasRef.current = el;
                if (el) requestAnimationFrame(drawGraph);
              }}
              width={900}
              height={700}
              style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid #eee', cursor: 'crosshair' } as any}
              onClick={handleCanvasClick as any}
              onMouseMove={handleCanvasMove as any}
            />
          </View>
          <Text style={styles.graphHint}>Click a node to select that patient. Hover for details.</Text>
        </View>
      )}

      {isLoadingSimilar && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.loadingText}>Computing variant similarity across all patients...</Text>
          <Text style={styles.loadingSubtext}>Building Jaccard similarity graph (first load may take a moment)</Text>
        </View>
      )}

      {selectedPatient && !isLoadingSimilar && similarPatients.length > 0 && (
        <>
          <View style={styles.queryInfo}>
            <Text style={styles.queryInfoTitle}>
              {selectedPatient.PATIENT_NAME}'s Variant Profile
            </Text>
            <View style={styles.variantChips}>
              {queryVariants.map(v => (
                <View key={v} style={styles.variantChip}>
                  <Text style={styles.variantChipText}>{v.replace(':', ' ')}</Text>
                </View>
              ))}
              {queryVariants.length === 0 && (
                <Text style={styles.noVariantsText}>No non-reference variants detected</Text>
              )}
            </View>
            {communityId !== null && (
              <TouchableOpacity style={styles.communityBadge} onPress={() => loadCommunity(communityId)}>
                <Ionicons name="people" size={14} color="#6C5CE7" />
                <Text style={styles.communityBadgeText}>Community #{communityId}</Text>
                <Ionicons name="chevron-forward" size={14} color="#6C5CE7" />
              </TouchableOpacity>
            )}
          </View>

          <View style={styles.tabBar}>
            <TouchableOpacity
              style={[styles.tabBtn, activeView === 'similar' && styles.tabBtnActive]}
              onPress={() => setActiveView('similar')}
            >
              <Ionicons name="git-compare" size={16} color={activeView === 'similar' ? '#fff' : '#6C5CE7'} />
              <Text style={[styles.tabBtnText, activeView === 'similar' && styles.tabBtnTextActive]}>Similar</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, activeView === 'community' && styles.tabBtnActive]}
              onPress={() => communityId !== null && loadCommunity(communityId)}
            >
              <Ionicons name="people" size={16} color={activeView === 'community' ? '#fff' : '#6C5CE7'} />
              <Text style={[styles.tabBtnText, activeView === 'community' && styles.tabBtnTextActive]}>Community</Text>
            </TouchableOpacity>
            <TouchableOpacity
              style={[styles.tabBtn, activeView === 'network' && styles.tabBtnActive]}
              onPress={loadGraphLayout}
            >
              <Ionicons name="git-network" size={16} color={activeView === 'network' ? '#fff' : '#6C5CE7'} />
              <Text style={[styles.tabBtnText, activeView === 'network' && styles.tabBtnTextActive]}>Network Map</Text>
            </TouchableOpacity>
          </View>

          {activeView === 'similar' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="git-compare" size={16} color="#6C5CE7" /> Top {similarPatients.length} Similar Patients
              </Text>
              {similarPatients.map((sp, idx) => (
                <TouchableOpacity key={sp.sampleId} style={styles.similarCard} onPress={() => {
                  const p = patients.find(pt => pt.SAMPLE_ID === sp.sampleId);
                  if (p) handlePatientSelect(p);
                }}>
                  <View style={styles.similarCardHeader}>
                    <View style={{ flex: 1 }}>
                      <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                        <Text style={styles.rankBadge}>#{idx + 1}</Text>
                        <Text style={styles.similarName}>{sp.patientName}</Text>
                      </View>
                      <Text style={styles.similarInfo}>
                        {sp.sampleId} · {sp.population}
                        <Text style={[styles.popLabel, { color: getPopColor(sp.superpopulation) }]}> {sp.superpopulation}</Text>
                      </Text>
                    </View>
                    <View style={styles.communityTag}>
                      <Text style={styles.communityTagText}>C{sp.community}</Text>
                    </View>
                  </View>
                  {renderSimilarityBar(sp.similarity)}
                  {sp.sharedVariants.length > 0 && (
                    <View style={styles.sharedVariants}>
                      <Text style={styles.sharedLabel}>Shared: </Text>
                      {sp.sharedVariants.map(v => (
                        <View key={v} style={styles.sharedChip}>
                          <Text style={styles.sharedChipText}>{v.split(':')[1]}</Text>
                        </View>
                      ))}
                    </View>
                  )}
                </TouchableOpacity>
              ))}
            </View>
          )}

          {activeView === 'community' && isLoadingCommunity && (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.loadingText}>Loading community profile...</Text>
            </View>
          )}

          {activeView === 'community' && communityProfile && !isLoadingCommunity && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="people" size={16} color="#6C5CE7" /> Community #{communityProfile.communityId}
              </Text>

              <View style={styles.communitySummary}>
                <View style={styles.communityStat}>
                  <Text style={styles.communityStatValue}>{communityProfile.size}</Text>
                  <Text style={styles.communityStatLabel}>Patients</Text>
                </View>
                <View style={styles.communityStat}>
                  <Text style={styles.communityStatValue}>
                    {Object.keys(communityProfile.superpopulationDistribution).length}
                  </Text>
                  <Text style={styles.communityStatLabel}>Populations</Text>
                </View>
                <View style={styles.communityStat}>
                  <Text style={styles.communityStatValue}>
                    {Object.values(communityProfile.variantFrequencies).filter(v => v.frequency > 0.5).length}
                  </Text>
                  <Text style={styles.communityStatLabel}>Common Variants</Text>
                </View>
              </View>

              <Text style={styles.subsectionTitle}>Population Distribution</Text>
              <View style={styles.popDistribution}>
                {Object.entries(communityProfile.superpopulationDistribution)
                  .sort(([, a], [, b]) => b - a)
                  .map(([pop, count]) => (
                    <View key={pop} style={styles.popDistRow}>
                      <View style={[styles.popDot, { backgroundColor: getPopColor(pop) }]} />
                      <Text style={styles.popDistLabel}>{pop}</Text>
                      <View style={styles.popDistBarContainer}>
                        <View style={[styles.popDistBar, {
                          width: `${(count / communityProfile.size) * 100}%`,
                          backgroundColor: getPopColor(pop),
                        }]} />
                      </View>
                      <Text style={styles.popDistCount}>{count} ({Math.round((count / communityProfile.size) * 100)}%)</Text>
                    </View>
                  ))}
              </View>

              <Text style={styles.subsectionTitle}>Variant Frequencies</Text>
              {Object.entries(communityProfile.variantFrequencies)
                .sort(([, a], [, b]) => b.frequency - a.frequency)
                .map(([variant, data]) => (
                  <View key={variant} style={styles.freqRow}>
                    <Text style={styles.freqVariant}>{variant.replace(':', ' ')}</Text>
                    <View style={{ flex: 1, marginLeft: 8 }}>
                      {renderFrequencyBar(data.frequency)}
                    </View>
                    <Text style={styles.freqCount}>{data.carriers}/{data.total}</Text>
                  </View>
                ))}

              <Text style={[styles.subsectionTitle, { marginTop: 16 }]}>Members (top 50)</Text>
              <View style={styles.membersGrid}>
                {communityProfile.members.map(m => (
                  <TouchableOpacity key={m.sampleId} style={styles.memberChip} onPress={() => {
                    const p = patients.find(pt => pt.SAMPLE_ID === m.sampleId);
                    if (p) handlePatientSelect(p);
                  }}>
                    <View style={[styles.memberDot, { backgroundColor: getPopColor(m.superpopulation) }]} />
                    <Text style={styles.memberText}>{m.patientName}</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>
          )}

          {activeView === 'network' && isLoadingGraph && (
            <View style={styles.loadingBox}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.loadingText}>Computing graph layout on GPU...</Text>
              <Text style={styles.loadingSubtext}>Force-directed layout for 3,192 patients (force_atlas2)</Text>
            </View>
          )}

          {activeView === 'network' && graphLayout && !isLoadingGraph && Platform.OS === 'web' && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="git-network" size={16} color="#6C5CE7" /> Cohort Similarity Network
              </Text>
              <View style={styles.graphStats}>
                <View style={styles.graphStat}>
                  <Text style={styles.graphStatValue}>{graphLayout.nodes.length.toLocaleString()}</Text>
                  <Text style={styles.graphStatLabel}>Patients</Text>
                </View>
                <View style={styles.graphStat}>
                  <Text style={styles.graphStatValue}>{graphLayout.edges.length.toLocaleString()}</Text>
                  <Text style={styles.graphStatLabel}>Edges Shown</Text>
                </View>
                <View style={styles.graphStat}>
                  <Text style={styles.graphStatValue}>{graphLayout.communities}</Text>
                  <Text style={styles.graphStatLabel}>Communities</Text>
                </View>
                <View style={styles.graphStat}>
                  <Text style={styles.graphStatValue}>{graphLayout.modularity}</Text>
                  <Text style={styles.graphStatLabel}>Modularity</Text>
                </View>
              </View>
              <View style={styles.canvasContainer}>
                <canvas
                  ref={(el: HTMLCanvasElement | null) => {
                    canvasRef.current = el;
                    if (el) requestAnimationFrame(drawGraph);
                  }}
                  width={900}
                  height={700}
                  style={{ width: '100%', height: 'auto', borderRadius: 8, border: '1px solid #eee', cursor: 'crosshair' } as any}
                  onClick={handleCanvasClick as any}
                  onMouseMove={handleCanvasMove as any}
                />
              </View>
              <Text style={styles.graphHint}>Click a node to select that patient. Hover for details.</Text>
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
  section: { backgroundColor: '#fff', margin: 12, padding: 16, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  sectionTitle: { fontSize: 15, fontWeight: '600', color: '#333', marginBottom: 12 },
  patientSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa' },
  patientSelectorText: { fontSize: 15, color: '#333' },
  patientList: { marginTop: 8, maxHeight: 300, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', padding: 8, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fafafa', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#333', padding: 4 },
  patientItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  patientName: { fontSize: 15, fontWeight: '500', color: '#333' },
  patientInfo: { fontSize: 12, color: '#666', marginTop: 2 },
  popBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  popBadgeText: { fontSize: 11, fontWeight: '600' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fde8e8', padding: 12, margin: 12, borderRadius: 8 },
  errorText: { flex: 1, marginLeft: 8, fontSize: 13, color: '#DC3545' },
  loadingBox: { alignItems: 'center', padding: 32, margin: 12, backgroundColor: '#fff', borderRadius: 12 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#6C5CE7', fontWeight: '500' },
  loadingSubtext: { marginTop: 4, fontSize: 12, color: '#999' },
  queryInfo: { backgroundColor: '#fff', margin: 12, padding: 16, borderRadius: 12, borderLeftWidth: 4, borderLeftColor: '#6C5CE7' },
  queryInfoTitle: { fontSize: 15, fontWeight: '700', color: '#333', marginBottom: 8 },
  variantChips: { flexDirection: 'row', flexWrap: 'wrap' },
  variantChip: { backgroundColor: '#f3f0ff', paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, marginRight: 6, marginBottom: 6 },
  variantChipText: { fontSize: 12, color: '#6C5CE7', fontWeight: '500' },
  noVariantsText: { fontSize: 13, color: '#28A745', fontStyle: 'italic' },
  communityBadge: { flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingVertical: 6, paddingHorizontal: 10, backgroundColor: '#f3f0ff', borderRadius: 8, alignSelf: 'flex-start' },
  communityBadgeText: { fontSize: 13, color: '#6C5CE7', fontWeight: '600', marginHorizontal: 6 },
  tabBar: { flexDirection: 'row', marginHorizontal: 12, backgroundColor: '#f3f0ff', borderRadius: 10, padding: 3 },
  tabBtn: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 10, borderRadius: 8 },
  tabBtnActive: { backgroundColor: '#6C5CE7' },
  tabBtnText: { fontSize: 13, fontWeight: '600', color: '#6C5CE7', marginLeft: 6 },
  tabBtnTextActive: { color: '#fff' },
  similarCard: { padding: 14, backgroundColor: '#fafafa', borderRadius: 10, marginBottom: 10, borderWidth: 1, borderColor: '#eee' },
  similarCardHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  rankBadge: { fontSize: 12, fontWeight: '700', color: '#6C5CE7', backgroundColor: '#f3f0ff', paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10, marginRight: 8 },
  similarName: { fontSize: 14, fontWeight: '600', color: '#333' },
  similarInfo: { fontSize: 12, color: '#666', marginTop: 2, marginLeft: 36 },
  popLabel: { fontWeight: '600' },
  communityTag: { backgroundColor: '#e8e5f7', paddingHorizontal: 8, paddingVertical: 3, borderRadius: 6 },
  communityTagText: { fontSize: 11, fontWeight: '600', color: '#6C5CE7' },
  simBarContainer: { flexDirection: 'row', alignItems: 'center', height: 20, backgroundColor: '#f0f0f0', borderRadius: 10, overflow: 'hidden', marginBottom: 6 },
  simBar: { height: '100%', borderRadius: 10 },
  simBarText: { position: 'absolute', right: 8, fontSize: 12, fontWeight: '700' },
  sharedVariants: { flexDirection: 'row', flexWrap: 'wrap', alignItems: 'center', marginTop: 4 },
  sharedLabel: { fontSize: 11, color: '#888' },
  sharedChip: { backgroundColor: '#e8f5e9', paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, marginRight: 4, marginBottom: 2 },
  sharedChipText: { fontSize: 10, color: '#28A745', fontWeight: '500' },
  communitySummary: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 16 },
  communityStat: { alignItems: 'center' },
  communityStatValue: { fontSize: 24, fontWeight: '700', color: '#6C5CE7' },
  communityStatLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  subsectionTitle: { fontSize: 14, fontWeight: '700', color: '#333', marginBottom: 10, marginTop: 4 },
  popDistribution: { marginBottom: 16 },
  popDistRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  popDot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  popDistLabel: { width: 40, fontSize: 12, fontWeight: '600', color: '#333' },
  popDistBarContainer: { flex: 1, height: 16, backgroundColor: '#f0f0f0', borderRadius: 8, marginHorizontal: 8, overflow: 'hidden' },
  popDistBar: { height: '100%', borderRadius: 8 },
  popDistCount: { width: 80, fontSize: 11, color: '#666', textAlign: 'right' },
  freqRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  freqVariant: { width: 130, fontSize: 11, color: '#333', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  freqBarContainer: { flexDirection: 'row', alignItems: 'center', height: 14, backgroundColor: '#f0f0f0', borderRadius: 7, overflow: 'hidden', flex: 1 },
  freqBar: { height: '100%', borderRadius: 7, backgroundColor: '#6C5CE7' },
  freqBarText: { position: 'absolute', right: 4, fontSize: 10, fontWeight: '600', color: '#555' },
  freqCount: { width: 50, fontSize: 11, color: '#888', textAlign: 'right', marginLeft: 6 },
  membersGrid: { flexDirection: 'row', flexWrap: 'wrap' },
  memberChip: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fafafa', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 6, marginRight: 6, marginBottom: 6, borderWidth: 1, borderColor: '#eee' },
  memberDot: { width: 6, height: 6, borderRadius: 3, marginRight: 4 },
  memberText: { fontSize: 11, color: '#333' },
  backendBadge: { flexDirection: 'row', alignItems: 'center', marginHorizontal: 16, marginBottom: 8, paddingHorizontal: 10, paddingVertical: 4, borderRadius: 12, alignSelf: 'flex-start' },
  backendText: { fontSize: 11, fontWeight: '700', marginLeft: 4, textTransform: 'uppercase', letterSpacing: 0.5 },
  graphStats: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 12 },
  graphStat: { alignItems: 'center' },
  graphStatValue: { fontSize: 18, fontWeight: '700', color: '#6C5CE7' },
  graphStatLabel: { fontSize: 10, color: '#999', marginTop: 2 },
  canvasContainer: { borderRadius: 8, overflow: 'hidden', marginVertical: 8 },
  graphHint: { fontSize: 11, color: '#999', textAlign: 'center', marginTop: 4, fontStyle: 'italic' },
  networkMapBtn: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#6C5CE7', paddingVertical: 14, borderRadius: 10 },
  networkMapBtnText: { color: '#fff', fontSize: 15, fontWeight: '700', marginLeft: 8 },
  networkMapHint: { fontSize: 12, color: '#999', textAlign: 'center', marginTop: 8 },
});
