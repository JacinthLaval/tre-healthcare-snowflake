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
import RiskGauge from '@/components/RiskGauge';
import PatientTimeline, { TimelineEvent } from '@/components/PatientTimeline';
import GovernanceBadge from '@/components/GovernanceBadge';

interface Patient {
  SAMPLE_ID: string;
  PATIENT_NAME: string;
  SUPERPOPULATION: string;
  POPULATION: string;
  DEMO_DX?: string;
}

interface PgxRow {
  gene: string;
  variant_name: string;
  rs_id: string;
  zygosity: string;
  medication: string;
  clinical_significance: string;
  allele1: string;
  allele2: string;
}

export default function PatientScreen() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [clinicalProfile, setClinicalProfile] = useState<any>(null);
  const [pgxVariants, setPgxVariants] = useState<PgxRow[]>([]);
  const [timelineEvents, setTimelineEvents] = useState<TimelineEvent[]>([]);
  const [riskScores, setRiskScores] = useState<{ d30: number; d90: number; d365: number } | null>(null);
  const [nextActions, setNextActions] = useState<string[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);

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
        SELECT SAMPLE_ID, PATIENT_NAME, SUPERPOPULATION, POPULATION,
          CASE SAMPLE_ID
            WHEN 'HG03163' THEN 'Stroke'
            WHEN 'NA19790' THEN 'ACS/Stent'
            WHEN 'HG00864' THEN 'Atrial Fibrillation'
            WHEN 'HG01162' THEN 'Chronic Pain'
            WHEN 'HG01597' THEN 'Depression'
            WHEN 'HG00233' THEN 'Epilepsy'
            WHEN 'HG01396' THEN 'Transplant'
            WHEN 'NA19648' THEN 'Cancer'
          END AS DEMO_DX
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_GENOME_MAPPING
        ORDER BY
          CASE WHEN SAMPLE_ID IN ('HG03163','NA19790','HG00864','HG01162','HG01597','HG00233','HG01396','NA19648') THEN 0 ELSE 1 END,
          PATIENT_NAME
        LIMIT 50
      `);
      setPatients(data as Patient[]);
    } catch (error) {
      console.error('Failed to load patients:', error);
    } finally {
      setIsLoadingPatients(false);
    }
  };

  const filteredPatients = patients.filter(p =>
    p.PATIENT_NAME.toLowerCase().includes(patientSearch.toLowerCase())
  );

  const handlePatientSelect = async (patient: Patient) => {
    setSelectedPatient(patient);
    setShowPatientPicker(false);
    setPatientSearch('');
    setClinicalProfile(null);
    setPgxVariants([]);
    setTimelineEvents([]);
    setRiskScores(null);
    setNextActions([]);
    setIsLoading(true);

    try {
      const client = getMCPClient();
      if (!client) return;

      let profileData: any = null;
      let pgxData: any = null;

      try {
        profileData = await client.executeSQL(
          `CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.GET_PATIENT_CLINICAL_PROFILE('${patient.SAMPLE_ID}')`
        );
      } catch (e) {
        console.error('Clinical profile failed:', e);
      }

      try {
        const dx = patient.DEMO_DX || 'General';
        pgxData = await client.executeSQL(
          `CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.SCAN_PHARMACOGENOMIC_VARIANTS('${patient.SAMPLE_ID}', '${dx}')`
        );
      } catch (e) {
        console.error('PGx scan failed:', e);
      }

      let profile: any = null;
      if (profileData && profileData[0]) {
        const profileJson = Object.values(profileData[0])[0];
        profile = typeof profileJson === 'string' ? JSON.parse(profileJson) : profileJson;
        setClinicalProfile(profile);
      }

      let variants: PgxRow[] = [];
      if (pgxData && pgxData[0]) {
        const resultJson = Object.values(pgxData[0])[0];
        const result = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
        if (result?.variants_of_interest) {
          const seen = new Set<string>();
          variants = result.variants_of_interest.filter((v: PgxRow) => {
            const key = `${v.gene}-${v.variant_name}`;
            if (seen.has(key)) return false;
            seen.add(key);
            return true;
          });
        }
        setPgxVariants(variants);
      }

      const events: TimelineEvent[] = [];
      if (profile) {
        const excludeKeywords = ['employment', 'finding', 'certificate', 'criminal', 'social', 'education'];
        (profile.conditions || []).forEach((c: string) => {
          if (!excludeKeywords.some(kw => c.toLowerCase().includes(kw))) {
            events.push({ date: '', type: 'condition', title: c });
          }
        });
        (profile.medications || []).forEach((m: string) => {
          events.push({ date: '', type: 'medication', title: m });
        });
      }
      setTimelineEvents(events);

      try {
        const riskRes = await fetch('http://localhost:8080/api/risk-score', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sample_id: patient.SAMPLE_ID }),
        });
        if (riskRes.ok) {
          const riskData = await riskRes.json();
          const scores = riskData.scores || {};
          setRiskScores({
            d30: scores['30d']?.risk_score ?? 0.15,
            d90: scores['90d']?.risk_score ?? 0.22,
            d365: scores['365d']?.risk_score ?? 0.31,
          });
        } else {
          setRiskScores({ d30: 0.15, d90: 0.22, d365: 0.31 });
        }
      } catch {
        setRiskScores({ d30: 0.15, d90: 0.22, d365: 0.31 });
      }

      const actions: string[] = [];
      const conditionsLower = (profile?.conditions || []).map((c: string) => c.toLowerCase()).join(' ');
      const hasCardiac = conditionsLower.includes('cardiac') || conditionsLower.includes('heart') ||
        conditionsLower.includes('coronary') || conditionsLower.includes('atrial') || conditionsLower.includes('stroke');
      const hasPain = conditionsLower.includes('pain');

      if (hasCardiac) {
        actions.push('Cardiology referral recommended');
        actions.push('ECG follow-up within 30 days');
      }
      if (variants.length > 0) {
        actions.push('Pharmacist consult for medication review');
        actions.push('Consider alternative dosing');
      }
      if (hasPain) {
        actions.push('Pain management referral');
        actions.push('Non-opioid alternatives assessment');
      }
      if (actions.length === 0) {
        actions.push('Annual wellness visit due');
        actions.push('Update immunizations');
      }
      setNextActions(actions);
    } catch (error) {
      console.error('Failed to load patient data:', error);
    } finally {
      setIsLoading(false);
    }
  };

  const getZygosityColor = (zygosity: string) => {
    if (zygosity === 'Homozygous ALT') return '#DC3545';
    if (zygosity === 'Heterozygous') return '#FFC107';
    return '#28A745';
  };

  const getActionIcon = (action: string): string => {
    if (action.toLowerCase().includes('cardiology') || action.toLowerCase().includes('ecg')) return 'heart';
    if (action.toLowerCase().includes('pharmacist') || action.toLowerCase().includes('dosing')) return 'flask';
    if (action.toLowerCase().includes('pain') || action.toLowerCase().includes('opioid')) return 'bandage';
    if (action.toLowerCase().includes('wellness')) return 'calendar';
    if (action.toLowerCase().includes('immunization')) return 'shield-checkmark';
    return 'arrow-forward-circle';
  };

  return (
    <ScrollView style={styles.container}>
      <GovernanceBadge />
      <View style={styles.section}>
        <Text style={styles.sectionTitle}>
          <Ionicons name="person" size={18} color="#29B5E8" /> Select Patient
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
                {selectedPatient ? selectedPatient.PATIENT_NAME : 'Choose a patient...'}
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
                placeholder="Search by name..."
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
                      <Text style={styles.patientInfo}>{patient.SUPERPOPULATION}</Text>
                    </View>
                    {patient.DEMO_DX && (
                      <View style={{ backgroundColor: '#29B5E8', borderRadius: 4, paddingHorizontal: 8, paddingVertical: 2 }}>
                        <Text style={{ color: '#fff', fontSize: 11, fontWeight: '600' }}>{patient.DEMO_DX}</Text>
                      </View>
                    )}
                  </View>
                </TouchableOpacity>
              ))}
              {filteredPatients.length === 0 && (
                <Text style={styles.noData}>No patients match "{patientSearch}"</Text>
              )}
            </ScrollView>
          </View>
        )}
      </View>

      {isLoading && (
        <View style={styles.loadingBox}>
          <ActivityIndicator size="large" color="#29B5E8" />
          <Text style={styles.loadingText}>Loading patient data...</Text>
        </View>
      )}

      {selectedPatient && !isLoading && (
        <>
          <View style={styles.section}>
            <View style={styles.headerCard}>
              <View style={styles.headerLeft}>
                <View style={styles.avatarCircle}>
                  <Ionicons name="person" size={28} color="#29B5E8" />
                </View>
                <View style={{ flex: 1 }}>
                  <Text style={styles.headerName}>{selectedPatient.PATIENT_NAME}</Text>
                  <Text style={styles.headerSub}>{selectedPatient.SUPERPOPULATION} ({selectedPatient.POPULATION})</Text>
                  <Text style={styles.headerSub}>Sample: {selectedPatient.SAMPLE_ID}</Text>
                </View>
              </View>
              {selectedPatient.DEMO_DX && (
                <View style={styles.dxBadge}>
                  <Text style={styles.dxBadgeText}>{selectedPatient.DEMO_DX}</Text>
                </View>
              )}
            </View>
          </View>

          {pgxVariants.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="flask" size={18} color="#6C5CE7" /> PGx Summary
              </Text>
              <View style={styles.pgxTable}>
                <View style={styles.pgxHeaderRow}>
                  <Text style={[styles.pgxCell, styles.pgxHeaderCell, { flex: 1 }]}>Gene</Text>
                  <Text style={[styles.pgxCell, styles.pgxHeaderCell, { flex: 1.2 }]}>Variant</Text>
                  <Text style={[styles.pgxCell, styles.pgxHeaderCell, { flex: 1 }]}>Zygosity</Text>
                  <Text style={[styles.pgxCell, styles.pgxHeaderCell, { flex: 1.5 }]}>Affected Drug</Text>
                </View>
                {pgxVariants.map((v, i) => (
                  <View key={i} style={[styles.pgxRow, i % 2 === 1 && { backgroundColor: '#f9f9f9' }]}>
                    <Text style={[styles.pgxCell, { flex: 1, fontWeight: '600', color: '#6C5CE7' }]}>{v.gene}</Text>
                    <Text style={[styles.pgxCell, { flex: 1.2 }]}>{v.variant_name}</Text>
                    <View style={{ flex: 1, paddingHorizontal: 4, paddingVertical: 6 }}>
                      <View style={[styles.zygBadge, { backgroundColor: getZygosityColor(v.zygosity) + '20' }]}>
                        <Text style={[styles.zygText, { color: getZygosityColor(v.zygosity) }]}>
                          {v.zygosity === 'Homozygous ALT' ? 'Hom' : v.zygosity === 'Heterozygous' ? 'Het' : 'WT'}
                        </Text>
                      </View>
                    </View>
                    <Text style={[styles.pgxCell, { flex: 1.5, color: '#29B5E8' }]}>{v.medication}</Text>
                  </View>
                ))}
              </View>
            </View>
          )}

          {riskScores && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="analytics" size={18} color="#DC3545" /> Risk Scores
              </Text>
              <Text style={styles.riskDisclaimer}>Placeholder scores — model integration in Wave 3</Text>
              <View style={styles.riskRow}>
                <RiskGauge score={riskScores.d30} label="30-Day" size={110} />
                <RiskGauge score={riskScores.d90} label="90-Day" size={110} />
                <RiskGauge score={riskScores.d365} label="365-Day" size={110} />
              </View>
            </View>
          )}

          {nextActions.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="checkmark-circle" size={18} color="#28A745" /> Next Best Actions
              </Text>
              {nextActions.map((action, i) => (
                <View key={i} style={styles.actionCard}>
                  <Ionicons name={getActionIcon(action) as any} size={20} color="#29B5E8" />
                  <Text style={styles.actionText}>{action}</Text>
                  <View style={styles.actionCheck}>
                    <Ionicons name="ellipse-outline" size={20} color="#ccc" />
                  </View>
                </View>
              ))}
            </View>
          )}

          {timelineEvents.length > 0 && (
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>
                <Ionicons name="time" size={18} color="#29B5E8" /> Clinical Timeline
              </Text>
              <PatientTimeline events={timelineEvents} maxHeight={500} />
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
  section: { backgroundColor: '#fff', margin: 12, padding: 16, borderRadius: 12, shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.1, shadowRadius: 4, elevation: 3 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginBottom: 12 },
  patientSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa' },
  patientSelectorText: { fontSize: 15, color: '#333' },
  patientList: { marginTop: 8, maxHeight: 300, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', padding: 8, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fafafa', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#333', padding: 4 },
  patientItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  patientName: { fontSize: 15, fontWeight: '500', color: '#333' },
  patientInfo: { fontSize: 13, color: '#666', marginTop: 2 },
  noData: { fontSize: 14, color: '#999', fontStyle: 'italic', textAlign: 'center', padding: 20 },
  loadingBox: { alignItems: 'center', padding: 40 },
  loadingText: { marginTop: 12, fontSize: 14, color: '#29B5E8', fontWeight: '500' },
  headerCard: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  headerLeft: { flexDirection: 'row', alignItems: 'center', flex: 1 },
  avatarCircle: { width: 52, height: 52, borderRadius: 26, backgroundColor: '#EBF5FB', alignItems: 'center', justifyContent: 'center', marginRight: 14 },
  headerName: { fontSize: 18, fontWeight: '700', color: '#333' },
  headerSub: { fontSize: 13, color: '#666', marginTop: 2 },
  dxBadge: { backgroundColor: '#29B5E8', borderRadius: 6, paddingHorizontal: 10, paddingVertical: 4 },
  dxBadgeText: { color: '#fff', fontSize: 12, fontWeight: '700' },
  pgxTable: { borderWidth: 1, borderColor: '#eee', borderRadius: 8, overflow: 'hidden' },
  pgxHeaderRow: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderBottomWidth: 1, borderBottomColor: '#ddd' },
  pgxHeaderCell: { fontWeight: '700', fontSize: 11, color: '#555', textTransform: 'uppercase' },
  pgxRow: { flexDirection: 'row', alignItems: 'center' },
  pgxCell: { paddingHorizontal: 8, paddingVertical: 8, fontSize: 12, color: '#333' },
  zygBadge: { paddingHorizontal: 6, paddingVertical: 2, borderRadius: 8, alignSelf: 'flex-start' },
  zygText: { fontSize: 10, fontWeight: '700' },
  riskRow: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 8 },
  riskDisclaimer: { fontSize: 11, color: '#999', fontStyle: 'italic', textAlign: 'center', marginBottom: 8 },
  actionCard: { flexDirection: 'row', alignItems: 'center', padding: 12, backgroundColor: '#f8f9fa', borderRadius: 8, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#29B5E8' },
  actionText: { flex: 1, marginLeft: 12, fontSize: 14, color: '#333', fontWeight: '500' },
  actionCheck: { marginLeft: 8 },
});
