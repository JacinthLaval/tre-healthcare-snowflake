# Evo2 7B - Quantized 4-bit Container for SPCS

## Overview
Evo2 7B genomic foundation model running in 4-bit (NF4) quantization on an A10G GPU (24GB VRAM) via Snowpark Container Services.

## API Endpoints

| Endpoint | Method | Description |
|---|---|---|
| `/health` | GET | Health check + GPU memory usage |
| `/score` | POST | Score likelihood of a DNA sequence |
| `/generate` | POST | Generate DNA from a prompt sequence |
| `/embeddings` | POST | Extract layer embeddings |
| `/variant-score` | POST | Compare ref vs alt allele (variant effect prediction) |

## Local Build & Test

```bash
# Build
docker build -t evo2-7b .

# Run (requires NVIDIA GPU with 24GB+ VRAM)
docker run -it --rm --gpus '"device=0"' \
  -p 8080:8080 \
  -v ./hf_cache:/models \
  evo2-7b

# Test
curl http://localhost:8080/health
curl -X POST http://localhost:8080/score \
  -H "Content-Type: application/json" \
  -d '{"sequence": "ACGTACGTACGT"}'
```

## Deploy to SPCS

```sql
-- 1. Create image repository
CREATE IMAGE REPOSITORY IF NOT EXISTS
  healthcare_database.default_schema.evo2_repo;

-- 2. Create model cache stage
CREATE STAGE IF NOT EXISTS
  healthcare_database.default_schema.evo2_model_stage
  DIRECTORY = (ENABLE = TRUE);

-- 3. Tag and push image
-- docker tag evo2-7b <org>-<acct>.registry.snowflakecomputing.com/healthcare_database/default_schema/evo2_repo/evo2-7b:latest
-- docker push <org>-<acct>.registry.snowflakecomputing.com/healthcare_database/default_schema/evo2_repo/evo2-7b:latest

-- 4. Create service on GPU compute pool
CREATE SERVICE evo2_service
  IN COMPUTE POOL evo2_compute_pool
  FROM @healthcare_database.default_schema.evo2_model_stage
  SPECIFICATION_FILE = 'spcs-service-spec.yaml'
  MIN_INSTANCES = 1
  MAX_INSTANCES = 1;

-- 5. Check status
SHOW SERVICES LIKE 'evo2_service';
SELECT SYSTEM$GET_SERVICE_STATUS('evo2_service');
```

## Hardware Requirements
- GPU: NVIDIA A10G (24GB) minimum - GPU_NV_M in SPCS
- RAM: 16GB system memory
- Disk: ~16GB for model weights
- Quantization: 4-bit NF4 via bitsandbytes
