#!/bin/bash
set -e

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
CONFIG_FILE="${SCRIPT_DIR}/config.yaml"
PIPE_PATH="/var/log/agent/agent.pipe"

# Create the named pipe
rm -f "$PIPE_PATH"
mkfifo "$PIPE_PATH"

# Start collector in background
collector --config "$CONFIG_FILE" &
COLLECTOR_PID=$!

echo "Collector started (PID: $COLLECTOR_PID), reading from $PIPE_PATH"
