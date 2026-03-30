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

interface Patient {
  SAMPLE_ID: string;
  PATIENT_NAME: string;
  SUPERPOPULATION: string;
  POPULATION: string;
  DEMO_DX?: string;
}

interface PharmacoVariant {
  gene: string;
  variant_name: string;
  rs_id: string;
  chrom: string;
  pos: number;
  ref_allele: string;
  alt_allele: string;
  allele1: string;
  allele2: string;
  zygosity: string;
  medication: string;
  clinical_significance: string;
  cpic_guideline: string;
  is_variant: boolean;
}

interface GenomeScanResult {
  diagnosis: string;
  genes_scanned: string[];
  variants_of_interest: PharmacoVariant[];
  all_results: PharmacoVariant[];
}

interface Evo2VariantResult {
  variant_name: string;
  gene: string;
  ref_base: string;
  alt_base: string;
  ref_score: number;
  alt_score: number;
  delta_score: number;
  prediction: string;
}

interface ClinicalProfile {
  conditions: string[];
  medications: string[];
  cyp2c19: {
    phenotype: string;
    recommendation: string;
    variants: { variant: string; rs_id: string; allele1: string; allele2: string; status: string }[];
  };
}

const DIAGNOSES = [
  { label: 'Stroke', icon: 'pulse', notes: 'Patient had ischemic stroke, now stable. Need antiplatelet therapy for secondary prevention. Considering clopidogrel vs alternatives.' },
  { label: 'ACS/Stent', icon: 'heart', notes: 'Patient with acute coronary syndrome, underwent PCI with drug-eluting stent. Need dual antiplatelet therapy (DAPT).' },
  { label: 'Atrial Fibrillation', icon: 'fitness', notes: 'Patient with atrial fibrillation, CHA2DS2-VASc score indicates anticoagulation needed.' },
  { label: 'Chronic Pain', icon: 'bandage', notes: 'Patient with chronic pain requiring opioid therapy. Need to assess metabolizer status.' },
  { label: 'Depression', icon: 'cloudy-night', notes: 'Patient presenting with major depressive disorder. Evaluating SSRI/TCA therapy options.' },
  { label: 'Epilepsy', icon: 'flash', notes: 'Patient with new-onset seizures. Evaluating antiepileptic drug options.' },
  { label: 'Transplant', icon: 'swap-horizontal', notes: 'Post-transplant patient requiring immunosuppression with tacrolimus.' },
  { label: 'Cancer', icon: 'cellular', notes: 'Patient with solid tumor malignancy. Evaluating fluoropyrimidine-based chemotherapy.' },
];

const MOCK_EVO2_SCORES: Record<string, Partial<Evo2VariantResult>> = {
  'CYP2C19*2': { delta_score: -0.7674, prediction: 'Likely pathogenic', ref_score: -0.1243, alt_score: -0.8917 },
  'CYP2C19*3': { delta_score: -0.4343, prediction: 'Possibly damaging', ref_score: -0.0891, alt_score: -0.5234 },
  'CYP2C19*17': { delta_score: 0.1473, prediction: 'Possibly beneficial', ref_score: -0.2105, alt_score: -0.0632 },
  'CYP2C9*2': { delta_score: -0.3821, prediction: 'Possibly damaging', ref_score: -0.0567, alt_score: -0.4388 },
  'CYP2C9*3': { delta_score: -0.6102, prediction: 'Likely pathogenic', ref_score: -0.0412, alt_score: -0.6514 },
  'VKORC1 -1639G>A': { delta_score: -0.2918, prediction: 'Possibly damaging', ref_score: -0.1034, alt_score: -0.3952 },
  'SLCO1B1*5': { delta_score: -0.5531, prediction: 'Likely pathogenic', ref_score: -0.0823, alt_score: -0.6354 },
  'SLCO1B1*1B': { delta_score: -0.0842, prediction: 'Benign/Neutral', ref_score: -0.1567, alt_score: -0.2409 },
  'CYP2D6*4': { delta_score: -0.8213, prediction: 'Likely pathogenic', ref_score: -0.0345, alt_score: -0.8558 },
  'CYP2D6*10': { delta_score: -0.3456, prediction: 'Possibly damaging', ref_score: -0.1123, alt_score: -0.4579 },
  'CYP3A5*3': { delta_score: -0.4789, prediction: 'Possibly damaging', ref_score: -0.0678, alt_score: -0.5467 },
  'DPYD*2A': { delta_score: -0.9341, prediction: 'Likely pathogenic', ref_score: -0.0156, alt_score: -0.9497 },
};

export default function ERConsoleScreen() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [selectedDiagnosis, setSelectedDiagnosis] = useState<typeof DIAGNOSES[0] | null>(null);
  const [clinicalProfile, setClinicalProfile] = useState<ClinicalProfile | null>(null);
  const [genomeScan, setGenomeScan] = useState<GenomeScanResult | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [showClinicalProfile, setShowClinicalProfile] = useState(false);
  const [showAllResults, setShowAllResults] = useState(false);
  const [evo2Results, setEvo2Results] = useState<Record<string, Evo2VariantResult>>({});
  const [isLoadingEvo2, setIsLoadingEvo2] = useState(false);
  const [evo2Error, setEvo2Error] = useState<string | null>(null);
  const [showAllConditions, setShowAllConditions] = useState(false);
  const [showAllMedications, setShowAllMedications] = useState(false);
  const [patientSearch, setPatientSearch] = useState('');

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

  const loadClinicalProfile = async (sampleId: string) => {
    setIsLoadingProfile(true);
    try {
      const client = getMCPClient();
      if (!client) return;
      const data = await client.executeSQL(
        `CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.GET_PATIENT_CLINICAL_PROFILE('${sampleId}')`
      );
      if (data && data[0]) {
        const profileJson = Object.values(data[0])[0];
        const profile = typeof profileJson === 'string' ? JSON.parse(profileJson) : profileJson;
        setClinicalProfile(profile);
      }
    } catch (error) {
      console.error('Failed to load clinical profile:', error);
    } finally {
      setIsLoadingProfile(false);
    }
  };

  const scanGenome = async (sampleId: string, diagnosis: string) => {
    setIsScanning(true);
    setGenomeScan(null);
    setEvo2Results({});
    setEvo2Error(null);
    try {
      const client = getMCPClient();
      if (!client) return;
      const data = await client.executeSQL(
        `CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.SCAN_PHARMACOGENOMIC_VARIANTS('${sampleId}', '${diagnosis}')`
      );
      if (data && data[0]) {
        const resultJson = Object.values(data[0])[0];
        const result = typeof resultJson === 'string' ? JSON.parse(resultJson) : resultJson;
        setGenomeScan(result);
      }
    } catch (error) {
      console.error('Failed to scan genome:', error);
    } finally {
      setIsScanning(false);
    }
  };

  const resetAll = () => {
    setSelectedDiagnosis(null);
    setClinicalProfile(null);
    setGenomeScan(null);
    setClinicalNotes('');
    setRecommendation('');
    setEvo2Results({});
    setEvo2Error(null);
    setShowClinicalProfile(false);
    setShowAllResults(false);
    setShowAllConditions(false);
    setShowAllMedications(false);
  };

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setShowPatientPicker(false);
    setPatientSearch('');
    resetAll();
    loadClinicalProfile(patient.SAMPLE_ID);
  };

  const handleDiagnosisSelect = (diagnosis: typeof DIAGNOSES[0]) => {
    setSelectedDiagnosis(diagnosis);
    setClinicalNotes(diagnosis.notes);
    setRecommendation('');
    setEvo2Results({});
    setEvo2Error(null);
    setShowAllResults(false);
    if (selectedPatient) {
      scanGenome(selectedPatient.SAMPLE_ID, diagnosis.label);
    }
  };

  const filteredPatients = patients.filter(p =>
    p.PATIENT_NAME.toLowerCase().includes(patientSearch.toLowerCase())
  );

  const scoreWithEvo2 = async () => {
    if (!genomeScan?.variants_of_interest?.length) return;
    setIsLoadingEvo2(true);
    setEvo2Error(null);
    setEvo2Results({});
    try {
      await new Promise(resolve => setTimeout(resolve, 1800));
      const results: Record<string, Evo2VariantResult> = {};
      for (const v of genomeScan.variants_of_interest) {
        const mock = MOCK_EVO2_SCORES[v.variant_name];
        if (mock) {
          results[v.variant_name] = {
            variant_name: v.variant_name,
            gene: v.gene,
            ref_base: v.ref_allele,
            alt_base: v.alt_allele,
            ref_score: mock.ref_score!,
            alt_score: mock.alt_score!,
            delta_score: mock.delta_score!,
            prediction: mock.prediction!,
          };
        }
      }
      if (Object.keys(results).length === 0) {
        setEvo2Error('No mock Evo2 scores available for these variants');
      } else {
        setEvo2Results(results);
      }
    } catch (error) {
      setEvo2Error(error instanceof Error ? error.message : 'Failed to score variants');
    } finally {
      setIsLoadingEvo2(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedPatient || !clinicalProfile || !clinicalNotes || !selectedDiagnosis) return;
    setIsAnalyzing(true);
    setRecommendation('');
    try {
      const client = getMCPClient();
      if (!client) return;

      const conditions = filterClinicalConditions(clinicalProfile.conditions || []);
      const medications = clinicalProfile.medications || [];

      let genomicInfo = '';
      if (genomeScan) {
        genomicInfo = `\nPHARMACOGENOMIC SCAN RESULTS (Diagnosis: ${selectedDiagnosis.label}):`;
        genomicInfo += `\nGenes Scanned: ${genomeScan.genes_scanned.join(', ')}`;
        if (genomeScan.variants_of_interest.length > 0) {
          genomicInfo += '\nVARIANTS OF INTEREST (non-reference):';
          const seen = new Set();
          genomeScan.variants_of_interest.forEach(v => {
            const key = `${v.gene}-${v.variant_name}`;
            if (!seen.has(key)) {
              seen.add(key);
              genomicInfo += `\n  - ${v.gene} ${v.variant_name} (${v.rs_id}): ${v.allele1}/${v.allele2} [${v.zygosity}]`;
              genomicInfo += `\n    Medication affected: ${v.medication}`;
              genomicInfo += `\n    Significance: ${v.clinical_significance}`;
              genomicInfo += `\n    Guideline: ${v.cpic_guideline}`;
            }
          });
        } else {
          genomicInfo += '\nNo non-reference pharmacogenomic variants detected - all scanned positions are wild-type.';
        }
      }

      let evo2Info = '';
      if (Object.keys(evo2Results).length > 0) {
        evo2Info = '\nEVO2 GENOMIC FOUNDATION MODEL - FUNCTIONAL IMPACT SCORES:';
        Object.entries(evo2Results).forEach(([variant, result]) => {
          evo2Info += `\n- ${result.gene} ${variant}: delta_score=${result.delta_score.toFixed(4)}, prediction=${result.prediction}`;
        });
        evo2Info += '\n(Negative delta = more disruptive. < -0.5 = Likely pathogenic, -0.5 to -0.1 = Possibly damaging, -0.1 to 0.1 = Benign/Neutral, > 0.1 = Possibly beneficial)';
      }

      const hasEvo2 = Object.keys(evo2Results).length > 0;
      const genesFound = genomeScan?.variants_of_interest.map(v => v.gene).filter((g, i, a) => a.indexOf(g) === i).join(', ') || 'none';

      const query = `You are a clinical pharmacogenomics advisor with access to PubMed and ClinicalTrials.gov.

PATIENT INFORMATION:
- Name: ${selectedPatient.PATIENT_NAME}
- Sample ID: ${selectedPatient.SAMPLE_ID}
- Ancestry: ${selectedPatient.SUPERPOPULATION} (${selectedPatient.POPULATION})
- Admission Diagnosis: ${selectedDiagnosis.label}
${genomicInfo}
${evo2Info}

PATIENT'S CURRENT CONDITIONS (from EHR):
${conditions.slice(0, 10).map(c => '- ' + c).join('\n')}

PATIENT'S CURRENT MEDICATIONS (from EHR):
${medications.slice(0, 10).map(m => '- ' + m).join('\n')}

CLINICAL NOTES (ER presentation):
${clinicalNotes}

Based on this patient's clinical data, provide TWO distinct scenarios to highlight the value of precision medicine.

IMPORTANT: You MUST structure your response with EXACTLY these two sections using these exact headers:

---STANDARD_CARE---
Provide the recommendation a clinician would make using ONLY the clinical notes, conditions, and medications above — WITHOUT any pharmacogenomic data. This represents conventional standard of care for ${selectedDiagnosis.label}. Include:
- Likely drug choice and dosing based on guidelines
- Standard monitoring plan
- Potential risks the clinician would NOT be aware of without genomic data
- Relevant clinical trial options based on condition alone

---PRECISION_MEDICINE---
Now provide the IMPROVED recommendation incorporating ALL available pharmacogenomic data across all genes tested (${genesFound})${hasEvo2 ? ' and Evo2 functional impact scores' : ''}. Include:
- How each gene's variant data impacts drug selection for ${selectedDiagnosis.label}
- Specific risks identified by genotype that standard care would miss
- Drug-gene interactions across ALL detected variants, not just one gene
${hasEvo2 ? '- Evo2 functional impact interpretation and how it strengthens the recommendation\n' : ''}- Evidence-based alternative therapies supported by pharmacogenomic data
- Genotype-matched clinical trials from ClinicalTrials.gov
- PubMed evidence supporting the precision approach
- Concrete actionable guidance
- Key references

Search ClinicalTrials.gov and PubMed to support both scenarios with real evidence.`;

      const escapedQuery = query.replace(/'/g, "''");
      const data = await client.executeSQL(
        `CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CALL_NEO_RESEARCH_AGENT('${escapedQuery}')`, 0
      );
      if (data && data[0]) {
        const response = Object.values(data[0])[0] as string;
        try {
          const parsed = JSON.parse(response);
          const textContent = parsed.content?.find((c: { type: string }) => c.type === 'text');
          setRecommendation(textContent?.text || response);
        } catch {
          setRecommendation(response);
        }
      }
    } catch (error) {
      setRecommendation(`Error: ${error instanceof Error ? error.message : 'Analysis failed'}`);
    } finally {
      setIsAnalyzing(false);
    }
  };

  const getEvo2Color = (delta: number) => {
    if (delta < -0.5) return '#DC3545';
    if (delta < -0.1) return '#FFC107';
    if (delta < 0.1) return '#28A745';
    return '#17A2B8';
  };

  const getZygosityColor = (zygosity: string) => {
    if (zygosity === 'Homozygous ALT') return '#DC3545';
    if (zygosity === 'Heterozygous') return '#FFC107';
    return '#28A745';
  };

  const filterClinicalConditions = (conditions: string[]) => {
    const excludeKeywords = ['employment', 'finding', 'certificate', 'criminal', 'social', 'education'];
    return conditions.filter(c => !excludeKeywords.some(kw => c.toLowerCase().includes(kw)));
  };

  const groupVariantsByGene = (variants: PharmacoVariant[]) => {
    const groups: Record<string, PharmacoVariant[]> = {};
    const seen = new Set();
    variants.forEach(v => {
      const key = `${v.gene}-${v.variant_name}`;
      if (!seen.has(key)) {
        seen.add(key);
        if (!groups[v.gene]) groups[v.gene] = [];
        groups[v.gene].push(v);
      }
    });
    return groups;
  };

  return (
    <ScrollView style={styles.container}>
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
        {selectedPatient && (
          <View style={styles.patientDetails}>
            <Text style={styles.detailText}><Text style={styles.detailLabel}>Sample ID:</Text> {selectedPatient.SAMPLE_ID}</Text>
            <Text style={styles.detailText}><Text style={styles.detailLabel}>Ancestry:</Text> {selectedPatient.SUPERPOPULATION} ({selectedPatient.POPULATION})</Text>
          </View>
        )}
      </View>

      {selectedPatient && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="medkit" size={18} color="#DC3545" /> Reason for Admission
          </Text>
          {isLoadingProfile ? (
            <ActivityIndicator size="large" color="#29B5E8" style={{ padding: 20 }} />
          ) : (
            <View style={styles.diagnosisGrid}>
              {DIAGNOSES.map((d) => (
                <TouchableOpacity
                  key={d.label}
                  style={[styles.diagnosisCard, selectedDiagnosis?.label === d.label && styles.diagnosisCardActive]}
                  onPress={() => handleDiagnosisSelect(d)}
                >
                  <Ionicons
                    name={d.icon as any}
                    size={22}
                    color={selectedDiagnosis?.label === d.label ? '#fff' : '#29B5E8'}
                  />
                  <Text style={[styles.diagnosisLabel, selectedDiagnosis?.label === d.label && styles.diagnosisLabelActive]}>
                    {d.label}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          )}
        </View>
      )}

      {selectedDiagnosis && (isScanning || genomeScan) && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="flask" size={18} color="#6C5CE7" /> Pharmacogenomic Panel
          </Text>
          {isScanning ? (
            <View style={styles.scanningBox}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.scanningText}>Scanning genome for {selectedDiagnosis.label}-relevant variants...</Text>
              <Text style={styles.scanningSubtext}>Checking pharmacogenes across chromosomes</Text>
            </View>
          ) : genomeScan ? (
            <>
              <View style={styles.scanSummary}>
                <View style={styles.scanStat}>
                  <Text style={styles.scanStatValue}>{genomeScan.genes_scanned.length}</Text>
                  <Text style={styles.scanStatLabel}>Genes Scanned</Text>
                </View>
                <View style={styles.scanStat}>
                  <Text style={styles.scanStatValue}>{genomeScan.all_results.length}</Text>
                  <Text style={styles.scanStatLabel}>Positions Checked</Text>
                </View>
                <View style={styles.scanStat}>
                  <Text style={[styles.scanStatValue, { color: genomeScan.variants_of_interest.length > 0 ? '#DC3545' : '#28A745' }]}>
                    {genomeScan.variants_of_interest.length}
                  </Text>
                  <Text style={styles.scanStatLabel}>Variants Found</Text>
                </View>
              </View>

              <Text style={styles.genesLabel}>Genes: {genomeScan.genes_scanned.join(' · ')}</Text>

              {genomeScan.variants_of_interest.length > 0 ? (
                <>
                  <Text style={styles.subsectionTitle}>Variants of Interest</Text>
                  {Object.entries(groupVariantsByGene(genomeScan.variants_of_interest)).map(([gene, variants]) => (
                    <View key={gene} style={styles.geneGroup}>
                      <View style={styles.geneHeader}>
                        <Ionicons name="fitness" size={16} color="#6C5CE7" />
                        <Text style={styles.geneName}>{gene}</Text>
                      </View>
                      {variants.map((v, i) => (
                        <View key={i} style={styles.variantCard}>
                          <View style={styles.variantCardHeader}>
                            <Text style={styles.variantCardName}>{v.variant_name}</Text>
                            <View style={[styles.zygosityBadge, { backgroundColor: getZygosityColor(v.zygosity) + '20' }]}>
                              <Text style={[styles.zygosityText, { color: getZygosityColor(v.zygosity) }]}>{v.zygosity}</Text>
                            </View>
                          </View>
                          <Text style={styles.variantCardDetail}>
                            <Text style={styles.code}>{v.rs_id}</Text> | Genotype: <Text style={styles.code}>{v.allele1}/{v.allele2}</Text>
                          </Text>
                          <Text style={styles.variantCardMed}>Drug: {v.medication}</Text>
                          <Text style={styles.variantCardSig}>{v.clinical_significance}</Text>
                        </View>
                      ))}
                    </View>
                  ))}
                </>
              ) : (
                <View style={styles.noVariantsBox}>
                  <Ionicons name="checkmark-circle" size={24} color="#28A745" />
                  <Text style={styles.noVariantsText}>All scanned positions are wild-type for {selectedDiagnosis.label}-related pharmacogenes</Text>
                </View>
              )}

              <TouchableOpacity style={styles.expanderHeader} onPress={() => setShowAllResults(!showAllResults)}>
                <View style={styles.expanderLeft}>
                  <Ionicons name="list" size={16} color="#666" />
                  <Text style={styles.expanderTitle}>View All Scanned Positions ({genomeScan.all_results.length})</Text>
                </View>
                <Ionicons name={showAllResults ? 'chevron-up' : 'chevron-down'} size={20} color="#666" />
              </TouchableOpacity>
              {showAllResults && (
                <View style={styles.allResultsTable}>
                  {(() => {
                    const seen = new Set();
                    return genomeScan.all_results.filter(r => {
                      const key = `${r.gene}-${r.variant_name}`;
                      if (seen.has(key)) return false;
                      seen.add(key);
                      return true;
                    }).map((r, i) => (
                      <View key={i} style={[styles.allResultRow, r.is_variant && styles.allResultRowHighlight]}>
                        <View style={[styles.allResultDot, { backgroundColor: r.is_variant ? '#DC3545' : '#28A745' }]} />
                        <Text style={styles.allResultGene}>{r.gene}</Text>
                        <Text style={styles.allResultVariant}>{r.variant_name}</Text>
                        <Text style={styles.allResultZygosity}>{r.zygosity}</Text>
                      </View>
                    ));
                  })()}
                </View>
              )}
            </>
          ) : null}
        </View>
      )}

      {genomeScan && genomeScan.variants_of_interest.length > 0 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="analytics" size={18} color="#6C5CE7" /> Evo2 Functional Impact
          </Text>
          {!isLoadingEvo2 && Object.keys(evo2Results).length === 0 && !evo2Error && (
            <>
              <Text style={styles.evo2Description}>
                Score this patient's {genomeScan.variants_of_interest.length} variant(s) of interest using the Evo2 7B genomic foundation model.
              </Text>
              <TouchableOpacity style={styles.evo2Button} onPress={scoreWithEvo2}>
                <Ionicons name="flask" size={18} color="#fff" />
                <Text style={styles.evo2ButtonText}>Score Variants with Evo2</Text>
              </TouchableOpacity>
            </>
          )}
          {isLoadingEvo2 && (
            <View style={styles.scanningBox}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.scanningText}>Scoring variants with Evo2 genomic model...</Text>
            </View>
          )}
          {evo2Error && (
            <View style={styles.errorBox}>
              <Ionicons name="alert-circle" size={18} color="#DC3545" />
              <Text style={styles.errorText}>{evo2Error}</Text>
              <TouchableOpacity onPress={scoreWithEvo2} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}
          {Object.keys(evo2Results).length > 0 && (
            <>
              {Object.entries(evo2Results).map(([variant, result]) => (
                <View key={variant} style={[styles.evo2ResultCard, { borderLeftColor: getEvo2Color(result.delta_score) }]}>
                  <View style={styles.evo2ResultHeader}>
                    <View>
                      <Text style={styles.evo2VariantName}>{result.gene} {variant}</Text>
                    </View>
                    <View style={[styles.evo2Badge, { backgroundColor: getEvo2Color(result.delta_score) + '20' }]}>
                      <Text style={[styles.evo2BadgeText, { color: getEvo2Color(result.delta_score) }]}>{result.prediction}</Text>
                    </View>
                  </View>
                  <View style={styles.evo2ScoreRow}>
                    <View style={styles.evo2ScoreItem}>
                      <Text style={styles.evo2ScoreLabel}>Delta</Text>
                      <Text style={[styles.evo2ScoreValue, { color: getEvo2Color(result.delta_score) }]}>{result.delta_score.toFixed(4)}</Text>
                    </View>
                    <View style={styles.evo2ScoreItem}>
                      <Text style={styles.evo2ScoreLabel}>Ref</Text>
                      <Text style={styles.evo2ScoreValueMuted}>{result.ref_score.toFixed(4)}</Text>
                    </View>
                    <View style={styles.evo2ScoreItem}>
                      <Text style={styles.evo2ScoreLabel}>Alt</Text>
                      <Text style={styles.evo2ScoreValueMuted}>{result.alt_score.toFixed(4)}</Text>
                    </View>
                  </View>
                </View>
              ))}
              <TouchableOpacity style={styles.evo2Button} onPress={scoreWithEvo2}>
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.evo2ButtonText}>Re-score</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {selectedDiagnosis && clinicalProfile && (
        <View style={styles.section}>
          <TouchableOpacity style={styles.expanderHeader} onPress={() => setShowClinicalProfile(!showClinicalProfile)}>
            <View style={styles.expanderLeft}>
              <Ionicons name="medical" size={18} color="#00B894" />
              <Text style={styles.expanderTitle}>Patient Clinical Profile (EHR)</Text>
            </View>
            <Ionicons name={showClinicalProfile ? 'chevron-up' : 'chevron-down'} size={20} color="#666" />
          </TouchableOpacity>
          {showClinicalProfile && (
            <View style={styles.expanderContent}>
              <View style={styles.profileColumns}>
                <View style={styles.profileColumn}>
                  <Text style={styles.profileColumnTitle}>Conditions:</Text>
                  {filterClinicalConditions(clinicalProfile.conditions || [])
                    .slice(0, showAllConditions ? undefined : 8)
                    .map((c, i) => (<Text key={i} style={styles.profileItem}>• {c}</Text>))}
                  {filterClinicalConditions(clinicalProfile.conditions || []).length > 8 && (
                    <TouchableOpacity onPress={() => setShowAllConditions(!showAllConditions)}>
                      <Text style={styles.showMoreLink}>{showAllConditions ? 'Show less' : `Show all ${filterClinicalConditions(clinicalProfile.conditions || []).length}`}</Text>
                    </TouchableOpacity>
                  )}
                </View>
                <View style={styles.profileColumn}>
                  <Text style={styles.profileColumnTitle}>Current Medications:</Text>
                  {(clinicalProfile.medications || [])
                    .slice(0, showAllMedications ? undefined : 8)
                    .map((m, i) => (<Text key={i} style={styles.profileItem}>• {m}</Text>))}
                  {(clinicalProfile.medications || []).length > 8 && (
                    <TouchableOpacity onPress={() => setShowAllMedications(!showAllMedications)}>
                      <Text style={styles.showMoreLink}>{showAllMedications ? 'Show less' : `Show all ${(clinicalProfile.medications || []).length}`}</Text>
                    </TouchableOpacity>
                  )}
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {selectedDiagnosis && genomeScan && !isScanning && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="document-text" size={18} color="#29B5E8" /> Clinical Notes
          </Text>
          <TextInput
            style={styles.notesInput}
            multiline
            numberOfLines={4}
            placeholder="Describe the clinical scenario..."
            placeholderTextColor="#999"
            value={clinicalNotes}
            onChangeText={setClinicalNotes}
          />
          <TouchableOpacity
            style={[styles.analyzeButton, !clinicalNotes && styles.analyzeButtonDisabled]}
            onPress={handleAnalyze}
            disabled={!clinicalNotes || isAnalyzing}
          >
            {isAnalyzing ? (
              <ActivityIndicator size="small" color="#fff" />
            ) : (
              <>
                <Ionicons name="sparkles" size={20} color="#fff" />
                <Text style={styles.analyzeButtonText}>Analyze with Research Agent</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {recommendation && (() => {
        const stdMatch = recommendation.match(/---STANDARD_CARE---(.*?)---PRECISION_MEDICINE---/s);
        const precMatch = recommendation.match(/---PRECISION_MEDICINE---(.*)/s);
        const hasScenarios = stdMatch && precMatch;
        const standardCare = stdMatch?.[1]?.trim() || '';
        const precisionMedicine = precMatch?.[1]?.trim() || '';
        const genesWithVariants = genomeScan?.variants_of_interest.map(v => v.gene).filter((g, i, a) => a.indexOf(g) === i) || [];
        return (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>
              <Ionicons name="bulb" size={18} color="#29B5E8" /> Clinical Decision Support
            </Text>
            {hasScenarios ? (
              <>
                <View style={styles.scenarioCard}>
                  <View style={styles.scenarioCardHeader}>
                    <Ionicons name="medical" size={18} color="#6c757d" />
                    <Text style={styles.scenarioCardTitle}>Standard of Care</Text>
                  </View>
                  <Text style={styles.scenarioCardSubtitle}>Without pharmacogenomic data</Text>
                  <View style={styles.scenarioCardBody}>
                    <Text style={styles.scenarioCardContent}>{standardCare}</Text>
                  </View>
                </View>
                <View style={styles.scenarioArrow}>
                  <Ionicons name="arrow-down" size={24} color="#6C5CE7" />
                  <Text style={styles.scenarioArrowText}>Precision Medicine Upgrade</Text>
                  <Ionicons name="arrow-down" size={24} color="#6C5CE7" />
                </View>
                <View style={[styles.scenarioCard, styles.scenarioCardPrecision]}>
                  <View style={styles.scenarioCardHeader}>
                    <Ionicons name="sparkles" size={18} color="#6C5CE7" />
                    <Text style={[styles.scenarioCardTitle, { color: '#6C5CE7' }]}>Precision Medicine Recommendation</Text>
                  </View>
                  <Text style={[styles.scenarioCardSubtitle, { color: '#6C5CE7' }]}>
                    With {genesWithVariants.join(', ')} genotype data{Object.keys(evo2Results).length > 0 ? ' + Evo2 functional impact' : ''}
                  </Text>
                  <View style={[styles.scenarioCardBody, { backgroundColor: '#f3f0ff' }]}>
                    <Text style={styles.scenarioCardContent}>{precisionMedicine}</Text>
                  </View>
                </View>
              </>
            ) : (
              <View style={styles.recommendationCard}>
                <Text style={styles.recommendationContent}>{recommendation}</Text>
              </View>
            )}
          </View>
        );
      })()}

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
  patientDetails: { marginTop: 12, padding: 12, backgroundColor: '#f0f9ff', borderRadius: 8 },
  detailText: { fontSize: 14, color: '#333', marginBottom: 4 },
  detailLabel: { fontWeight: '600' },
  noData: { fontSize: 14, color: '#999', fontStyle: 'italic', textAlign: 'center', padding: 20 },
  diagnosisGrid: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'space-between' },
  diagnosisCard: { width: '48%', padding: 14, borderRadius: 10, borderWidth: 1.5, borderColor: '#e0e0e0', backgroundColor: '#fafafa', marginBottom: 10, alignItems: 'center' },
  diagnosisCardActive: { backgroundColor: '#29B5E8', borderColor: '#29B5E8' },
  diagnosisLabel: { fontSize: 13, fontWeight: '600', color: '#333', marginTop: 6, textAlign: 'center' },
  diagnosisLabelActive: { color: '#fff' },
  scanningBox: { alignItems: 'center', padding: 24 },
  scanningText: { marginTop: 12, fontSize: 14, color: '#6C5CE7', fontWeight: '500' },
  scanningSubtext: { marginTop: 4, fontSize: 12, color: '#999' },
  scanSummary: { flexDirection: 'row', justifyContent: 'space-around', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#eee', marginBottom: 12 },
  scanStat: { alignItems: 'center' },
  scanStatValue: { fontSize: 24, fontWeight: '700', color: '#6C5CE7' },
  scanStatLabel: { fontSize: 11, color: '#999', marginTop: 2 },
  genesLabel: { fontSize: 12, color: '#888', textAlign: 'center', marginBottom: 12, fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace' },
  subsectionTitle: { fontSize: 14, fontWeight: '700', color: '#DC3545', marginBottom: 8, marginTop: 4 },
  geneGroup: { marginBottom: 12 },
  geneHeader: { flexDirection: 'row', alignItems: 'center', marginBottom: 6 },
  geneName: { fontSize: 15, fontWeight: '700', color: '#6C5CE7', marginLeft: 6 },
  variantCard: { backgroundColor: '#f8f5ff', borderRadius: 8, padding: 12, marginBottom: 8, borderLeftWidth: 3, borderLeftColor: '#6C5CE7' },
  variantCardHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 6 },
  variantCardName: { fontSize: 14, fontWeight: '600', color: '#333' },
  zygosityBadge: { paddingHorizontal: 8, paddingVertical: 2, borderRadius: 10 },
  zygosityText: { fontSize: 11, fontWeight: '600' },
  variantCardDetail: { fontSize: 12, color: '#666', marginBottom: 4 },
  variantCardMed: { fontSize: 12, color: '#29B5E8', fontWeight: '500', marginBottom: 2 },
  variantCardSig: { fontSize: 12, color: '#555', fontStyle: 'italic' },
  code: { fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace', backgroundColor: '#f0f0f0', paddingHorizontal: 3 },
  noVariantsBox: { flexDirection: 'row', alignItems: 'center', padding: 16, backgroundColor: '#f0fff4', borderRadius: 8 },
  noVariantsText: { flex: 1, marginLeft: 10, fontSize: 13, color: '#28A745' },
  expanderHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 4, marginTop: 8, borderTopWidth: 1, borderTopColor: '#eee' },
  expanderLeft: { flexDirection: 'row', alignItems: 'center' },
  expanderTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginLeft: 8 },
  expanderContent: { paddingVertical: 12, paddingHorizontal: 4 },
  allResultsTable: { paddingVertical: 8 },
  allResultRow: { flexDirection: 'row', alignItems: 'center', paddingVertical: 6, paddingHorizontal: 4, borderBottomWidth: 1, borderBottomColor: '#f5f5f5' },
  allResultRowHighlight: { backgroundColor: '#fff5f5' },
  allResultDot: { width: 8, height: 8, borderRadius: 4, marginRight: 8 },
  allResultGene: { fontSize: 12, fontWeight: '600', color: '#333', width: 80 },
  allResultVariant: { fontSize: 12, color: '#666', flex: 1 },
  allResultZygosity: { fontSize: 11, color: '#888', width: 100, textAlign: 'right' },
  evo2Description: { fontSize: 13, color: '#666', lineHeight: 19, marginBottom: 12 },
  evo2Button: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#6C5CE7', padding: 12, borderRadius: 8, marginTop: 8 },
  evo2ButtonText: { color: '#fff', fontSize: 14, fontWeight: '600', marginLeft: 8 },
  evo2ResultCard: { padding: 14, backgroundColor: '#fafafa', borderRadius: 8, borderLeftWidth: 4, marginBottom: 10 },
  evo2ResultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  evo2VariantName: { fontSize: 14, fontWeight: '700', color: '#333' },
  evo2Badge: { paddingHorizontal: 10, paddingVertical: 3, borderRadius: 12 },
  evo2BadgeText: { fontSize: 12, fontWeight: '600' },
  evo2ScoreRow: { flexDirection: 'row', justifyContent: 'space-between' },
  evo2ScoreItem: { alignItems: 'center', flex: 1 },
  evo2ScoreLabel: { fontSize: 11, color: '#999', marginBottom: 2 },
  evo2ScoreValue: { fontSize: 16, fontWeight: '700' },
  evo2ScoreValueMuted: { fontSize: 14, fontWeight: '500', color: '#666' },
  errorBox: { flexDirection: 'row', alignItems: 'center', backgroundColor: '#fde8e8', padding: 12, borderRadius: 8, flexWrap: 'wrap' },
  errorText: { flex: 1, marginLeft: 8, fontSize: 13, color: '#DC3545' },
  retryButton: { paddingHorizontal: 12, paddingVertical: 4, borderRadius: 4, backgroundColor: '#DC3545', marginLeft: 8 },
  retryText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  profileColumns: { flexDirection: 'row', justifyContent: 'space-between' },
  profileColumn: { flex: 1, paddingRight: 8 },
  profileColumnTitle: { fontSize: 14, fontWeight: '600', color: '#333', marginBottom: 8 },
  profileItem: { fontSize: 13, color: '#555', marginBottom: 4, lineHeight: 18 },
  showMoreLink: { fontSize: 13, color: '#29B5E8', fontWeight: '600', marginTop: 8, paddingVertical: 4 },
  notesInput: { borderWidth: 1, borderColor: '#ddd', borderRadius: 8, padding: 12, fontSize: 14, color: '#333', backgroundColor: '#fafafa', minHeight: 100, textAlignVertical: 'top' },
  analyzeButton: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', backgroundColor: '#29B5E8', padding: 14, borderRadius: 8, marginTop: 12 },
  analyzeButtonDisabled: { backgroundColor: '#ccc' },
  analyzeButtonText: { color: '#fff', fontSize: 16, fontWeight: '600', marginLeft: 8 },
  recommendationCard: { padding: 16, backgroundColor: '#f8f9fa', borderRadius: 8 },
  recommendationContent: { fontSize: 14, color: '#333', lineHeight: 22 },
  scenarioCard: { borderRadius: 10, borderWidth: 1, borderColor: '#dee2e6', backgroundColor: '#fff', marginBottom: 8, overflow: 'hidden' },
  scenarioCardPrecision: { borderColor: '#6C5CE7', borderWidth: 2 },
  scenarioCardHeader: { flexDirection: 'row', alignItems: 'center', paddingHorizontal: 14, paddingTop: 14, paddingBottom: 4 },
  scenarioCardTitle: { fontSize: 15, fontWeight: '700', color: '#495057', marginLeft: 8 },
  scenarioCardSubtitle: { fontSize: 12, color: '#868e96', paddingHorizontal: 14, marginBottom: 10 },
  scenarioCardBody: { backgroundColor: '#f8f9fa', padding: 14 },
  scenarioCardContent: { fontSize: 14, color: '#333', lineHeight: 22 },
  scenarioArrow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', paddingVertical: 8 },
  scenarioArrowText: { fontSize: 12, fontWeight: '700', color: '#6C5CE7', marginHorizontal: 8, textTransform: 'uppercase', letterSpacing: 1 },
});
