# Vyrix AI Development Environment
#
# Provides: Node 20, tsx, Ollama CLI (server NOT started — user must mount or run separately)
# Model: NOT baked in. Downloaded at container startup if missing.
#
# Build:
#   docker compose -f docker/docker-compose.yml build
#
# Run calibration:
#   docker compose -f docker/docker-compose.yml run --rm calibrate
#
# NOTE: Ollama requires GPU passthrough or CPU-only inference.
#       For GPU (NVIDIA): add `runtime: nvidia` in docker-compose.yml
#       For CPU-only: set OLLAMA_NUM_PARALLEL=1 and expect slower inference.

FROM node:20-slim

# System tools
RUN apt-get update && apt-get install -y --no-install-recommends \
    curl \
    ca-certificates \
    procps \
  && rm -rf /var/lib/apt/lists/*

# Install Ollama CLI (used to pull models; server runs separately via compose service)
RUN curl -fsSL https://ollama.com/install.sh | sh

WORKDIR /app

# Install Node deps first (cached layer)
COPY electron/ai/package.json electron/ai/package-lock.json* ./electron/ai/
RUN cd electron/ai && npm ci --include=optional 2>/dev/null || npm install

# Copy AI subsystem source
COPY electron/ai/ ./electron/ai/

# Copy model-pull helper
COPY docker/pull-model.sh /pull-model.sh
RUN chmod +x /pull-model.sh

# Volumes (declared here for documentation; actually mounted via compose)
# /app/electron/ai/calibration/results  — calibration output
# /ollama-models                         — Ollama model storage (bind to host ~/.ollama)

ENV OLLAMA_BASE_URL=http://ollama:11434
ENV VYRIX_MODEL=qwen2.5-vl:7b-q4_K_M

CMD ["/pull-model.sh"]
