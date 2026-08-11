#!/usr/bin/env bash
# pull-model.sh — Ensures the required Ollama model is present.
# Called at container startup before running calibration.

set -euo pipefail

MODEL="${VYRIX_MODEL:-qwen2.5vl:7b}"
OLLAMA_BASE="${OLLAMA_BASE_URL:-http://ollama:11434}"

echo "▶ Checking for model: ${MODEL}"
echo "  Ollama endpoint: ${OLLAMA_BASE}"

# Wait for Ollama to be ready (up to 60s)
for i in $(seq 1 30); do
  if curl -sf "${OLLAMA_BASE}/api/tags" > /dev/null 2>&1; then
    echo "  ✓ Ollama is ready"
    break
  fi
  if [ "$i" -eq 30 ]; then
    echo "  ✗ Ollama not reachable at ${OLLAMA_BASE} after 60s"
    echo "  Make sure the ollama service is running (docker compose up ollama)"
    exit 1
  fi
  sleep 2
done

# Check if model already present
INSTALLED=$(curl -sf "${OLLAMA_BASE}/api/tags" | grep -o "\"name\":\"[^\"]*\"" | grep -c "${MODEL%%:*}" || true)

if [ "$INSTALLED" -gt 0 ]; then
  echo "  ✓ Model already installed: ${MODEL}"
else
  echo "  ⬇ Pulling model: ${MODEL} (this may take 5-15 min on first run)"
  echo "  Model size: ~5.4 GB (qwen2.5vl:7b)"
  curl -s -X POST "${OLLAMA_BASE}/api/pull" \
    -H "Content-Type: application/json" \
    -d "{\"name\": \"${MODEL}\"}" \
    --no-buffer | while IFS= read -r line; do
      STATUS=$(echo "$line" | grep -o '"status":"[^"]*"' | cut -d'"' -f4 || true)
      if [ -n "$STATUS" ]; then echo "  ${STATUS}"; fi
    done
  echo "  ✓ Model pull complete"
fi

# If a command was passed (e.g. npm run calibrate), run it
if [ "${1:-}" ]; then
  echo "▶ Running: $*"
  exec "$@"
fi
