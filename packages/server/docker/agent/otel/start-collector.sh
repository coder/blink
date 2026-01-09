#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.yaml"
LISTEN_PORT=54525
TIMEOUT=15

# Start collector in background (output goes to stdout)
collector --config "$CONFIG_FILE" &
COLLECTOR_PID=$!

# Wait for the TCP port to be ready
echo "Waiting for collector to be ready on port $LISTEN_PORT..."
elapsed=0
while ! nc -z 127.0.0.1 "$LISTEN_PORT" 2>/dev/null; do
    if ! kill -0 "$COLLECTOR_PID" 2>/dev/null; then
        echo "Collector process died unexpectedly"
        exit 1
    fi
    if [ "$elapsed" -ge "$TIMEOUT" ]; then
        echo "Timeout waiting for collector to be ready"
        kill "$COLLECTOR_PID" 2>/dev/null || true
        exit 1
    fi
    sleep 0.1
    elapsed=$((elapsed + 1))
done

echo "Collector is ready (PID: $COLLECTOR_PID)"
