"""
Vyrix Research Assistant — Fine-tuning script
Base model : meta-llama/Llama-3.2-3B-Instruct
Method     : QLoRA via Unsloth (4-bit, LoRA r=16)
Output     : GGUF Q4_K_M ready to load into Ollama

Requirements (install before running):
    pip install "unsloth[colab-new] @ git+https://github.com/unslothai/unsloth.git"
    pip install --no-deps trl peft accelerate bitsandbytes

Hardware:
    - NVIDIA GPU with ≥8 GB VRAM (RTX 3060 or better)
    - 16 GB system RAM recommended
    - ~6 GB disk space for the model + adapters + GGUF export

Usage:
    python fine-tuning/finetune.py

After training completes, load the fine-tuned model into Ollama:
    Edit ollama/Modelfile: change the FROM line to:
        FROM ./fine-tuning/vyrix-3b-research-Q4_K_M.gguf
    Then run:
        ollama create vyrix-research -f ollama/Modelfile
        ollama run vyrix-research
"""

import json
import os
import torch
from pathlib import Path

# ── Configuration ───────────────────────────────────────────
BASE_MODEL      = "unsloth/Llama-3.2-3B-Instruct"
DATASET_PATH    = Path(__file__).parent / "dataset.jsonl"
OUTPUT_DIR      = Path(__file__).parent / "outputs"
EXPORT_NAME     = str(Path(__file__).parent / "vyrix-3b-research")

MAX_SEQ_LENGTH  = 4_096
LORA_RANK       = 16
LORA_ALPHA      = 16
BATCH_SIZE      = 2
GRAD_ACCUM      = 4          # effective batch = 8
EPOCHS          = 3
LEARNING_RATE   = 2e-4
WARMUP_STEPS    = 10
SEED            = 42

SYSTEM_PROMPT = (
    "You are Vyrix, a local AI research assistant built exclusively for PhD students "
    "and academic researchers. You assist ONLY with research-related tasks. Refuse any "
    "off-topic request with: \"I am a research-only assistant. I cannot help with that. "
    "Please ask a research-related question.\" Never fabricate citations, statistics, or "
    "author names — cite only from context provided in the conversation."
)


def load_dataset(path: Path) -> list[dict]:
    records = []
    with open(path) as f:
        for line in f:
            line = line.strip()
            if line:
                records.append(json.loads(line))
    print(f"Loaded {len(records)} training examples from {path}")
    return records


def format_example(example: dict, tokenizer) -> str:
    """Apply the Llama 3 chat template to a messages dict."""
    return tokenizer.apply_chat_template(
        example["messages"],
        tokenize=False,
        add_generation_prompt=False,
    )


def main():
    from unsloth import FastLanguageModel
    from datasets import Dataset
    from trl import SFTTrainer
    from transformers import TrainingArguments

    print(f"PyTorch version : {torch.__version__}")
    print(f"CUDA available  : {torch.cuda.is_available()}")
    if torch.cuda.is_available():
        print(f"GPU             : {torch.cuda.get_device_name(0)}")

    # ── Load base model with 4-bit quantisation ──────────────
    print(f"\nLoading base model: {BASE_MODEL}")
    model, tokenizer = FastLanguageModel.from_pretrained(
        model_name=BASE_MODEL,
        max_seq_length=MAX_SEQ_LENGTH,
        dtype=None,          # auto-detect bfloat16 / float16
        load_in_4bit=True,
    )

    # ── Attach LoRA adapters ──────────────────────────────────
    model = FastLanguageModel.get_peft_model(
        model,
        r=LORA_RANK,
        target_modules=[
            "q_proj", "k_proj", "v_proj", "o_proj",
            "gate_proj", "up_proj", "down_proj",
        ],
        lora_alpha=LORA_ALPHA,
        lora_dropout=0,
        bias="none",
        use_gradient_checkpointing="unsloth",
        random_state=SEED,
    )

    # ── Prepare dataset ───────────────────────────────────────
    raw_records = load_dataset(DATASET_PATH)
    formatted_texts = [format_example(r, tokenizer) for r in raw_records]
    dataset = Dataset.from_dict({"text": formatted_texts})
    print(f"Dataset formatted. First example preview:\n{formatted_texts[0][:300]}...\n")

    # ── Training arguments ────────────────────────────────────
    OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
    training_args = TrainingArguments(
        output_dir=str(OUTPUT_DIR),
        per_device_train_batch_size=BATCH_SIZE,
        gradient_accumulation_steps=GRAD_ACCUM,
        warmup_steps=WARMUP_STEPS,
        num_train_epochs=EPOCHS,
        learning_rate=LEARNING_RATE,
        fp16=not torch.cuda.is_bf16_supported(),
        bf16=torch.cuda.is_bf16_supported(),
        logging_steps=5,
        save_strategy="epoch",
        optim="adamw_8bit",
        seed=SEED,
        report_to="none",
    )

    # ── Trainer ───────────────────────────────────────────────
    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=dataset,
        dataset_text_field="text",
        max_seq_length=MAX_SEQ_LENGTH,
        args=training_args,
    )

    print("Starting fine-tuning...")
    trainer_stats = trainer.train()
    print(f"\nTraining complete.")
    print(f"  Runtime : {trainer_stats.metrics['train_runtime']:.0f}s")
    print(f"  Loss    : {trainer_stats.metrics['train_loss']:.4f}")

    # ── Save LoRA adapters ────────────────────────────────────
    adapter_path = str(OUTPUT_DIR / "lora_adapters")
    model.save_pretrained(adapter_path)
    tokenizer.save_pretrained(adapter_path)
    print(f"LoRA adapters saved to: {adapter_path}")

    # ── Export merged GGUF for Ollama ─────────────────────────
    print(f"\nExporting GGUF (Q4_K_M) to: {EXPORT_NAME}-Q4_K_M.gguf")
    print("This step merges LoRA weights into the base model and quantises.")
    print("It may take 10–20 minutes depending on hardware.\n")
    model.save_pretrained_gguf(
        EXPORT_NAME,
        tokenizer,
        quantization_method="q4_k_m",
    )
    gguf_path = f"{EXPORT_NAME}-Q4_K_M.gguf"
    print(f"\nExport complete: {gguf_path}")

    # ── Print Ollama instructions ─────────────────────────────
    print("\n" + "=" * 60)
    print("NEXT STEPS — load into Ollama")
    print("=" * 60)
    print(f"1. Edit ollama/Modelfile — change the first line to:")
    print(f"       FROM ./{gguf_path}")
    print(f"2. Run:")
    print(f"       ollama create vyrix-research -f ollama/Modelfile")
    print(f"3. Test:")
    print(f"       ollama run vyrix-research")
    print("=" * 60)


if __name__ == "__main__":
    main()
