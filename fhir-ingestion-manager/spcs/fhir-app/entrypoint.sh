#!/bin/sh
TOKEN_FILE="/snowflake/session/token"
echo "[entrypoint] Waiting for SPCS token file..."
for i in $(seq 1 30); do
    if [ -f "$TOKEN_FILE" ]; then
        echo "[entrypoint] Token file found after ${i}s"
        break
    fi
    sleep 1
done

if [ ! -f "$TOKEN_FILE" ]; then
    echo "[entrypoint] WARNING: Token file not found after 30s, backend may fail to connect"
fi

echo "[entrypoint] Starting Python backend on port 8085..."
python3 /app/backend.py &
BACKEND_PID=$!
sleep 2
if kill -0 $BACKEND_PID 2>/dev/null; then
    echo "[entrypoint] Backend started (PID=$BACKEND_PID)"
else
    echo "[entrypoint] ERROR: Backend failed to start"
fi

echo "[entrypoint] Starting nginx on port 8080"
exec nginx -g "daemon off;"
