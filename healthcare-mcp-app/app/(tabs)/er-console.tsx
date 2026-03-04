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

interface ClinicalProfile {
  conditions: string[];
  medications: string[];
  cyp2c19: CYP2C19Profile;
}

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

  useEffect(() => {
    const client = getMCPClient();
    if (!client) {
      const pat = Platform.OS === 'web' ? localStorage.getItem('snowflake_pat') : null;
      if (pat) {
        initMCPClient(pat);
      } else {
        router.replace('/');
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
    loadClinicalProfile(patient.SAMPLE_ID);
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
      
      let cyp2c19Info = `CYP2C19 GENOTYPE RESULTS:
- Phenotype: ${cyp2c19.phenotype}
- Clinical Recommendation: ${cyp2c19.recommendation}`;
      
      if (cyp2c19.variants && cyp2c19.variants.length > 0) {
        cyp2c19Info += '\n- Variants detected:';
        cyp2c19.variants.forEach((v: CYP2C19Variant) => {
          cyp2c19Info += `\n  - ${v.variant} (${v.rs_id}): ${v.allele1}/${v.allele2} - ${v.status}`;
        });
      }

      const query = `You are a clinical pharmacogenomics advisor with access to PubMed and ClinicalTrials.gov.

PATIENT INFORMATION:
- Name: ${selectedPatient.PATIENT_NAME}
- Sample ID: ${selectedPatient.SAMPLE_ID}
- Ancestry: ${selectedPatient.SUPERPOPULATION} (${selectedPatient.POPULATION})

PATIENT'S GENOMIC DATA:
${cyp2c19Info}

PATIENT'S CURRENT CONDITIONS (from EHR):
${conditions.slice(0, 10).map(c => '- ' + c).join('\n')}

PATIENT'S CURRENT MEDICATIONS (from EHR):
${medications.slice(0, 10).map(m => '- ' + m).join('\n')}

CLINICAL NOTES (ER presentation):
${clinicalNotes}

Based on this patient's ACTUAL genomic profile and clinical data:
1. Search ClinicalTrials.gov for relevant trials given their CYP2C19 status
2. Search PubMed for pharmacogenomics guidance specific to their genotype

Provide a structured recommendation:

## Genomic Assessment
(Interpret the patient's CYP2C19 genotype in clinical context)

## Drug-Therapy Implications
(Specific guidance based on their ${cyp2c19.phenotype} status)

## Current Medication Review
(Flag any current medications affected by CYP2C19 status)

## Evidence-Based Alternatives
(Alternative therapies supported by pharmacogenomic evidence)

## Emerging Therapies
(Relevant clinical trials for their genotype and conditions)

## Recommendation
(Specific actionable guidance based on genomic data)

## Key References`;

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
                  {filterClinicalConditions(clinicalProfile.conditions || []).slice(0, 8).map((c, i) => (
                    <Text key={i} style={styles.profileItem}>• {c}</Text>
                  ))}
                  {filterClinicalConditions(clinicalProfile.conditions || []).length > 8 && (
                    <Text style={styles.moreItems}>
                      ...and {filterClinicalConditions(clinicalProfile.conditions || []).length - 8} more
                    </Text>
                  )}
                  {(!clinicalProfile.conditions || clinicalProfile.conditions.length === 0) && (
                    <Text style={styles.noItems}>No conditions on record</Text>
                  )}
                </View>

                {/* Medications */}
                <View style={styles.profileColumn}>
                  <Text style={styles.profileColumnTitle}>Current Medications:</Text>
                  {(clinicalProfile.medications || []).slice(0, 8).map((m, i) => (
                    <Text key={i} style={styles.profileItem}>• {m}</Text>
                  ))}
                  {(clinicalProfile.medications || []).length > 8 && (
                    <Text style={styles.moreItems}>
                      ...and {clinicalProfile.medications.length - 8} more
                    </Text>
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
                <Text style={styles.analyzeButtonText}>Analyze with NeoResearchAgent</Text>
              </>
            )}
          </TouchableOpacity>
        </View>
      )}

      {/* Recommendation */}
      {recommendation && (
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>
            <Ionicons name="bulb" size={18} color="#29B5E8" /> Clinical Decision Support
          </Text>
          
          {clinicalProfile?.cyp2c19?.phenotype?.includes('Poor') || 
           clinicalProfile?.cyp2c19?.phenotype?.includes('Intermediate') ? (
            <View style={styles.alertBox}>
              <Ionicons name="warning" size={20} color="#DC3545" />
              <Text style={styles.alertText}>
                ACTION REQUIRED - CYP2C19 {clinicalProfile.cyp2c19.phenotype}: 
                Consider alternative to clopidogrel (prasugrel or ticagrelor)
              </Text>
            </View>
          ) : null}

          <View style={styles.recommendationCard}>
            <Text style={styles.recommendationContent}>{recommendation}</Text>
          </View>
        </View>
      )}

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
  noItems: {
    fontSize: 13,
    color: '#999',
    fontStyle: 'italic',
  },
});
