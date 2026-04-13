export interface SQLResult {
  columns: string[];
  data: (string | null)[][];
}

export interface IngestionStats {
  total_bundles: number;
  valid: number;
  quarantined: number;
  unmapped_codes: number;
  avg_quality_score: number;
}

export interface QualityTierSummary {
  tier: string;
  count: number;
  avg_resources: number;
}

export interface QuarantineRecord {
  quarantine_id: string;
  source_type: string;
  reason: string;
  reason_category: string;
  severity: string;
  source_code: string;
  source_system_name: string;
  suggested_concept_id: number | null;
  suggested_concept_name: string | null;
  resolution_status: string;
  created_at: string;
}

export interface VocabularyMapping {
  map_id: string;
  source_code: string;
  source_code_system: string;
  source_display: string;
  target_concept_id: number;
  target_concept_name: string;
  target_vocabulary_id: string;
  target_domain_id: string;
  mapping_type: string;
  confidence: number;
  is_active: boolean;
}

export interface SourceProfile {
  profile_id: string;
  source_system: string;
  display_name: string;
  source_type: string;
  is_active: boolean;
  default_vocabulary: Record<string, string>;
  extension_handling: Record<string, unknown>;
  known_quirks: Record<string, unknown>;
}

export interface QualityMetric {
  source_system: string;
  metric_date: string;
  total_records: number;
  valid_records: number;
  quarantined_records: number;
  completeness_score: number;
  conformance_score: number;
  plausibility_score: number;
}

export type ViewName = 'monitor' | 'quarantine' | 'vocabulary' | 'profiles' | 'quality';
