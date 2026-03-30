FROM nvcr.io/nvidia/rapidsai/base:26.02-cuda12-py3.11

RUN pip install --no-cache-dir \
    fastapi \
    uvicorn[standard] \
    snowflake-connector-python[pandas] \
    cugraph-cu12 --extra-index-url=https://pypi.nvidia.com

WORKDIR /app
COPY server.py .

EXPOSE 8080

CMD ["uvicorn", "server:app", "--host", "0.0.0.0", "--port", "8080"]
