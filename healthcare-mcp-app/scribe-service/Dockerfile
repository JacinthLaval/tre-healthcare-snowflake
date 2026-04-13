FROM nvidia/cuda:12.1.1-runtime-ubuntu22.04

RUN apt-get update && apt-get install -y --no-install-recommends \
    python3 python3-pip python3-dev libsndfile1 ffmpeg git && \
    rm -rf /var/lib/apt/lists/*

WORKDIR /app

COPY requirements.txt .
RUN pip3 install --no-cache-dir -r requirements.txt

COPY app.py .

RUN mkdir -p /models/whisper

EXPOSE 8080

ENV WHISPER_MODEL=large-v3
ENV USE_GPU=true
ENV PYTHONUNBUFFERED=1

CMD ["python3", "app.py"]
