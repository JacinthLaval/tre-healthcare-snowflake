import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  ScrollView,
  TouchableOpacity,
  ActivityIndicator,
  Platform,
  Animated,
  TextInput,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';
import { router } from 'expo-router';
import { getMCPClient, initMCPClient } from '@/services/mcp-client';
import GovernanceBadge from '@/components/GovernanceBadge';

type ScribeState = 'idle' | 'recording' | 'uploading' | 'transcribing' | 'generating' | 'complete';

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface NoteSection {
  soap_note?: string;
  icd10_codes?: string;
  medications?: string;
  pgx_alerts?: string;
  fhir_summary?: string;
}

interface EncounterResult {
  encounter_id: string;
  patient_id?: string;
  duration_seconds: number;
  segment_count: number;
  segments: TranscriptSegment[];
  transcript: string;
  raw_note: string;
  sections: NoteSection;
}

interface Patient {
  SAMPLE_ID: string;
  PATIENT_NAME: string;
  SUPERPOPULATION: string;
  POPULATION: string;
  DEMO_DX?: string;
}

interface PgxVariant {
  GENE: string;
  VARIANT_NAME: string;
  ZYGOSITY: string;
  ALT_ALLELE_COUNT: string;
}

function escapeSQL(str: string): string {
  return str.replace(/'/g, "''");
}

function formatPgxContext(variants: PgxVariant[]): string {
  if (variants.length === 0) return '';
  const lines = variants.map(v => {
    return `- ${v.GENE}: ${v.VARIANT_NAME}, ${v.ZYGOSITY} (ALT allele count: ${v.ALT_ALLELE_COUNT})`;
  });
  return `Pharmacogenomic Profile:\n${lines.join('\n')}`;
}

export default function ScribeScreen() {
  const [state, setState] = useState<ScribeState>('idle');
  const [duration, setDuration] = useState(0);
  const [result, setResult] = useState<EncounterResult | null>(null);
  const [activeTab, setActiveTab] = useState('soap_note');
  const [error, setError] = useState<string | null>(null);
  const [statusMessage, setStatusMessage] = useState('');
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);
  const [pgxVariants, setPgxVariants] = useState<PgxVariant[]>([]);
  const [isLoadingPgx, setIsLoadingPgx] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [savedToEhr, setSavedToEhr] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);

  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const scrollRef = useRef<ScrollView>(null);
  const pulseAnim = useRef(new Animated.Value(1)).current;

  const getActiveRole = () => Platform.OS === 'web' ? (localStorage.getItem('snowflake_active_role') || undefined) : undefined;

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
      `, 30, getActiveRole());
      setPatients(data as Patient[]);
    } catch (error) {
      console.error('Failed to load patients:', error);
    } finally {
      setIsLoadingPatients(false);
    }
  };

  const loadPgxVariants = async (patient: Patient) => {
    setIsLoadingPgx(true);
    setPgxVariants([]);
    try {
      const client = getMCPClient();
      if (!client) return;
      const data = await client.executeSQL(
        `SELECT GENE, VARIANT_NAME, ZYGOSITY, ALT_ALLELE_COUNT FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_PGX_PROFILES WHERE SAMPLE_ID = '${escapeSQL(patient.SAMPLE_ID)}' ORDER BY GENE`, 30, getActiveRole()
      );
      setPgxVariants(data as unknown as PgxVariant[]);
    } catch (e) {
      console.error('Failed to load PGx variants:', e);
    } finally {
      setIsLoadingPgx(false);
    }
  };

  const filteredPatients = patients.filter(p =>
    p.PATIENT_NAME.toLowerCase().includes(patientSearch.toLowerCase())
  );

  useEffect(() => {
    if (state === 'recording') {
      Animated.loop(
        Animated.sequence([
          Animated.timing(pulseAnim, { toValue: 1.2, duration: 700, useNativeDriver: true }),
          Animated.timing(pulseAnim, { toValue: 1, duration: 700, useNativeDriver: true }),
        ])
      ).start();
    } else {
      pulseAnim.setValue(1);
    }
  }, [state]);

  useEffect(() => {
    if (state === 'recording') {
      timerRef.current = setInterval(() => setDuration(d => d + 1), 1000);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
      timerRef.current = null;
    }
    return () => { if (timerRef.current) clearInterval(timerRef.current); };
  }, [state]);

  const fmt = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m}:${s.toString().padStart(2, '0')}`;
  };

  const startRecording = useCallback(async () => {
    setError(null);
    setResult(null);
    setDuration(0);
    chunksRef.current = [];

    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true },
      });

      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = () => {
        stream.getTracks().forEach(t => t.stop());
      };

      recorder.start(1000);
      setState('recording');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Microphone access denied');
    }
  }, []);

  const stopAndProcess = useCallback(async () => {
    const recorder = mediaRecorderRef.current;
    if (!recorder || recorder.state !== 'recording') return;

    setState('uploading');
    setStatusMessage('Preparing audio...');

    await new Promise<void>((resolve) => {
      recorder.onstop = () => {
        recorder.stream.getTracks().forEach(t => t.stop());
        resolve();
      };
      recorder.stop();
    });

    const audioBlob = new Blob(chunksRef.current, { type: 'audio/webm' });
    const encounterId = `enc_${Date.now()}`;

    try {
      setState('transcribing');
      setStatusMessage(`Transcribing ${fmt(duration)} of audio with Whisper large-v3...`);

      const formData = new FormData();
      formData.append('audio', audioBlob, `${encounterId}.webm`);
      formData.append('encounter_id', encounterId);
      formData.append('language', 'en');
      if (selectedPatient) {
        formData.append('patient_id', selectedPatient.SAMPLE_ID);
        formData.append('patient_context', `Patient: ${selectedPatient.PATIENT_NAME}, Ancestry: ${selectedPatient.SUPERPOPULATION} (${selectedPatient.POPULATION})`);
        if (pgxVariants.length > 0) {
          formData.append('pgx_context', formatPgxContext(pgxVariants));
        }
      }

      const scribeUrl = getScribeUrl();
      const resp = await fetch(`${scribeUrl}/api/transcribe-and-note`, {
        method: 'POST',
        body: formData,
      });

      if (!resp.ok) {
        const errData = await resp.json().catch(() => ({}));
        throw new Error(errData.error || `Server error: ${resp.status}`);
      }

      const data: EncounterResult = await resp.json();
      setResult(data);
      setActiveTab('soap_note');
      setState('complete');
      setStatusMessage('');
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Processing failed');
      setState('idle');
      setStatusMessage('');
    }
  }, [duration, selectedPatient, pgxVariants]);

  const saveToEhr = async () => {
    if (!result || !selectedPatient || isSaving || savedToEhr) return;
    setIsSaving(true);
    setSaveError(null);
    try {
      const client = getMCPClient();
      if (!client) throw new Error('MCP client not initialized');
      const encId = `ENC-${Date.now()}`;
      const patId = escapeSQL(selectedPatient.SAMPLE_ID);
      const dur = Math.floor(result.duration_seconds);
      const transcript = escapeSQL(result.transcript || '');
      const soap = escapeSQL(result.sections.soap_note || '');
      const icd10 = escapeSQL(result.sections.icd10_codes || '');
      const meds = escapeSQL(result.sections.medications || '');
      const pgxAlerts = escapeSQL(result.sections.pgx_alerts || '');
      const fhir = escapeSQL(result.sections.fhir_summary || '{}');
      const rawNote = escapeSQL(result.raw_note || '');
      const sql = `CALL TRE_HEALTHCARE_DB.FHIR_STAGING.SAVE_ENCOUNTER_NOTE('${encId}', '${patId}', ${dur}, '${transcript}', '${soap}', '${icd10}', '${meds}', '${pgxAlerts}', PARSE_JSON('${fhir}'), '${rawNote}')`;
      await client.executeSQL(sql, 60, getActiveRole());
      setSavedToEhr(true);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'Failed to save');
    } finally {
      setIsSaving(false);
    }
  };

  const resetSession = () => {
    setState('idle');
    setResult(null);
    setError(null);
    setDuration(0);
    setStatusMessage('');
    setSelectedPatient(null);
    setPgxVariants([]);
    setSavedToEhr(false);
    setSaveError(null);
  };

  const noteTabs = [
    { key: 'soap_note', label: 'SOAP', icon: 'document-text' },
    { key: 'icd10_codes', label: 'ICD-10', icon: 'barcode' },
    { key: 'medications', label: 'Meds', icon: 'medical' },
    { key: 'pgx_alerts', label: 'PGx', icon: 'warning' },
    { key: 'fhir_summary', label: 'FHIR', icon: 'code-slash' },
  ];

  const isProcessing = state === 'uploading' || state === 'transcribing' || state === 'generating';

  return (
    <ScrollView style={styles.container} ref={scrollRef}>
      <GovernanceBadge />

      {state === 'idle' && !result && (
        <>
          <View style={styles.patientSection}>
            <View style={styles.sectionRow}>
              <Ionicons name="person" size={18} color="#29B5E8" />
              <Text style={styles.sectionTitle}>Select Patient</Text>
            </View>
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
                    <TouchableOpacity
                      key={patient.SAMPLE_ID}
                      style={styles.patientItem}
                      onPress={() => {
                        setSelectedPatient(patient);
                        setShowPatientPicker(false);
                        setPatientSearch('');
                        loadPgxVariants(patient);
                      }}
                    >
                      <View style={{ flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' }}>
                        <View style={{ flex: 1 }}>
                          <Text style={styles.patientName}>{patient.PATIENT_NAME}</Text>
                          <Text style={styles.patientInfo}>{patient.SUPERPOPULATION} ({patient.POPULATION})</Text>
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
            {selectedPatient && (
              <View style={styles.patientDetails}>
                <Text style={styles.detailText}><Text style={styles.detailLabel}>Sample ID:</Text> {selectedPatient.SAMPLE_ID}</Text>
                <Text style={styles.detailText}><Text style={styles.detailLabel}>Ancestry:</Text> {selectedPatient.SUPERPOPULATION} ({selectedPatient.POPULATION})</Text>
              </View>
            )}
            {selectedPatient && (
              <View style={styles.pgxBadge}>
                {isLoadingPgx ? (
                  <ActivityIndicator size="small" color="#29B5E8" />
                ) : (
                  <>
                    <Ionicons name="flask" size={14} color="#29B5E8" />
                    <Text style={styles.pgxBadgeText}>
                      {pgxVariants.length > 0 ? `${pgxVariants.length} PGx variants loaded` : 'No PGx variants found'}
                    </Text>
                  </>
                )}
              </View>
            )}
          </View>

          <View style={styles.hero}>
            <View style={styles.micCircle}>
              <Ionicons name="mic" size={44} color="#29B5E8" />
            </View>
            <Text style={styles.heroTitle}>Ambient Scribe</Text>
            <Text style={styles.heroSub}>
              {selectedPatient
                ? `Recording encounter for ${selectedPatient.PATIENT_NAME}`
                : 'Select a patient above, then record the encounter.'}
            </Text>
            <TouchableOpacity
              style={[styles.bigButton, !selectedPatient && { opacity: 0.4 }]}
              onPress={startRecording}
              activeOpacity={0.7}
              disabled={!selectedPatient}
            >
              <View style={styles.bigButtonInner}>
                <Ionicons name="mic" size={32} color="#fff" />
              </View>
              <Text style={styles.bigButtonLabel}>Start Encounter</Text>
            </TouchableOpacity>
          </View>
        </>
      )}

      {state === 'recording' && (
        <View style={styles.recordingCard}>
          <View style={styles.recordingTop}>
            <Animated.View style={[styles.pulseDot, { transform: [{ scale: pulseAnim }] }]}>
              <View style={styles.pulseDotInner} />
            </Animated.View>
            <Text style={styles.recordingLabel}>Recording</Text>
            <Text style={styles.timer}>{fmt(duration)}</Text>
          </View>
          <View style={styles.waveHint}>
            <Ionicons name="volume-medium" size={20} color="#999" />
            <Text style={styles.waveHintText}>Listening to conversation...</Text>
          </View>
          <TouchableOpacity style={styles.stopButton} onPress={stopAndProcess} activeOpacity={0.7}>
            <View style={styles.stopSquare} />
            <Text style={styles.stopText}>End Encounter</Text>
          </TouchableOpacity>
        </View>
      )}

      {isProcessing && (
        <View style={styles.processingCard}>
          <ActivityIndicator size="large" color="#6C5CE7" />
          <Text style={styles.processingTitle}>
            {state === 'uploading' ? 'Preparing...' :
             state === 'transcribing' ? 'Transcribing & Generating Note...' :
             'Generating Clinical Note...'}
          </Text>
          <Text style={styles.processingSub}>{statusMessage}</Text>
          <View style={styles.processingSteps}>
            <StepIndicator label="Capture Audio" done={true} />
            <StepIndicator label="Whisper Transcription" done={state !== 'uploading'} active={state === 'transcribing'} />
            <StepIndicator label="Clinical Note (Cortex AI)" done={false} active={state === 'generating'} />
          </View>
        </View>
      )}

      {result && (
        <>
          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Ionicons name="chatbubbles" size={18} color="#29B5E8" />
              <Text style={styles.sectionTitle}>Transcript</Text>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{result.segment_count} segments</Text>
              </View>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{fmt(Math.floor(result.duration_seconds))}</Text>
              </View>
            </View>
            <View style={styles.transcriptBox}>
              {result.segments.map((seg, i) => (
                <View key={i} style={styles.segRow}>
                  <Text style={styles.segTime}>{fmt(Math.floor(seg.start))}</Text>
                  <Text style={styles.segText}>{seg.text}</Text>
                </View>
              ))}
            </View>
          </View>

          <View style={styles.section}>
            <View style={styles.sectionRow}>
              <Ionicons name="document-text" size={18} color="#6C5CE7" />
              <Text style={styles.sectionTitle}>Clinical Documentation</Text>
            </View>

            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.tabs}>
              {noteTabs.map(tab => (
                <TouchableOpacity
                  key={tab.key}
                  style={[styles.tab, activeTab === tab.key && styles.tabActive]}
                  onPress={() => setActiveTab(tab.key)}
                >
                  <Ionicons name={tab.icon as any} size={13} color={activeTab === tab.key ? '#fff' : '#666'} />
                  <Text style={[styles.tabLabel, activeTab === tab.key && styles.tabLabelActive]}>
                    {tab.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </ScrollView>

            <View style={styles.noteBox}>
              <Text style={styles.noteText}>
                {result.sections[activeTab as keyof NoteSection] || 'No content for this section.'}
              </Text>
            </View>
          </View>
        </>
      )}

      {error && (
        <View style={styles.errorBox}>
          <Ionicons name="alert-circle" size={18} color="#DC3545" />
          <Text style={styles.errorText}>{error}</Text>
        </View>
      )}

      {result && (
        <View style={styles.ehrSection}>
          {saveError && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={16} color="#DC3545" />
              <Text style={styles.errorText}>{saveError}</Text>
            </View>
          )}
          {savedToEhr ? (
            <View style={styles.savedBadge}>
              <Ionicons name="checkmark-circle" size={18} color="#28A745" />
              <Text style={styles.savedBadgeText}>Saved to EHR</Text>
            </View>
          ) : (
            <TouchableOpacity
              style={[styles.saveButton, isSaving && { opacity: 0.6 }]}
              onPress={saveToEhr}
              disabled={isSaving}
              activeOpacity={0.7}
            >
              {isSaving ? (
                <ActivityIndicator size="small" color="#fff" />
              ) : (
                <Ionicons name="cloud-upload" size={18} color="#fff" />
              )}
              <Text style={styles.saveButtonText}>{isSaving ? 'Saving...' : 'Save to EHR'}</Text>
            </TouchableOpacity>
          )}
        </View>
      )}

      {(state === 'complete' || result) && (
        <TouchableOpacity style={styles.newButton} onPress={resetSession}>
          <Ionicons name="refresh" size={18} color="#29B5E8" />
          <Text style={styles.newButtonText}>New Encounter</Text>
        </TouchableOpacity>
      )}

      <View style={{ height: 40 }} />
    </ScrollView>
  );
}

function StepIndicator({ label, done, active }: { label: string; done: boolean; active?: boolean }) {
  return (
    <View style={siStyles.row}>
      <View style={[siStyles.dot, done && siStyles.dotDone, active && siStyles.dotActive]}>
        {done && <Ionicons name="checkmark" size={10} color="#fff" />}
      </View>
      <Text style={[siStyles.label, done && siStyles.labelDone, active && siStyles.labelActive]}>{label}</Text>
    </View>
  );
}

const siStyles = StyleSheet.create({
  row: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  dot: { width: 18, height: 18, borderRadius: 9, borderWidth: 2, borderColor: '#ddd', alignItems: 'center', justifyContent: 'center', marginRight: 10 },
  dotDone: { backgroundColor: '#28A745', borderColor: '#28A745' },
  dotActive: { borderColor: '#6C5CE7' },
  label: { fontSize: 13, color: '#999' },
  labelDone: { color: '#28A745' },
  labelActive: { color: '#6C5CE7', fontWeight: '600' },
});

function getScribeUrl(): string {
  return 'http://localhost:8080';
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  patientSection: {
    backgroundColor: '#fff', margin: 12, marginBottom: 0, padding: 16, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  patientSelector: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: 12, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fafafa' },
  patientSelectorText: { fontSize: 15, color: '#333' },
  patientList: { marginTop: 8, maxHeight: 300, borderWidth: 1, borderColor: '#ddd', borderRadius: 8, backgroundColor: '#fff' },
  searchContainer: { flexDirection: 'row', alignItems: 'center', padding: 8, borderBottomWidth: 1, borderBottomColor: '#eee', backgroundColor: '#fafafa', borderTopLeftRadius: 8, borderTopRightRadius: 8 },
  searchInput: { flex: 1, fontSize: 14, color: '#333', padding: 4 },
  patientItem: { padding: 12, borderBottomWidth: 1, borderBottomColor: '#eee' },
  patientName: { fontSize: 15, fontWeight: '500', color: '#333' },
  patientInfo: { fontSize: 13, color: '#666', marginTop: 2 },
  patientDetails: { marginTop: 12, padding: 12, backgroundColor: '#f0f9ff', borderRadius: 8 },
  detailText: { fontSize: 14, color: '#333', marginBottom: 4 },
  detailLabel: { fontWeight: '600' },
  noData: { fontSize: 14, color: '#999', fontStyle: 'italic', textAlign: 'center', padding: 20 },
  hero: { alignItems: 'center', paddingTop: 24, paddingBottom: 24, paddingHorizontal: 24 },
  micCircle: {
    width: 80, height: 80, borderRadius: 40, backgroundColor: '#EBF5FB',
    alignItems: 'center', justifyContent: 'center', marginBottom: 14,
  },
  heroTitle: { fontSize: 24, fontWeight: '700', color: '#333' },
  heroSub: { fontSize: 13, color: '#888', textAlign: 'center', marginTop: 8, lineHeight: 19 },
  bigButton: { alignItems: 'center', marginTop: 28 },
  bigButtonInner: {
    width: 72, height: 72, borderRadius: 36, backgroundColor: '#DC3545',
    alignItems: 'center', justifyContent: 'center',
    shadowColor: '#DC3545', shadowOffset: { width: 0, height: 4 }, shadowOpacity: 0.35, shadowRadius: 10, elevation: 8,
  },
  bigButtonLabel: { marginTop: 10, fontSize: 14, fontWeight: '600', color: '#DC3545' },
  recordingCard: {
    backgroundColor: '#fff', margin: 12, borderRadius: 14, padding: 20,
    borderLeftWidth: 4, borderLeftColor: '#DC3545',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  recordingTop: { flexDirection: 'row', alignItems: 'center', marginBottom: 16 },
  pulseDot: {
    width: 18, height: 18, borderRadius: 9, backgroundColor: 'rgba(220,53,69,0.15)',
    alignItems: 'center', justifyContent: 'center',
  },
  pulseDotInner: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#DC3545' },
  recordingLabel: { flex: 1, fontSize: 16, fontWeight: '600', color: '#DC3545', marginLeft: 10 },
  timer: { fontSize: 22, fontWeight: '700', color: '#333', fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  waveHint: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', marginBottom: 18 },
  waveHintText: { fontSize: 13, color: '#999', marginLeft: 6 },
  stopButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#333', paddingVertical: 14, borderRadius: 30,
  },
  stopSquare: { width: 16, height: 16, borderRadius: 3, backgroundColor: '#fff' },
  stopText: { color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 10 },
  processingCard: {
    backgroundColor: '#fff', margin: 12, borderRadius: 14, padding: 28, alignItems: 'center',
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  processingTitle: { fontSize: 16, fontWeight: '600', color: '#6C5CE7', marginTop: 16, marginBottom: 4 },
  processingSub: { fontSize: 12, color: '#999', marginBottom: 18, textAlign: 'center' },
  processingSteps: { alignSelf: 'flex-start', paddingLeft: 20, marginTop: 8 },
  section: {
    backgroundColor: '#fff', margin: 12, padding: 16, borderRadius: 14,
    shadowColor: '#000', shadowOffset: { width: 0, height: 2 }, shadowOpacity: 0.08, shadowRadius: 6, elevation: 3,
  },
  sectionRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 12 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333', marginLeft: 8, flex: 1 },
  badge: { backgroundColor: '#f0f0f0', borderRadius: 10, paddingHorizontal: 8, paddingVertical: 2, marginLeft: 6 },
  badgeText: { fontSize: 11, color: '#666', fontWeight: '600' },
  transcriptBox: { maxHeight: 280 },
  segRow: { flexDirection: 'row', paddingVertical: 5, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  segTime: {
    width: 44, fontSize: 11, color: '#aaa', paddingTop: 2,
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
  },
  segText: { flex: 1, fontSize: 14, color: '#333', lineHeight: 20 },
  tabs: { flexDirection: 'row', marginBottom: 12 },
  tab: {
    flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 12,
    borderRadius: 16, backgroundColor: '#f0f0f0', marginRight: 8,
  },
  tabActive: { backgroundColor: '#6C5CE7' },
  tabLabel: { fontSize: 12, fontWeight: '600', color: '#666', marginLeft: 4 },
  tabLabelActive: { color: '#fff' },
  noteBox: { backgroundColor: '#f9f9f9', borderRadius: 10, padding: 14, minHeight: 200 },
  noteText: { fontSize: 13, color: '#333', lineHeight: 21 },
  errorBox: {
    flexDirection: 'row', alignItems: 'center', backgroundColor: '#fde8e8',
    margin: 12, padding: 14, borderRadius: 10,
  },
  errorText: { flex: 1, marginLeft: 8, fontSize: 13, color: '#DC3545' },
  newButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', padding: 16, margin: 12 },
  newButtonText: { fontSize: 15, color: '#29B5E8', fontWeight: '600', marginLeft: 6 },
  pgxBadge: {
    flexDirection: 'row', alignItems: 'center', marginTop: 8, paddingVertical: 6,
    paddingHorizontal: 10, backgroundColor: '#EBF5FB', borderRadius: 8,
  },
  pgxBadgeText: { fontSize: 12, color: '#29B5E8', fontWeight: '600', marginLeft: 6 },
  ehrSection: { marginHorizontal: 12, marginTop: 4 },
  saveButton: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#29B5E8', paddingVertical: 14, borderRadius: 30,
  },
  saveButtonText: { color: '#fff', fontSize: 15, fontWeight: '600', marginLeft: 8 },
  savedBadge: {
    flexDirection: 'row', alignItems: 'center', justifyContent: 'center',
    backgroundColor: '#e6f9ed', paddingVertical: 12, borderRadius: 30,
  },
  savedBadgeText: { color: '#28A745', fontSize: 15, fontWeight: '600', marginLeft: 6 },
});
