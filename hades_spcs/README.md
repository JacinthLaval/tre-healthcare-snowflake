# OHDSI HADES for Snowpark Container Services

This directory contains the configuration to deploy [OHDSI HADES](https://ohdsi.github.io/Hades/) (Health Analytics Data-to-Evidence Suite) to Snowpark Container Services (SPCS).

## Overview

HADES is a collection of R packages for large-scale analytics including:
- **Population characterization** (Achilles, DataQualityDashboard)
- **Population-level causal effect estimation** (CohortMethod, SelfControlledCaseSeries)
- **Patient-level prediction** (PatientLevelPrediction)

## Files

| File | Description |
|------|-------------|
| `Dockerfile` | Custom HADES image with Snowflake JDBC driver |
| `snowflake_connection.R` | R helper script for Snowflake connectivity |
| `hades_service_spec.yaml` | SPCS service specification |
| `setup_hades.sql` | SQL commands to create SPCS infrastructure |
| `build_and_push.sh` | Script to build and push Docker image |

## Deployment Steps

### 1. Build Docker Image

```bash
cd hades_spcs
docker build -t hades-snowflake:latest .
```

### 2. Push to SPCS Registry

```bash
# Login to Snowflake registry
snow spcs image-registry login

# Tag and push
REPO_URL="sfsehol-si-industry-demos-healthcare-lmszks.registry.snowflakecomputing.com/tre_healthcare_db/omop_cdm/hades_repo"
docker tag hades-snowflake:latest $REPO_URL/hades-snowflake:latest
docker push $REPO_URL/hades-snowflake:latest
```

### 3. Create Service

Run the commands in `setup_hades.sql` or:

```sql
CREATE SERVICE TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE
  IN COMPUTE POOL HADES_COMPUTE_POOL
  FROM SPECIFICATION $$ ... $$;
```

### 4. Access RStudio

```sql
SHOW ENDPOINTS IN SERVICE TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE;
```

Navigate to the `rstudio` endpoint URL in your browser.

## Usage in RStudio

Once connected to RStudio:

```r
# Load connection helper
source("/opt/hades/snowflake_connection.R")

# Create connection
connectionDetails <- createSnowflakeConnectionDetails(
  user = "YOUR_USER",
  password = "YOUR_PASSWORD"
)

# Test connection
testSnowflakeConnection(connectionDetails)

# List available tables
listOmopTables(connectionDetails)

# Run Achilles characterization
library(Achilles)
achilles(
  connectionDetails = connectionDetails,
  cdmDatabaseSchema = "TRE_HEALTHCARE_DB.OMOP_CDM",
  resultsDatabaseSchema = "TRE_HEALTHCARE_DB.OMOP_CDM",
  sourceName = "TRE_Healthcare"
)
```

## Available OMOP CDM Tables

| Table | Rows |
|-------|------|
| PERSON | 100 |
| OBSERVATION_PERIOD | 100 |
| CONDITION_OCCURRENCE | 1,144 |
| DRUG_EXPOSURE | 867 |
| PROCEDURE_OCCURRENCE | 758 |
| VISIT_OCCURRENCE | 600 |

Plus 20 CIBMTR transplant research tables.

## Requirements

- Docker
- Snowflake CLI (`snow`)
- ACCOUNTADMIN or appropriate privileges for SPCS
