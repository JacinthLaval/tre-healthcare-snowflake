#!/bin/bash
# Build and push HADES image to Snowflake SPCS

set -e

# Configuration
REPO_URL="sfsehol-si-industry-demos-healthcare-lmszks.registry.snowflakecomputing.com/tre_healthcare_db/omop_cdm/hades_repo"
IMAGE_NAME="hades-snowflake"
IMAGE_TAG="latest"

echo "=== HADES SPCS Deployment Script ==="

# Step 1: Build the Docker image
echo "Building Docker image..."
docker build -t ${IMAGE_NAME}:${IMAGE_TAG} .

# Step 2: Login to Snowflake registry
echo "Logging into Snowflake registry..."
echo "Run: snow spcs image-registry login"
# Or use: docker login ${REPO_URL}

# Step 3: Tag for SPCS
echo "Tagging image for SPCS..."
docker tag ${IMAGE_NAME}:${IMAGE_TAG} ${REPO_URL}/${IMAGE_NAME}:${IMAGE_TAG}

# Step 4: Push to SPCS
echo "Pushing image to SPCS..."
docker push ${REPO_URL}/${IMAGE_NAME}:${IMAGE_TAG}

echo "=== Image pushed successfully ==="
echo ""
echo "Next steps:"
echo "1. Check compute pool status: DESCRIBE COMPUTE POOL HADES_COMPUTE_POOL;"
echo "2. Create the service using setup_hades.sql"
echo "3. Get endpoint URL: SHOW ENDPOINTS IN SERVICE TRE_HEALTHCARE_DB.OMOP_CDM.HADES_SERVICE;"
