#!/usr/bin/env python3
"""
merge_adapter.py — Merges a QLoRA LoRA adapter into the base model.
The merged model can then be converted to GGUF for llama.cpp.

Usage:
    python training/scripts/merge_adapter.py \
        --adapter outputs/qlora_adapter \
        --base Qwen/Qwen2.5-VL-7B-Instruct \
        --output outputs/vyrix-qwen2.5-vl-7b-v1
"""

import argparse
import sys

try:
    import torch
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from peft import PeftModel
except ImportError as e:
    print(f"Missing dependency: {e}")
    sys.exit(1)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("--adapter", required=True, help="Path to LoRA adapter directory")
    parser.add_argument("--base",    required=True, help="Base model name or path")
    parser.add_argument("--output",  required=True, help="Output directory for merged model")
    args = parser.parse_args()

    print(f"Loading base model: {args.base}")
    tokenizer = AutoTokenizer.from_pretrained(args.base, trust_remote_code=True)
    base_model = AutoModelForCausalLM.from_pretrained(
        args.base,
        torch_dtype=torch.float16,
        device_map="cpu",  # merge on CPU to avoid VRAM limit
        trust_remote_code=True,
    )

    print(f"Loading adapter: {args.adapter}")
    model = PeftModel.from_pretrained(base_model, args.adapter)

    print("Merging adapter into base model...")
    model = model.merge_and_unload()

    print(f"Saving merged model to: {args.output}")
    model.save_pretrained(args.output, safe_serialization=True)
    tokenizer.save_pretrained(args.output)

    print("Done. Next step: convert to GGUF with llama.cpp/convert.py")
    print(f"  python llama.cpp/convert.py {args.output} --outtype q4_K_M --outfile models/vyrix-v1.gguf")


if __name__ == "__main__":
    main()
