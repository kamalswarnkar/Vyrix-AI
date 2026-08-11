# Vyrix Beta-2 — QLoRA Fine-Tuning Infrastructure

> **Status:** Infrastructure prepared. Execution requires 24GB+ VRAM. Do NOT run on 8GB RAM machine.

This directory contains scripts and configuration for fine-tuning Qwen2.5-VL 7B on Vyrix-specific Beta-2 task types using QLoRA.

## Hardware requirements

| Resource | Minimum | Recommended |
|---|---|---|
| VRAM | 24 GB (RTX 3090 / A5000) | 40 GB (A100 / H100) |
| RAM | 32 GB | 64 GB |
| Storage | 50 GB free | 100 GB free |

**DO NOT attempt training on a machine with less than 24 GB VRAM.**

## Directory structure

```
training/
├── README.md              — this file
├── scripts/
│   ├── prepare_dataset.py — converts calibration results + examples to JSONL training format
│   ├── train_qlora.py     — QLoRA fine-tuning script (Hugging Face + PEFT)
│   └── merge_adapter.py   — merges LoRA adapter into base model for deployment
├── configs/
│   └── qlora_config.yaml  — hyperparameters and LoRA config
└── data/
    ├── FORMAT.md          — training data format specification
    └── .gitkeep           — placeholder (training data not committed)
```

## Training workflow

```bash
# 1. Prepare dataset from calibration results
python training/scripts/prepare_dataset.py \
  --calibration-dir electron/ai/calibration/results \
  --output training/data/train.jsonl

# 2. Run QLoRA fine-tuning (requires 24GB+ VRAM)
python training/scripts/train_qlora.py \
  --config training/configs/qlora_config.yaml \
  --data training/data/train.jsonl

# 3. Merge adapter into base model
python training/scripts/merge_adapter.py \
  --adapter outputs/qlora_adapter \
  --base Qwen/Qwen2.5-VL-7B-Instruct \
  --output outputs/vyrix-qwen2.5-vl-7b-v1

# 4. Convert to GGUF for llama.cpp sidecar
python llama.cpp/convert.py outputs/vyrix-qwen2.5-vl-7b-v1 \
  --outfile models/vyrix-qwen2.5-vl-7b-v1-q4_K_M.gguf \
  --outtype q4_K_M
```

## Task types to fine-tune on

| Task type | Purpose | Min examples |
|---|---|---|
| mission-classification | Subject vs project classification | 200 |
| desirability-evaluation | Initial demand assessment | 150 |
| dvf-evaluation | Full D+V+F evaluation | 150 |
| progress-evaluation | Step completion scoring | 300 |
| decision | Continue/improve/redesign | 100 |

## Data format

See `training/data/FORMAT.md` for the JSONL format spec.
All training examples must use the same prompt format as the production prompt templates in `electron/ai/prompt/templates/`.

## After training

1. Update `electron/ai/core/LlamaSidecar.ts` modelPath to point to new GGUF.
2. Update `DEFAULT_MODEL` in `electron/ai/calibration/ollama.ts` to new model name.
3. Re-run all calibration phases (01–16) to verify no regression.
4. Update PRODUCTION-READINESS.md with fine-tuning results.
