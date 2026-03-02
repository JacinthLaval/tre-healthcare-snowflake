-- HADES SPCS Setup for TRE Healthcare
-- Run these commands in Snowflake to set up HADES infrastructure

-- 1. Create image repository
CREATE IMAGE REPOSITORY IF NOT EXISTS TRE_HEALTHCARE_DB.OMOP_CDM.HADES_REPO;

-- 2. Create compute pool for HADES (CPU)
CREATE COMPUTE POOL IF NOT EXISTS HADES_COMPUTE_POOL
  MIN_NODES = 1
  MAX_NODES = 2
  INSTANCE_FAMILY = CPU_X64_M
  AUTO_RESUME = TRUE
  AUTO_SUSPEND_SECS = 3600
  COMMENT = 'Compute pool for OHDSI HADES analytics';

-- 3. Check compute pool status (wait for ACTIVE or IDLE)
DESCRIBE COMPUTE POOL HADES_COMPUTE_POOL;

-- 4. Get repository URL for docker push
SHOW IMAGE REPOSITORIES IN SCHEMA TRE_HEALTHCARE_DB.OMOP_CDM;

-- 5. Create the HADES service (run after pushing docker image)
CREATE SERVICE IF NOT EXISTS TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE
  IN COMPUTE POOL HADES_COMPUTE_POOL
  FROM SPECIFICATION $$
  spec:
    containers:
      - name: hades
        image: /TRE_HEALTHCARE_DB/OMOP_CDM/HADES_REPO/hades-snowflake:latest
        env:
          DISABLE_AUTH: "true"
          ROOT: "TRUE"
          DATABASECONNECTOR_JAR_FOLDER: "/opt/hades/jdbc_drivers"
        resources:
          requests:
            memory: 8Gi
            cpu: 4
          limits:
            memory: 16Gi
            cpu: 8
    endpoints:
      - name: rstudio
        port: 8787
        public: true
  $$
  MIN_INSTANCES = 1
  MAX_INSTANCES = 1;

-- 6. Check service status
DESCRIBE SERVICE TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE;

-- 7. Get public endpoint URL
SHOW ENDPOINTS IN SERVICE TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE;

-- 8. View service logs (for debugging)
SELECT SYSTEM$GET_SERVICE_LOGS('TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE', 0, 'hades', 100);

-- Optional: Upgrade to GPU pool for ML workloads
-- ALTER COMPUTE POOL HADES_COMPUTE_POOL SET INSTANCE_FAMILY = GPU_NV_S;

-- Cleanup commands (if needed)
-- DROP SERVICE IF EXISTS TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE;
-- DROP COMPUTE POOL IF EXISTS HADES_COMPUTE_POOL;
-- DROP IMAGE REPOSITORY IF EXISTS TRE_HEALTHCARE_DB.OMOP_CDM.HADES_REPO;
