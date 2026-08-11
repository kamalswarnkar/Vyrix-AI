#!/usr/bin/env python3
"""
train_qlora.py — QLoRA fine-tuning for Vyrix Beta-2.
Requires: transformers, peft, bitsandbytes, trl, datasets, accelerate, yaml

Usage:
    python training/scripts/train_qlora.py \
        --config training/configs/qlora_config.yaml \
        --data training/data/train.jsonl

Hardware requirements: 24GB+ VRAM. DO NOT run on 8GB RAM machine.
"""

import argparse
import json
import sys
from pathlib import Path

try:
    import yaml
    import torch
    from datasets import Dataset
    from transformers import (
        AutoModelForCausalLM,
        AutoTokenizer,
        BitsAndBytesConfig,
        TrainingArguments,
    )
    from peft import LoraConfig, get_peft_model, prepare_model_for_kbit_training
    from trl import SFTTrainer
except ImportError as e:
    print(f"Missing dependency: {e}")
    print("Install: pip install transformers peft bitsandbytes trl datasets accelerate pyyaml")
    sys.exit(1)


def load_config(config_path: str) -> dict:
    with open(config_path) as f:
        return yaml.safe_load(f)


def load_dataset(data_path: str) -> Dataset:
    rows = []
    for line in Path(data_path).read_text().splitlines():
        line = line.strip()
        if line:
            rows.append(json.loads(line))
    return Dataset.from_list(rows)


def format_example(ex: dict, tokenizer) -> str:
    """Format as chat template — Qwen2.5 uses ChatML format."""
    messages = [
        {"role": "system",    "content": ex["system"]},
        {"role": "user",      "content": ex["user"]},
        {"role": "assistant", "content": ex["assistant"]},
    ]
    return tokenizer.apply_chat_template(messages, tokenize=False, add_generation_prompt=False)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--config", required=True)
    parser.add_argument("--data",   required=True)
    args = parser.parse_args()

    cfg = load_config(args.config)

    # ── Quantization config ────────────────────────────────────────────────────
    bnb_cfg = BitsAndBytesConfig(
        load_in_4bit=True,
        bnb_4bit_quant_type=cfg["quantization"]["bnb_4bit_quant_type"],
        bnb_4bit_compute_dtype=getattr(torch, cfg["quantization"]["bnb_4bit_compute_dtype"]),
        bnb_4bit_use_double_quant=cfg["quantization"]["bnb_4bit_use_double_quant"],
    )

    # ── Load model + tokenizer ─────────────────────────────────────────────────
    model_name = cfg["model"]["name_or_path"]
    print(f"Loading model: {model_name}")
    tokenizer = AutoTokenizer.from_pretrained(model_name, trust_remote_code=True)
    model     = AutoModelForCausalLM.from_pretrained(
        model_name,
        quantization_config=bnb_cfg,
        device_map="auto",
        trust_remote_code=True,
    )
    model = prepare_model_for_kbit_training(model)

    # ── LoRA ───────────────────────────────────────────────────────────────────
    lora_cfg = LoraConfig(
        r=cfg["lora"]["r"],
        lora_alpha=cfg["lora"]["lora_alpha"],
        lora_dropout=cfg["lora"]["lora_dropout"],
        bias=cfg["lora"]["bias"],
        task_type=cfg["lora"]["task_type"],
        target_modules=cfg["lora"]["target_modules"],
    )
    model = get_peft_model(model, lora_cfg)
    model.print_trainable_parameters()

    # ── Dataset ────────────────────────────────────────────────────────────────
    raw_dataset = load_dataset(args.data)
    val_size    = int(len(raw_dataset) * cfg["data"]["val_split_ratio"])
    split       = raw_dataset.train_test_split(test_size=val_size, seed=cfg["training"]["seed"])

    def tokenize(batch):
        texts = [format_example(ex, tokenizer) for ex in zip(
            batch["system"], batch["user"], batch["assistant"],
        )]
        # ponytail: this zip is wrong if fields aren't parallel — fix when dataset shape confirmed
        return tokenizer(texts, truncation=True, max_length=cfg["data"]["max_seq_length"])

    train_data = split["train"].map(lambda ex: {"text": format_example(ex, tokenizer)})
    eval_data  = split["test"].map(lambda ex:  {"text": format_example(ex, tokenizer)})

    # ── Training args ──────────────────────────────────────────────────────────
    t = cfg["training"]
    training_args = TrainingArguments(
        output_dir=t["output_dir"],
        num_train_epochs=t["num_train_epochs"],
        per_device_train_batch_size=t["per_device_train_batch_size"],
        gradient_accumulation_steps=t["gradient_accumulation_steps"],
        learning_rate=t["learning_rate"],
        lr_scheduler_type=t["lr_scheduler_type"],
        warmup_ratio=t["warmup_ratio"],
        weight_decay=t["weight_decay"],
        max_grad_norm=t["max_grad_norm"],
        bf16=t["bf16"],
        fp16=t["fp16"],
        logging_steps=t["logging_steps"],
        save_steps=t["save_steps"],
        save_total_limit=t["save_total_limit"],
        eval_strategy=t["eval_strategy"],
        eval_steps=t["eval_steps"],
        seed=t["seed"],
        report_to="none",
    )

    trainer = SFTTrainer(
        model=model,
        tokenizer=tokenizer,
        train_dataset=train_data,
        eval_dataset=eval_data,
        dataset_text_field="text",
        max_seq_length=cfg["data"]["max_seq_length"],
        args=training_args,
    )

    print("Starting training...")
    trainer.train()
    trainer.save_model(t["output_dir"])
    print(f"Adapter saved to: {t['output_dir']}")


if __name__ == "__main__":
    main()
