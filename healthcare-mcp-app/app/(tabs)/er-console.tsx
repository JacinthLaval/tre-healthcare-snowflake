import React, { useState, useEffect, useCallback } from 'react';
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
}

interface CYP2C19Variant {
  variant: string;
  rs_id: string;
  allele1: string;
  allele2: string;
  status: string;
}

interface CYP2C19Profile {
  phenotype: string;
  recommendation: string;
  variants: CYP2C19Variant[];
}

interface Evo2VariantResult {
  position: number;
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
  cyp2c19: CYP2C19Profile;
}

const CYP2C19_REFERENCE_SEQ = 'ATGGATCCTTTATATTTTGTTATTTTCTAGAAAGCTTTAAAATAATAACATAAAGGCTTCCCGTATAAAGCCAATATATAATCAGTTTCAATCCTTTGATGATAATTATTATTATAATAACTCATGACCTCTGTGTCTTTTCCATCTCTAAATAAACTAAATGCGATGGAGCAG';

const CYP2C19_VARIANT_POSITIONS: Record<string, { position: number; ref: string; alt: string }> = {
  'CYP2C19*2': { position: 90, ref: 'G', alt: 'A' },
  'CYP2C19*3': { position: 75, ref: 'G', alt: 'A' },
  'CYP2C19*17': { position: 30, ref: 'C', alt: 'T' },
};

const SCENARIOS = [
  { label: 'Stroke - antiplatelet', notes: 'Patient had ischemic stroke, now stable. Need antiplatelet therapy for secondary prevention. Considering clopidogrel vs alternatives.' },
  { label: 'ACS/Stent - DAPT', notes: 'Patient with acute coronary syndrome, underwent PCI with drug-eluting stent. Need dual antiplatelet therapy (DAPT).' },
  { label: 'Atrial Fib', notes: 'Patient with atrial fibrillation, CHA2DS2-VASc score indicates anticoagulation needed.' },
  { label: 'Chronic pain', notes: 'Patient with chronic pain requiring opioid therapy. Need to assess CYP2D6 status.' },
];

export default function ERConsoleScreen() {
  const [patients, setPatients] = useState<Patient[]>([]);
  const [selectedPatient, setSelectedPatient] = useState<Patient | null>(null);
  const [clinicalProfile, setClinicalProfile] = useState<ClinicalProfile | null>(null);
  const [clinicalNotes, setClinicalNotes] = useState('');
  const [recommendation, setRecommendation] = useState('');
  const [isLoadingPatients, setIsLoadingPatients] = useState(true);
  const [isLoadingProfile, setIsLoadingProfile] = useState(false);
  const [isAnalyzing, setIsAnalyzing] = useState(false);
  const [showPatientPicker, setShowPatientPicker] = useState(false);
  const [showDnaDetails, setShowDnaDetails] = useState(false);
  const [showClinicalProfile, setShowClinicalProfile] = useState(false);
  const [evo2Results, setEvo2Results] = useState<Record<string, Evo2VariantResult>>({});
  const [isLoadingEvo2, setIsLoadingEvo2] = useState(false);
  const [evo2Error, setEvo2Error] = useState<string | null>(null);
  const [showEvo2Details, setShowEvo2Details] = useState(false);
  const [showAllConditions, setShowAllConditions] = useState(false);
  const [showAllMedications, setShowAllMedications] = useState(false);

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
        SELECT SAMPLE_ID, PATIENT_NAME, SUPERPOPULATION, POPULATION
        FROM HEALTHCARE_DATABASE.DEFAULT_SCHEMA.PATIENT_GENOME_MAPPING
        ORDER BY PATIENT_NAME
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

      const data = await client.executeSQL(`
        CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.GET_PATIENT_CLINICAL_PROFILE('${sampleId}')
      `);
      
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

  const handlePatientSelect = (patient: Patient) => {
    setSelectedPatient(patient);
    setShowPatientPicker(false);
    setRecommendation('');
    setEvo2Results({});
    setEvo2Error(null);
    setShowAllConditions(false);
    setShowAllMedications(false);
    loadClinicalProfile(patient.SAMPLE_ID);
  };

  const scoreWithEvo2 = async () => {
    if (!clinicalProfile?.cyp2c19?.variants) return;
    setIsLoadingEvo2(true);
    setEvo2Error(null);
    setEvo2Results({});
    setShowEvo2Details(true);

    try {
      const client = getMCPClient();
      if (!client) throw new Error('Not connected to Snowflake');

      const healthData = await client.executeSQL(
        `SELECT HEALTHCARE_DATABASE.DEFAULT_SCHEMA.EVO2_HEALTH() AS result`
      );
      const healthResult = healthData?.[0]?.RESULT || healthData?.[0]?.result;
      const health = typeof healthResult === 'string' ? JSON.parse(healthResult) : healthResult;
      if (!health?.model_loaded) throw new Error('Evo2 model still loading - please try again in a few minutes');

      const results: Record<string, Evo2VariantResult> = {};
      const variantsToScore = clinicalProfile.cyp2c19.variants.filter(
        v => v.status !== 'Homozygous REF' && CYP2C19_VARIANT_POSITIONS[v.variant]
      );

      if (variantsToScore.length === 0) {
        setEvo2Error('No non-reference CYP2C19 variants detected to score');
        setIsLoadingEvo2(false);
        return;
      }

      for (const v of variantsToScore) {
        const variantInfo = CYP2C19_VARIANT_POSITIONS[v.variant];
        if (!variantInfo) continue;

        const altSeq =
          CYP2C19_REFERENCE_SEQ.substring(0, variantInfo.position) +
          variantInfo.alt +
          CYP2C19_REFERENCE_SEQ.substring(variantInfo.position + 1);

        const scoreData = await client.executeSQL(
          `SELECT HEALTHCARE_DATABASE.DEFAULT_SCHEMA.EVO2_VARIANT_SCORE('${CYP2C19_REFERENCE_SEQ}', '${altSeq}', ${variantInfo.position}) AS result`,
          120
        );
        const scoreResult = scoreData?.[0]?.RESULT || scoreData?.[0]?.result;
        if (scoreResult) {
          results[v.variant] = typeof scoreResult === 'string' ? JSON.parse(scoreResult) : scoreResult;
        }
      }

      setEvo2Results(results);
    } catch (error) {
      setEvo2Error(error instanceof Error ? error.message : 'Failed to connect to Evo2 service');
    } finally {
      setIsLoadingEvo2(false);
    }
  };

  const handleAnalyze = async () => {
    if (!selectedPatient || !clinicalProfile || !clinicalNotes) return;

    setIsAnalyzing(true);
    setRecommendation('');

    try {
      const client = getMCPClient();
      if (!client) return;

      const cyp2c19 = clinicalProfile.cyp2c19;
      const conditions = filterClinicalConditions(clinicalProfile.conditions || []);
      const medications = clinicalProfile.medications || [];
      
      let evo2Info = '';
      if (Object.keys(evo2Results).length > 0) {
        evo2Info = '\nEVO2 GENOMIC MODEL FUNCTIONAL IMPACT SCORES:';
        Object.entries(evo2Results).forEach(([variant, result]) => {
          evo2Info += `\n- ${variant}: delta_score=${result.delta_score.toFixed(4)}, prediction=${result.prediction}, ref_score=${result.ref_score.toFixed(4)}, alt_score=${result.alt_score.toFixed(4)}`;
        });
        evo2Info += '\n(Evo2 is a 7B-parameter genomic foundation model. Negative delta = more disruptive. < -0.5 = Likely pathogenic, -0.5 to -0.1 = Possibly damaging, -0.1 to 0.1 = Benign/Neutral, > 0.1 = Possibly beneficial)';
      }

      let cyp2c19Info = `CYP2C19 GENOTYPE RESULTS:
- Phenotype: ${cyp2c19.phenotype}
- Clinical Recommendation: ${cyp2c19.recommendation}`;
      
      if (cyp2c19.variants && cyp2c19.variants.length > 0) {
        cyp2c19Info += '\n- Variants detected:';
        cyp2c19.variants.forEach((v: CYP2C19Variant) => {
          cyp2c19Info += `\n  - ${v.variant} (${v.rs_id}): ${v.allele1}/${v.allele2} - ${v.status}`;
        });
      }

      const hasEvo2 = Object.keys(evo2Results).length > 0;

      const query = `You are a clinical pharmacogenomics advisor with access to PubMed and ClinicalTrials.gov.

PATIENT INFORMATION:
- Name: ${selectedPatient.PATIENT_NAME}
- Sample ID: ${selectedPatient.SAMPLE_ID}
- Ancestry: ${selectedPatient.SUPERPOPULATION} (${selectedPatient.POPULATION})

PATIENT'S GENOMIC DATA:
${cyp2c19Info}
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
Provide the recommendation a clinician would make using ONLY the clinical notes, conditions, and medications above — WITHOUT any knowledge of the patient's CYP2C19 genotype, variant data, or Evo2 scores. This represents conventional standard of care. Include:
- Likely drug choice and dosing based on guidelines
- Standard monitoring plan
- Potential risks the clinician would NOT be aware of without genomic data
- Relevant clinical trial options based on condition alone

---PRECISION_MEDICINE---
Now provide the IMPROVED recommendation incorporating ALL available genomic data: CYP2C19 ${cyp2c19.phenotype} status, variant details${hasEvo2 ? ', and Evo2 functional impact scores (AI-predicted DNA-level disruption)' : ''}. Include:
- How genomic data changes the drug/dose selection
- Specific risks identified by genotype that standard care would miss
${hasEvo2 ? '- Evo2 functional impact interpretation and how it strengthens the recommendation\n' : ''}- Evidence-based alternative therapies supported by pharmacogenomic data
- Genotype-matched clinical trials from ClinicalTrials.gov
- PubMed evidence supporting the precision approach
- Concrete actionable guidance
- Key references

Search ClinicalTrials.gov and PubMed to support both scenarios with real evidence.`;

      const escapedQuery = query.replace(/'/g, "''");
      const data = await client.executeSQL(`
        CALL HEALTHCARE_DATABASE.DEFAULT_SCHEMA.CALL_NEO_RESEARCH_AGENT('${escapedQuery}')
      `, 120);

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

  const getPhenotypeColor = (phenotype: string) => {
    if (phenotype.includes('Poor') || phenotype.includes('Intermediate')) return '#DC3545';
    if (phenotype.includes('Rapid') || phenotype.includes('Ultrarapid')) return '#FFC107';
    return '#28A745';
  };

  const getPhenotypeIcon = (phenotype: string) => {
    if (phenotype.includes('Poor') || phenotype.includes('Intermediate')) return 'warning';
    return 'checkmark-circle';
  };

  const filterClinicalConditions = (conditions: string[]) => {
    const excludeKeywords = ['employment', 'finding', 'certificate', 'criminal', 'social', 'education'];
    return conditions.filter(c => !excludeKeywords.some(kw => c.toLowerCase().includes(kw)));
  };

  return (
    <ScrollView style={styles.container}>
      {/* Patient Selector */}
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
              <Ionicons name="chevron-down" size={20} color="#666" />
            </>
          )}
        </TouchableOpacity>

        {showPatientPicker && (
          <View style={styles.patientList}>
            {patients.slice(0, 20).map((patient) => (
              <TouchableOpacity
                key={patient.SAMPLE_ID}
                style={styles.patientItem}
                onPress={() => handlePatientSelect(patient)}
              >
                <Text style={styles.patientName}>{patient.PATIENT_NAME}</Text>
                <Text style={styles.patientInfo}>{patient.SUPERPOPULATION}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}

        {selectedPatient && (
          <View style={styles.patientDetails}>
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Sample ID:</Text> {selectedPatient.SAMPLE_ID}
            </Text>
            <Text style={styles.detailText}>
              <Text style={styles.detailLabel}>Ancestry:</Text> {selectedPatient.SUPERPOPULATION} ({selectedPatient.POPULATION})
            </Text>
          </View>
        )}
      </View>

      {/* CYP2C19 Profile */}
      {selectedPatient && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="flask" size={18} color="#29B5E8" /> CYP2C19 Profile
          </Text>
          
          {isLoadingProfile ? (
            <ActivityIndicator size="large" color="#29B5E8" style={styles.loader} />
          ) : clinicalProfile?.cyp2c19 ? (
            <>
              <View style={[
                styles.phenotypeCard,
                { borderLeftColor: getPhenotypeColor(clinicalProfile.cyp2c19.phenotype) }
              ]}>
                <View style={styles.phenotypeHeader}>
                  <Ionicons
                    name={getPhenotypeIcon(clinicalProfile.cyp2c19.phenotype) as any}
                    size={24}
                    color={getPhenotypeColor(clinicalProfile.cyp2c19.phenotype)}
                  />
                  <Text style={[
                    styles.phenotypeText,
                    { color: getPhenotypeColor(clinicalProfile.cyp2c19.phenotype) }
                  ]}>
                    {clinicalProfile.cyp2c19.phenotype}
                  </Text>
                </View>
                <Text style={styles.recommendationText}>
                  {clinicalProfile.cyp2c19.recommendation}
                </Text>
              </View>

              {/* DNA View - Expandable */}
              <TouchableOpacity
                style={styles.expanderHeader}
                onPress={() => setShowDnaDetails(!showDnaDetails)}
              >
                <View style={styles.expanderLeft}>
                  <Ionicons name="fitness" size={18} color="#6C5CE7" />
                  <Text style={styles.expanderTitle}>View CYP2C19 Variant Details</Text>
                </View>
                <Ionicons
                  name={showDnaDetails ? 'chevron-up' : 'chevron-down'}
                  size={20}
                  color="#666"
                />
              </TouchableOpacity>

              {showDnaDetails && (
                <View style={styles.expanderContent}>
                  {clinicalProfile.cyp2c19.variants?.length > 0 ? (
                    clinicalProfile.cyp2c19.variants.map((v, i) => (
                      <View key={i} style={styles.variantDetailRow}>
                        <View style={styles.variantIndicator}>
                          <View style={[
                            styles.variantDot,
                            { backgroundColor: v.status !== 'Homozygous REF' ? '#DC3545' : '#28A745' }
                          ]} />
                        </View>
                        <View style={styles.variantInfo}>
                          <Text style={styles.variantDetailName}>{v.variant} ({v.rs_id})</Text>
                          <Text style={styles.variantDetailGenotype}>
                            Genotype: <Text style={styles.code}>{v.allele1}/{v.allele2}</Text> | Status: {v.status}
                          </Text>
                        </View>
                      </View>
                    ))
                  ) : (
                    <Text style={styles.noVariants}>
                      No CYP2C19 variants detected in this patient's genome data (wild-type assumed)
                    </Text>
                  )}
                </View>
              )}
            </>
          ) : (
            <Text style={styles.noData}>No CYP2C19 data available</Text>
          )}
        </View>
      )}

      {/* Evo2 Functional Impact */}
      {selectedPatient && clinicalProfile?.cyp2c19 && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="analytics" size={18} color="#6C5CE7" /> Evo2 Functional Impact
          </Text>

          {!isLoadingEvo2 && Object.keys(evo2Results).length === 0 && !evo2Error && (
            <>
              <Text style={styles.evo2Description}>
                Score this patient's CYP2C19 variants using the Evo2 7B genomic foundation model to predict functional impact at the DNA sequence level.
              </Text>
              <TouchableOpacity
                style={styles.evo2Button}
                onPress={scoreWithEvo2}
              >
                <Ionicons name="flask" size={18} color="#fff" />
                <Text style={styles.evo2ButtonText}>Score Variants with Evo2</Text>
              </TouchableOpacity>
            </>
          )}

          {isLoadingEvo2 && (
            <View style={styles.evo2Loading}>
              <ActivityIndicator size="large" color="#6C5CE7" />
              <Text style={styles.evo2LoadingText}>Scoring variants with Evo2 genomic model...</Text>
            </View>
          )}

          {evo2Error && (
            <View style={styles.evo2ErrorBox}>
              <Ionicons name="alert-circle" size={18} color="#DC3545" />
              <Text style={styles.evo2ErrorText}>{evo2Error}</Text>
              <TouchableOpacity onPress={scoreWithEvo2} style={styles.retryButton}>
                <Text style={styles.retryText}>Retry</Text>
              </TouchableOpacity>
            </View>
          )}

          {Object.keys(evo2Results).length > 0 && (
            <>
              {Object.entries(evo2Results).map(([variant, result]) => (
                <View key={variant} style={[
                  styles.evo2ResultCard,
                  { borderLeftColor: getEvo2Color(result.delta_score) }
                ]}>
                  <View style={styles.evo2ResultHeader}>
                    <Text style={styles.evo2VariantName}>{variant}</Text>
                    <View style={[
                      styles.evo2Badge,
                      { backgroundColor: getEvo2Color(result.delta_score) + '20' }
                    ]}>
                      <Text style={[
                        styles.evo2BadgeText,
                        { color: getEvo2Color(result.delta_score) }
                      ]}>{result.prediction}</Text>
                    </View>
                  </View>
                  <View style={styles.evo2ScoreRow}>
                    <View style={styles.evo2ScoreItem}>
                      <Text style={styles.evo2ScoreLabel}>Delta Score</Text>
                      <Text style={[
                        styles.evo2ScoreValue,
                        { color: getEvo2Color(result.delta_score) }
                      ]}>{result.delta_score.toFixed(4)}</Text>
                    </View>
                    <View style={styles.evo2ScoreItem}>
                      <Text style={styles.evo2ScoreLabel}>Ref Score</Text>
                      <Text style={styles.evo2ScoreValueMuted}>{result.ref_score.toFixed(4)}</Text>
                    </View>
                    <View style={styles.evo2ScoreItem}>
                      <Text style={styles.evo2ScoreLabel}>Alt Score</Text>
                      <Text style={styles.evo2ScoreValueMuted}>{result.alt_score.toFixed(4)}</Text>
                    </View>
                  </View>
                  <Text style={styles.evo2MutationDetail}>
                    Position {result.position}: {result.ref_base} → {result.alt_base}
                  </Text>
                </View>
              ))}

              <TouchableOpacity
                style={styles.evo2Button}
                onPress={scoreWithEvo2}
              >
                <Ionicons name="refresh" size={16} color="#fff" />
                <Text style={styles.evo2ButtonText}>Re-score</Text>
              </TouchableOpacity>
            </>
          )}
        </View>
      )}

      {/* Patient Clinical Profile - Expandable */}
      {selectedPatient && clinicalProfile && (
        <View style={styles.section}>
          <TouchableOpacity
            style={styles.expanderHeader}
            onPress={() => setShowClinicalProfile(!showClinicalProfile)}
          >
            <View style={styles.expanderLeft}>
              <Ionicons name="medical" size={18} color="#00B894" />
              <Text style={styles.expanderTitle}>Patient Clinical Profile (EHR)</Text>
            </View>
            <Ionicons
              name={showClinicalProfile ? 'chevron-up' : 'chevron-down'}
              size={20}
              color="#666"
            />
          </TouchableOpacity>

          {showClinicalProfile && (
            <View style={styles.expanderContent}>
              <View style={styles.profileColumns}>
                {/* Conditions */}
                <View style={styles.profileColumn}>
                  <Text style={styles.profileColumnTitle}>Conditions:</Text>
                  {filterClinicalConditions(clinicalProfile.conditions || [])
                    .slice(0, showAllConditions ? undefined : 8)
                    .map((c, i) => (
                      <Text key={i} style={styles.profileItem}>• {c}</Text>
                    ))}
                  {filterClinicalConditions(clinicalProfile.conditions || []).length > 8 && (
                    <TouchableOpacity onPress={() => setShowAllConditions(!showAllConditions)}>
                      <Text style={styles.showMoreLink}>
                        {showAllConditions
                          ? 'Show less'
                          : `Show all ${filterClinicalConditions(clinicalProfile.conditions || []).length} conditions`}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {(!clinicalProfile.conditions || clinicalProfile.conditions.length === 0) && (
                    <Text style={styles.noItems}>No conditions on record</Text>
                  )}
                </View>

                {/* Medications */}
                <View style={styles.profileColumn}>
                  <Text style={styles.profileColumnTitle}>Current Medications:</Text>
                  {(clinicalProfile.medications || [])
                    .slice(0, showAllMedications ? undefined : 8)
                    .map((m, i) => (
                      <Text key={i} style={styles.profileItem}>• {m}</Text>
                    ))}
                  {(clinicalProfile.medications || []).length > 8 && (
                    <TouchableOpacity onPress={() => setShowAllMedications(!showAllMedications)}>
                      <Text style={styles.showMoreLink}>
                        {showAllMedications
                          ? 'Show less'
                          : `Show all ${(clinicalProfile.medications || []).length} medications`}
                      </Text>
                    </TouchableOpacity>
                  )}
                  {(!clinicalProfile.medications || clinicalProfile.medications.length === 0) && (
                    <Text style={styles.noItems}>No medications on record</Text>
                  )}
                </View>
              </View>
            </View>
          )}
        </View>
      )}

      {/* Clinical Notes */}
      {selectedPatient && clinicalProfile && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="document-text" size={18} color="#29B5E8" /> Clinical Notes
          </Text>

          <View style={styles.scenarioContainer}>
            {SCENARIOS.map((scenario, i) => (
              <TouchableOpacity
                key={i}
                style={[
                  styles.scenarioChip,
                  clinicalNotes === scenario.notes && styles.scenarioChipActive
                ]}
                onPress={() => setClinicalNotes(scenario.notes)}
              >
                <Text style={[
                  styles.scenarioText,
                  clinicalNotes === scenario.notes && styles.scenarioTextActive
                ]}>
                  {scenario.label}
                </Text>
              </TouchableOpacity>
            ))}
          </View>

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

      {/* Recommendation */}
      {recommendation && (() => {
        const stdMatch = recommendation.match(/---STANDARD_CARE---(.*?)---PRECISION_MEDICINE---/s);
        const precMatch = recommendation.match(/---PRECISION_MEDICINE---(.*)/s);
        const hasScenarios = stdMatch && precMatch;
        const standardCare = stdMatch?.[1]?.trim() || '';
        const precisionMedicine = precMatch?.[1]?.trim() || '';

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
                  <Text style={styles.scenarioCardSubtitle}>Without genetic variant / Evo2 data</Text>
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
                  <Text style={[styles.scenarioCardSubtitle, { color: '#6C5CE7' }]}>With CYP2C19 genotype + Evo2 functional impact</Text>
                  {clinicalProfile?.cyp2c19?.phenotype?.includes('Poor') || 
                   clinicalProfile?.cyp2c19?.phenotype?.includes('Intermediate') ? (
                    <View style={[styles.alertBox, { marginHorizontal: 14, marginBottom: 0 }]}>
                      <Ionicons name="warning" size={20} color="#DC3545" />
                      <Text style={styles.alertText}>
                        ACTION REQUIRED - CYP2C19 {clinicalProfile.cyp2c19.phenotype}: 
                        Consider alternative to clopidogrel (prasugrel or ticagrelor)
                      </Text>
                    </View>
                  ) : null}
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

      <View style={styles.bottomPadding} />
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  section: {
    backgroundColor: '#fff',
    margin: 12,
    padding: 16,
    borderRadius: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 12,
  },
  patientSelector: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fafafa',
  },
  patientSelectorText: {
    fontSize: 15,
    color: '#333',
  },
  patientList: {
    marginTop: 8,
    maxHeight: 250,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    backgroundColor: '#fff',
  },
  patientItem: {
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  patientName: {
    fontSize: 15,
    fontWeight: '500',
    color: '#333',
  },
  patientInfo: {
    fontSize: 13,
    color: '#666',
    marginTop: 2,
  },
  patientDetails: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
  },
  detailText: {
    fontSize: 14,
    color: '#333',
    marginBottom: 4,
  },
  detailLabel: {
    fontWeight: '600',
  },
  loader: {
    padding: 20,
  },
  phenotypeCard: {
    padding: 16,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderLeftWidth: 4,
  },
  phenotypeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 8,
  },
  phenotypeText: {
    fontSize: 18,
    fontWeight: '700',
    marginLeft: 8,
  },
  recommendationText: {
    fontSize: 14,
    color: '#555',
    lineHeight: 20,
  },
  variantsContainer: {
    marginTop: 12,
    padding: 12,
    backgroundColor: '#f5f5f5',
    borderRadius: 8,
  },
  variantsTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  variantRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 6,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  variantName: {
    fontSize: 13,
    fontWeight: '500',
    color: '#333',
    flex: 1,
  },
  variantGenotype: {
    fontSize: 13,
    color: '#666',
    flex: 1,
    textAlign: 'center',
  },
  variantStatus: {
    fontSize: 12,
    color: '#28A745',
    flex: 1,
    textAlign: 'right',
  },
  variantStatusAlt: {
    color: '#DC3545',
  },
  noData: {
    fontSize: 14,
    color: '#999',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 20,
  },
  scenarioContainer: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    marginBottom: 12,
  },
  scenarioChip: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 16,
    backgroundColor: '#f0f0f0',
    marginRight: 8,
    marginBottom: 8,
  },
  scenarioChipActive: {
    backgroundColor: '#29B5E8',
  },
  scenarioText: {
    fontSize: 13,
    color: '#666',
  },
  scenarioTextActive: {
    color: '#fff',
  },
  notesInput: {
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    padding: 12,
    fontSize: 14,
    color: '#333',
    backgroundColor: '#fafafa',
    minHeight: 100,
    textAlignVertical: 'top',
  },
  analyzeButton: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#29B5E8',
    padding: 14,
    borderRadius: 8,
    marginTop: 12,
  },
  analyzeButtonDisabled: {
    backgroundColor: '#ccc',
  },
  analyzeButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
    marginLeft: 8,
  },
  alertBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fde8e8',
    padding: 12,
    borderRadius: 8,
    marginBottom: 12,
  },
  alertText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 14,
    color: '#DC3545',
    fontWeight: '500',
  },
  recommendationCard: {
    padding: 16,
    backgroundColor: '#f8f9fa',
    borderRadius: 8,
  },
  recommendationContent: {
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  bottomPadding: {
    height: 40,
  },
  evo2Description: {
    fontSize: 13,
    color: '#666',
    lineHeight: 19,
    marginBottom: 12,
  },
  evo2Button: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#6C5CE7',
    padding: 12,
    borderRadius: 8,
    marginTop: 8,
  },
  evo2ButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
    marginLeft: 8,
  },
  evo2Loading: {
    alignItems: 'center',
    padding: 24,
  },
  evo2LoadingText: {
    marginTop: 12,
    fontSize: 13,
    color: '#6C5CE7',
  },
  evo2ErrorBox: {
    flexDirection: 'row',
    alignItems: 'center',
    backgroundColor: '#fde8e8',
    padding: 12,
    borderRadius: 8,
    flexWrap: 'wrap',
  },
  evo2ErrorText: {
    flex: 1,
    marginLeft: 8,
    fontSize: 13,
    color: '#DC3545',
  },
  retryButton: {
    paddingHorizontal: 12,
    paddingVertical: 4,
    borderRadius: 4,
    backgroundColor: '#DC3545',
    marginLeft: 8,
  },
  retryText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  evo2ResultCard: {
    padding: 14,
    backgroundColor: '#fafafa',
    borderRadius: 8,
    borderLeftWidth: 4,
    marginBottom: 10,
  },
  evo2ResultHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 10,
  },
  evo2VariantName: {
    fontSize: 15,
    fontWeight: '700',
    color: '#333',
  },
  evo2Badge: {
    paddingHorizontal: 10,
    paddingVertical: 3,
    borderRadius: 12,
  },
  evo2BadgeText: {
    fontSize: 12,
    fontWeight: '600',
  },
  evo2ScoreRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 8,
  },
  evo2ScoreItem: {
    alignItems: 'center',
    flex: 1,
  },
  evo2ScoreLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  evo2ScoreValue: {
    fontSize: 16,
    fontWeight: '700',
  },
  evo2ScoreValueMuted: {
    fontSize: 14,
    fontWeight: '500',
    color: '#666',
  },
  evo2MutationDetail: {
    fontSize: 12,
    color: '#888',
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    textAlign: 'center',
  },
  expanderHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    paddingHorizontal: 4,
    marginTop: 12,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  expanderLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  expanderTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginLeft: 8,
  },
  expanderContent: {
    paddingVertical: 12,
    paddingHorizontal: 4,
  },
  variantDetailRow: {
    flexDirection: 'row',
    alignItems: 'flex-start',
    marginBottom: 12,
    paddingBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  variantIndicator: {
    marginRight: 12,
    paddingTop: 4,
  },
  variantDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  variantInfo: {
    flex: 1,
  },
  variantDetailName: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  variantDetailGenotype: {
    fontSize: 13,
    color: '#666',
  },
  code: {
    fontFamily: Platform.OS === 'ios' ? 'Menlo' : 'monospace',
    backgroundColor: '#f0f0f0',
    paddingHorizontal: 4,
  },
  noVariants: {
    fontSize: 14,
    color: '#666',
    fontStyle: 'italic',
    textAlign: 'center',
    padding: 16,
    backgroundColor: '#f0f9ff',
    borderRadius: 8,
  },
  profileColumns: {
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  profileColumn: {
    flex: 1,
    paddingRight: 8,
  },
  profileColumnTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  profileItem: {
    fontSize: 13,
    color: '#555',
    marginBottom: 4,
    lineHeight: 18,
  },
  moreItems: {
    fontSize: 12,
    color: '#999',
    fontStyle: 'italic',
    marginTop: 4,
  },
  showMoreLink: {
    fontSize: 13,
    color: '#29B5E8',
    fontWeight: '600',
    marginTop: 8,
    paddingVertical: 4,
  },
  noItems: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
  scenarioCard: {
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#dee2e6',
    backgroundColor: '#fff',
    marginBottom: 8,
    overflow: 'hidden',
  },
  scenarioCardPrecision: {
    borderColor: '#6C5CE7',
    borderWidth: 2,
  },
  scenarioCardHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 14,
    paddingTop: 14,
    paddingBottom: 4,
  },
  scenarioCardTitle: {
    fontSize: 15,
    fontWeight: '700',
    color: '#495057',
    marginLeft: 8,
  },
  scenarioCardSubtitle: {
    fontSize: 12,
    color: '#868e96',
    paddingHorizontal: 14,
    marginBottom: 10,
  },
  scenarioCardBody: {
    backgroundColor: '#f8f9fa',
    padding: 14,
  },
  scenarioCardContent: {
    fontSize: 14,
    color: '#333',
    lineHeight: 22,
  },
  scenarioArrow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 8,
  },
  scenarioArrowText: {
    fontSize: 12,
    fontWeight: '700',
    color: '#6C5CE7',
    marginHorizontal: 8,
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
});
