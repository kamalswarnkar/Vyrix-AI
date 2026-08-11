# Beta-2 AI v2 Compatibility & Gap Report

**Date:** 2026-08-08  
**Audit scope:** `electron/ai/` (all modules), `electron/ai/types/`, `electron/ai/schemas/`, `electron/ai/grammars/`  
**Auditor:** Static analysis — no live inference

---

## 1. Already Implemented (reuse as-is)

| Module | File | Notes |
|---|---|---|
| ModelRouter | `core/ModelRouter.ts` | sidecar + Ollama fallback, health check |
| OllamaAdapter | `core/OllamaAdapter.ts` | `num_ctx:8192`, stream + complete |
| LlamaSidecar | `core/LlamaSidecar.ts` | GBNF grammar enforcement on :8765 |
| HardwareDetector | `core/HardwareDetector.ts` | RAM / VRAM detection |
| PromptEngine | `prompt/PromptEngine.ts` | routes by taskType, runs SchemaValidator |
| PromptCompiler | `prompt/PromptCompiler.ts` | system+user assembly |
| GrammarRegistry | `prompt/GrammarRegistry.ts` | loads .gbnf by taskType |
| SchemaValidator | `validation/SchemaValidator.ts` | AJV, parseAndValidate |
| MemoryEngine | `memory/MemoryEngine.ts` | LRU + keyword index |
| MemoryDistillation | `memory/MemoryDistillation.ts` | single-delta design |
| KeywordRepository | `memory/KeywordRepository.ts` | |
| ContextBuilder | `context/ContextBuilder.ts` | assembles context block |
| ContextInjector | `context/ContextInjector.ts` | resolves project for chat message |
| ConversationStateManager | `conversation/ConversationStateManager.ts` | |
| MessageStore | `conversation/MessageStore.ts` | |
| AdaptiveInterviewEngine | `interview/AdaptiveInterviewEngine.ts` | 6-step interview, evaluation gating |
| AiPlanningEngine | `planning/AiPlanningEngine.ts` | generate + refine |
| AiEvaluationFramework | `evaluation/AiEvaluationFramework.ts` | step/roadmap evaluation |
| FileExtractor | `multimodal/FileExtractor.ts` | PDF/DOCX/image extraction |
| VisionProcessor | `multimodal/VisionProcessor.ts` | Ollama-native vision message builder |
| ProjectStateManager | `project/ProjectStateManager.ts` | CRUD, scaffold, completeInterview |
| AiContainer | `ipc/AiContainer.ts` | full DI wiring, 20+ modules |
| AiIpcHandlers | `ipc/AiIpcHandlers.ts` | 8 channels registered |
| Calibration phases 01–11 | `calibration/phases/` | 94% pass (61/65) |
| MockPromptEngine | `__tests__/mocks/MockPromptEngine.ts` | per-taskType canned responses |
| MockModelRouter | `__tests__/mocks/MockModelRouter.ts` | queued string responses |

**Schemas (7):** context-resolve, evaluation-result, generative-ui, interview-plan, interview-step, keyword-extraction, memory-delta  
**Grammars (7):** same set as schemas  
**IPC channels (8):** ai:stream-message, ai:get-context, ai:start-interview, ai:interview-step, ai:generate-plan, ai:get-memory, ai:clear-memory, ai:extract-file

---

## 2. Partially Implemented (extend, do not replace)

| What | Gap | Fix |
|---|---|---|
| `AiEvaluationFramework` | Only handles evaluation-result taskType; no mission/DVF/progress evaluators | Add compositor methods; keep existing 3 methods untouched |
| `AiPlanningEngine.refine()` | Overwrites roadmap, no version history | Add `roadmap_versions[]` field + version before overwrite |
| `ProjectMeta` (types.ts) | Missing 15+ Beta-2 fields (mission_type, classification, dvf_evaluations, ideation_state, etc.) | Extend interface — additive only, no removals |
| `AiContainer` | Missing Beta-2 modules in DI wiring | Add new constructor params + wire new classes |
| `AiIpcHandlers` | 8 channels; Beta-2 needs ~12 more | Register new channels without touching existing |
| `MockPromptEngine` | No responses for Beta-2 taskTypes | Add `onTaskType` entries for new types |
| `ContextInjector` | Does not inject Beta-2 fields (mission_type, dvf, current_step) | Extend `build()` to include Beta-2 fields from ProjectMeta |
| `prompt/templates/evaluation.ts` | `stepCompletionEvalPrompt` has no scoring rubric → phase-08 partial-step scores 0 | Add explicit rubric (PHASE B — immediate fix) |

---

## 3. Missing (must create)

### New types
- `electron/ai/types/beta2-types.ts` — `MissionWorkflowState` enum, `MissionClassification`, `ProjectGoal`, `EndGoal`, `DesirabilityResult`, `DVFResult`, `IdeationState`, `ProgressEvaluation`, `DecisionResult`, `RoadmapVersion`

### New schemas + grammars
- `schemas/mission-classification.schema.json` + `.gbnf`
- `schemas/desirability-evaluation.schema.json` + `.gbnf`
- `schemas/dvf-evaluation.schema.json` + `.gbnf`
- `schemas/progress-evaluation.schema.json` + `.gbnf`
- `schemas/decision.schema.json` + `.gbnf`

### New modules
- `mission/MissionClassifier.ts` — classify subject vs project from user message
- `mission/MissionWorkflowEngine.ts` — state machine: NEW_MISSION → ... → COMPLETED
- `evaluation/ProgressEvaluator.ts` — evaluate user work uploads against step goals
- `evaluation/DesirabilityEvaluator.ts` — initial desirability-only evaluation
- `evaluation/DVFEvaluator.ts` — full Desirability + Viability + Feasibility
- `evaluation/DecisionEngine.ts` — CONTINUE / IMPROVE / REDESIGN classification
- `planning/RoadmapVersioning.ts` — version-safe refine wrapper

### New prompt templates
- `prompt/templates/mission.ts` — classificationPrompt, confirmationPrompt, goalCapturePrompt, endGoalPrompt
- `prompt/templates/desirability.ts` — desirabilityEvalPrompt
- `prompt/templates/dvf.ts` — dvfEvalPrompt
- `prompt/templates/progress.ts` — progressEvalPrompt
- `prompt/templates/decision.ts` — decisionPrompt

### New IPC channels (~12)
- `ai:classify-mission`, `ai:confirm-classification`, `ai:capture-goal`, `ai:capture-end-goal`
- `ai:evaluate-desirability`, `ai:generate-ideation-roadmap`, `ai:refine-roadmap`
- `ai:validate-progress`, `ai:start-ideation`, `ai:evaluate-dvf`
- `ai:record-decision`, `ai:generate-final-roadmap`

### New calibration phases
- Phase 12: mission-classification accuracy
- Phase 13: desirability evaluation
- Phase 14: DVF evaluation
- Phase 15: progress evaluation
- Phase 16: decision classification
- Phase 17: state machine transitions
- Phase 18: end-to-end Beta-2 workflow

### Training infrastructure (QLoRA prep — no execution)
- `training/README.md` — instructions for future teammate
- `training/scripts/prepare_dataset.py`
- `training/scripts/train_qlora.py`
- `training/scripts/merge_adapter.py`
- `training/configs/qlora_config.yaml`
- `training/data/` — placeholder with format spec

---

## 4. Model-dependent (requires live inference to validate)

- All prompt template outputs (quality, tone, helpfulness)
- Calibration phases 12–18 pass rates
- DVF evaluation confidence accuracy
- Mission classification edge cases (ambiguous input)
- Desirability evaluation reasoning quality
- Progress evaluation judgment on real uploads

---

## 5. Hardware-dependent (cannot execute on 8GB RAM)

- QLoRA fine-tuning execution (requires 24GB+ VRAM)
- Any model training or adapter merging
- GBNF grammar enforcement (requires llama.cpp sidecar; phase-03 always 0% without it)
- Phase-09 vision with real screenshots (sidecar preferred for accuracy)

---

## 6. Safe to implement now (deterministic, no live inference needed)

All of the following can be built, tested, and committed today:

1. **PHASE B** — Scoring rubric in `stepCompletionEvalPrompt` (fixes phase-08 immediately)
2. **Beta-2 types** — `beta2-types.ts` interface extensions (pure TypeScript)
3. **ProjectMeta extensions** — additive fields in `project/types.ts`
4. **MissionWorkflowState enum** — state machine types, transition guard
5. **All new schemas + grammars** — JSON schema + GBNF (no model needed)
6. **MissionClassifier** — class + prompt template + schema; testable via MockPromptEngine
7. **MissionWorkflowEngine** — state machine; fully testable without model
8. **ProgressEvaluator, DesirabilityEvaluator, DVFEvaluator, DecisionEngine** — all delegate to PromptEngine; testable via mock
9. **RoadmapVersioning** — pure logic, no model
10. **ContextInjector extension** — additive Beta-2 fields
11. **IPC channel registration** — extend AiIpcHandlers + AiContainer
12. **MockPromptEngine extension** — new taskType canned responses
13. **Deterministic unit tests** — structural + mock tests
14. **Calibration phase stubs** — phases 12–18 scaffolded (will require live model for meaningful pass rates)
15. **QLoRA training scaffold** — scripts + configs (no execution)
16. **README + PRODUCTION-READINESS update**

---

## Implementation order

```
B → C → D → E/F → G → H → I → J → K → L → M → N → O → P → Q → R → S → V → W → X → Y
```

Start: PHASE B (fix phase-08 scoring rubric — zero risk, immediate calibration improvement)
