#!/usr/bin/env python3
"""
prepare_dataset.py — Converts calibration results and curated examples
to JSONL training format for Vyrix Beta-2 QLoRA fine-tuning.

Usage:
    python training/scripts/prepare_dataset.py \
        --calibration-dir electron/ai/calibration/results \
        --examples-dir training/data/examples \
        --output training/data/train.jsonl

Output: JSONL file, one example per line:
    {"system": "...", "user": "...", "assistant": "..."}
"""

import argparse
import json
import os
import random
import sys
from pathlib import Path


def load_calibration_results(calibration_dir: str) -> list[dict]:
    """
    Load passing calibration test cases from phase result JSON files.
    Only includes cases that PASSED (correct model outputs become training examples).
    """
    examples = []
    cal_path = Path(calibration_dir)
    if not cal_path.exists():
        print(f"Warning: calibration dir not found: {calibration_dir}", file=sys.stderr)
        return examples

    # Phase files that contain Beta-2 task types
    beta2_phases = ["12-", "13-", "14-", "15-", "16-"]

    for json_file in sorted(cal_path.glob("*.json")):
        if json_file.name == "summary.json":
            continue
        if not any(json_file.name.startswith(p) for p in beta2_phases):
            continue

        try:
            data = json.loads(json_file.read_text())
            cases = data.get("cases", [])
            for case in cases:
                if case.get("passed") and case.get("parsed"):
                    # Reconstruct prompt from raw (ponytail: approximate — full prompt not stored)
                    raw = case.get("raw", "")
                    if raw and case.get("parsed"):
                        examples.append({
                            "source":    json_file.stem,
                            "name":      case.get("name", ""),
                            "assistant": json.dumps(case["parsed"], separators=(",", ":")),
                            "raw_user":  raw,
                        })
        except (json.JSONDecodeError, KeyError):
            continue

    return examples


def load_curated_examples(examples_dir: str) -> list[dict]:
    """Load manually curated examples from JSONL files in examples_dir."""
    examples = []
    ex_path = Path(examples_dir)
    if not ex_path.exists():
        return examples

    for jsonl_file in sorted(ex_path.glob("*.jsonl")):
        for line in jsonl_file.read_text().splitlines():
            line = line.strip()
            if line:
                try:
                    examples.append(json.loads(line))
                except json.JSONDecodeError:
                    continue

    return examples


def validate_example(ex: dict) -> bool:
    """Check that required fields are present and assistant is valid JSON."""
    if not all(k in ex for k in ("system", "user", "assistant")):
        return False
    try:
        json.loads(ex["assistant"])
        return True
    except json.JSONDecodeError:
        return False


def main():
    parser = argparse.ArgumentParser(description="Prepare Vyrix Beta-2 training dataset")
    parser.add_argument("--calibration-dir", default="electron/ai/calibration/results")
    parser.add_argument("--examples-dir",    default="training/data/examples")
    parser.add_argument("--output",          default="training/data/train.jsonl")
    parser.add_argument("--shuffle",         action="store_true", default=True)
    parser.add_argument("--seed",            type=int, default=42)
    args = parser.parse_args()

    print(f"Loading calibration results from: {args.calibration_dir}")
    cal_examples = load_calibration_results(args.calibration_dir)
    print(f"  Found {len(cal_examples)} passing calibration cases")

    print(f"Loading curated examples from: {args.examples_dir}")
    curated = load_curated_examples(args.examples_dir)
    print(f"  Found {len(curated)} curated examples")

    # Only curated examples have full system+user+assistant — calibration has partial data
    valid = [ex for ex in curated if validate_example(ex)]
    invalid = len(curated) - len(valid)
    if invalid > 0:
        print(f"  Warning: {invalid} curated examples failed validation — skipped", file=sys.stderr)

    if args.shuffle:
        random.seed(args.seed)
        random.shuffle(valid)

    output_path = Path(args.output)
    output_path.parent.mkdir(parents=True, exist_ok=True)
    with output_path.open("w") as f:
        for ex in valid:
            f.write(json.dumps(ex, ensure_ascii=False) + "\n")

    print(f"\nWrote {len(valid)} training examples to: {args.output}")
    if len(valid) < 100:
        print("Warning: fewer than 100 examples. Add more curated examples before training.", file=sys.stderr)


if __name__ == "__main__":
    main()
