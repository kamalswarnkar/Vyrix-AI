# Vyrix Beta-2 — Training Environment
#
# Supports:
#   prepare_dataset.py  — CPU-compatible, no GPU needed
#   merge_adapter.py    — CPU-compatible (merges on CPU, slow but works)
#   train_qlora.py      — REQUIRES CUDA GPU with 24GB+ VRAM; will fail on CPU
#
# Build:
#   docker compose -f docker/docker-compose.yml --profile training build training
#
# Prepare dataset:
#   docker compose -f docker/docker-compose.yml --profile training run --rm training \
#     python training/scripts/prepare_dataset.py
#
# Merge adapter (after training on GPU machine):
#   docker compose -f docker/docker-compose.yml --profile training run --rm training \
#     python training/scripts/merge_adapter.py \
#       --adapter /models/qlora_adapter \
#       --base Qwen/Qwen2.5-VL-7B-Instruct \
#       --output /models/vyrix-qwen-merged

FROM python:3.11-slim

RUN apt-get update && apt-get install -y --no-install-recommends \
    git \
    curl \
    build-essential \
  && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Install Python deps as a separate cached layer
COPY training/requirements.txt ./training/requirements.txt
# ponytail: CPU torch only here; GPU variant installed on the actual training machine
RUN pip install --no-cache-dir torch --index-url https://download.pytorch.org/whl/cpu \
 && pip install --no-cache-dir -r training/requirements.txt

# Copy training scripts and config
COPY training/ ./training/

# Calibration results may be used by prepare_dataset.py — mount at runtime, not bake-in
# See docker-compose.yml training service volume mounts.

ENV PYTHONUNBUFFERED=1

CMD ["python", "training/scripts/prepare_dataset.py"]
