FROM nvcr.io/nvidia/pytorch:25.04-py3

RUN apt-get update && \
    apt-get install -y git python3-pip python3-tomli && \
    rm -rf /var/lib/apt/lists/*

RUN pip install evo2 bitsandbytes fastapi uvicorn

ENV HF_HOME=/models

RUN python -c "from huggingface_hub import snapshot_download; snapshot_download('arcinstitute/evo2_7b', cache_dir='/models/hub')"

WORKDIR /app

COPY server.py /app/server.py
COPY quantize.py /app/quantize.py

EXPOSE 8080

ENV CUDA_VISIBLE_DEVICES=0

CMD ["python", "-m", "uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
