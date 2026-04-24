#!/bin/bash
set -eu

REPO="sfsehol-si-industry-demos-healthcare-lmszks.registry.snowflakecomputing.com/healthcare_database/default_schema/webapp_repo"
IMAGE="precision-advisor"
TAG="latest"
COMPUTE_POOL="PRECISION_COMPUTE_POOL"
SERVICE="PRECISION_ADVISOR_WEB"
DB="HEALTHCARE_DATABASE"
SCHEMA="DEFAULT_SCHEMA"

SKIP_EXPO=false
PUSH_ONLY=false
for arg in "$@"; do
  case "$arg" in
    --skip-expo)  SKIP_EXPO=true ;;
    --push-only)  PUSH_ONLY=true; SKIP_EXPO=true ;;
    --tag=*)      TAG="${arg#--tag=}" ;;
  esac
done

step() { echo -e "\n\033[1;36m▸ $1\033[0m"; }

if [ "$SKIP_EXPO" = false ]; then
  step "Building web export (npx expo export)"
  npx expo export --platform web --clear
fi

if [ "$PUSH_ONLY" = false ]; then
  step "Building Docker image (linux/amd64)"
  docker build --platform linux/amd64 -t "${IMAGE}:${TAG}" .
fi

step "Tagging for Snowflake registry"
docker tag "${IMAGE}:${TAG}" "${REPO}/${IMAGE}:${TAG}"

step "Pushing to Snowflake registry"
docker push "${REPO}/${IMAGE}:${TAG}"

step "Image pushed — restart the SPCS service with:"
cat <<EOF

  -- Run in Snowflake:
  ALTER SERVICE ${DB}.${SCHEMA}.${SERVICE} SUSPEND;
  DROP SERVICE IF EXISTS ${DB}.${SCHEMA}.${SERVICE};
  CREATE SERVICE ${DB}.${SCHEMA}.${SERVICE}
    IN COMPUTE POOL ${COMPUTE_POOL}
    FROM SPECIFICATION \$\$
$(cat "$(dirname "$0")/spcs-spec.yaml")
    \$\$
    MIN_INSTANCES = 1
    MAX_INSTANCES = 1;
  SHOW ENDPOINTS IN SERVICE ${DB}.${SCHEMA}.${SERVICE};

EOF

echo -e "\033[1;32m✓ Deploy complete — run the SQL above to restart the service\033[0m"
