import psycopg2

import os

conn = psycopg2.connect(
    host=os.environ["SFPG_HOST"],
    port=5432,
    dbname="postgres",
    user=os.environ.get("SFPG_USER", "snowflake_admin"),
    password=os.environ["SFPG_PASSWORD"],
    sslmode="require",
)

cur = conn.cursor()

cur.execute("""
CREATE SCHEMA IF NOT EXISTS fhir_staging;

CREATE TABLE IF NOT EXISTS fhir_staging.raw_bundles (
  bundle_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_system VARCHAR(100),
  source_file VARCHAR(500),
  quality_tier VARCHAR(50),
  bundle_data JSONB NOT NULL,
  resource_count INT,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fhir_staging.raw_hl7v2 (
  message_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_system VARCHAR(100),
  source_file VARCHAR(500),
  quality_tier VARCHAR(50),
  message_type VARCHAR(20),
  trigger_event VARCHAR(20),
  raw_message TEXT NOT NULL,
  parsed_segments JSONB,
  segment_count INT,
  has_z_segments BOOLEAN DEFAULT FALSE,
  ingested_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fhir_staging.validation_results (
  validation_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID,
  source_type VARCHAR(20),
  resource_type VARCHAR(50),
  resource_id VARCHAR(200),
  is_valid BOOLEAN,
  validation_score FLOAT,
  errors JSONB,
  warnings JSONB,
  quality_tier VARCHAR(50),
  validated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fhir_staging.quarantine (
  quarantine_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_id UUID,
  source_type VARCHAR(20),
  reason VARCHAR(500),
  reason_category VARCHAR(50),
  severity VARCHAR(20) DEFAULT 'ERROR',
  original_data JSONB,
  resource_type VARCHAR(50),
  source_code VARCHAR(200),
  source_system_name VARCHAR(200),
  suggested_concept_id INT,
  suggested_concept_name VARCHAR(500),
  resolution_status VARCHAR(20) DEFAULT 'PENDING',
  resolved_concept_id INT,
  resolved_by VARCHAR(100),
  resolved_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS fhir_staging.vocabulary_map (
  map_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_system VARCHAR(200),
  source_code VARCHAR(200),
  source_code_system VARCHAR(500),
  source_display VARCHAR(500),
  target_concept_id INT,
  target_concept_name VARCHAR(500),
  target_vocabulary_id VARCHAR(50),
  target_domain_id VARCHAR(50),
  mapping_type VARCHAR(30) DEFAULT 'MANUAL',
  confidence FLOAT DEFAULT 1.0,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  created_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS fhir_staging.source_profiles (
  profile_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_system VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(200),
  source_type VARCHAR(20),
  default_vocabulary JSONB,
  extension_handling JSONB,
  known_quirks JSONB,
  column_mappings JSONB,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  updated_by VARCHAR(100)
);

CREATE TABLE IF NOT EXISTS fhir_staging.quality_metrics (
  metric_id UUID DEFAULT gen_random_uuid() PRIMARY KEY,
  source_system VARCHAR(100),
  metric_date DATE DEFAULT CURRENT_DATE,
  total_records INT,
  valid_records INT,
  quarantined_records INT,
  unmapped_codes INT,
  avg_validation_score FLOAT,
  completeness_score FLOAT,
  conformance_score FLOAT,
  plausibility_score FLOAT,
  computed_at TIMESTAMPTZ DEFAULT NOW()
);
""")

cur.execute("CREATE INDEX IF NOT EXISTS idx_quarantine_status ON fhir_staging.quarantine(resolution_status);")
cur.execute("CREATE INDEX IF NOT EXISTS idx_quarantine_source ON fhir_staging.quarantine(source_code, source_system_name);")
cur.execute("CREATE INDEX IF NOT EXISTS idx_vocab_lookup ON fhir_staging.vocabulary_map(source_code, source_code_system) WHERE is_active = TRUE;")
cur.execute("CREATE INDEX IF NOT EXISTS idx_bundles_tier ON fhir_staging.raw_bundles(quality_tier);")
cur.execute("CREATE INDEX IF NOT EXISTS idx_bundles_ingested ON fhir_staging.raw_bundles(ingested_at);")

conn.commit()

cur.execute("SELECT table_name FROM information_schema.tables WHERE table_schema = 'fhir_staging' ORDER BY table_name;")
tables = cur.fetchall()
print("PG Schema created. Tables:")
for t in tables:
    print(f"  fhir_staging.{t[0]}")

conn.close()
