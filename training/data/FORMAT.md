# Training Data Format Specification

## Format: JSONL (one JSON object per line)

Each line is a training example with `system`, `user`, and `assistant` fields.

```json
{"system": "<system prompt>", "user": "<user message>", "assistant": "<expected JSON output>"}
```

## Rules

1. `assistant` must be valid JSON matching the task's schema exactly.
2. `system` must match the production system prompt from `electron/ai/prompt/templates/`.
3. `user` must match the production user prompt format.
4. No partial or malformed JSON in `assistant`.
5. All fields labelled `"type": "assumption"` must be genuine inferences, not fabricated facts.

## Example: mission-classification

```json
{
  "system": "You are Vyrix, an expert mission analyst...",
  "user": "Classify this mission.\nUser: \"I want to build a food delivery app for university students...\"",
  "assistant": "{\"mission_type\":\"project\",\"confidence\":88,\"reasoning\":\"User described a problem with constraints and a deliverable.\",\"understood_problem\":\"Build a campus food delivery app.\",\"detected_goals\":[\"Faster food access\"],\"detected_outcomes\":[\"Mobile app prototype\"],\"constraints\":[\"3 months\"],\"resources\":[\"2 developers\"]}"
}
```

## Example: progress-evaluation

```json
{
  "system": "You are Vyrix, an expert project reviewer...",
  "user": "Evaluate the user's progress on project step 1.\nStep: Problem Clarification\n...",
  "assistant": "{\"step\":1,\"step_title\":\"Problem Clarification\",\"is_complete\":true,\"score\":78,\"feedback\":\"Clear problem with identified users.\",\"suggestions\":[],\"ready_to_advance\":true}"
}
```

## Mentor behavior (Main AI chat) — free-text task

`mentor-behavior.seed.jsonl` teaches the Main AI mentor *behavior* (challenge weak
claims, completion assessment against criteria, justified disagreement, testing
questions). Unlike the tasks above, `assistant` is free text, not schema JSON.

Rules specific to this set:
1. Project facts appear ONLY in the `[PROJECT CONTEXT]` block of the `system`
   field — synthetic per-example, mirroring what ContextBuilder produces at
   inference time. Never bake facts into the behavior itself.
2. Include examples where the AI *agrees* when evidence supports the claim, so
   the model does not learn to disagree unconditionally.
3. Minimum before fine-tuning: 300 examples (seed file is the style reference).

## Generating training data

Run `python training/scripts/prepare_dataset.py` to convert calibration results and manually curated examples into this format.

Minimum dataset sizes per task type before fine-tuning:
- mission-classification: 200 examples
- desirability-evaluation: 150 examples
- dvf-evaluation: 150 examples
- progress-evaluation: 300 examples
- decision: 100 examples
