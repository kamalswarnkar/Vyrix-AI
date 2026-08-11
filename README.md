# Vyrix Beta-2

> **Local-first AI research and project intelligence desktop application.**
> Built for students and designers who need powerful AI assistance without cloud dependencies, subscription costs, or data privacy trade-offs.

> 🔌 **Frontend team: start with [INTEGRATION.md](INTEGRATION.md).** It is the self-contained guide to wiring the renderer to this AI backend — all 21 IPC channels, the Main AI / POP AI modes, streaming with `requestId`, image input, security constraints, and the typed contract at `electron/ai/ipc/renderer-contract.d.ts`. This README describes the whole system; INTEGRATION.md is everything you need to integrate.

---

## Table of Contents

1. [What is Vyrix?](#1-what-is-vyrix)
2. [Core Philosophy](#2-core-philosophy)
3. [Architecture Overview](#3-architecture-overview)
4. [Tech Stack](#4-tech-stack)
5. [Implementation Status](#5-implementation-status)
6. [Project Structure](#6-project-structure)
7. [AI Subsystem — Module Reference](#7-ai-subsystem--module-reference)
8. [IPC Contract Reference](#8-ipc-contract-reference)
9. [Design System](#9-design-system)
10. [Data Storage Model](#10-data-storage-model)
11. [Memory & Context System](#11-memory--context-system)
12. [Adaptive Interview Engine](#12-adaptive-interview-engine)
13. [Development Setup](#13-development-setup)
13a. [Ollama Setup Guide](#13a-ollama-setup-guide)
13b. [Calibration Status](#13b-calibration-status)
13c. [Docker Environment](#13c-docker-environment)
14. [What Still Needs To Be Done](#14-what-still-needs-to-be-done)
14a. [Beta-2 Product Workflow](#14a-beta-2-product-workflow)
15. [Coding Standards](#15-coding-standards)
16. [Contributing](#16-contributing)
17. [Memory & Performance Profile](#17-memory--performance-profile)
18. [Glossary](#18-glossary)

---

## 1. What is Vyrix?

Vyrix Beta-2 is a desktop application that functions as an intelligent project companion for university students, independent researchers, and designers. It combines project management, research organisation, and a local AI assistant into a single, fully offline application.

**Core capabilities:**

- **Missions** — Structured projects that guide users through a complete design/research lifecycle from problem definition to final deliverable. Beta-2 automatically classifies new missions as a **Project** (open-ended, solution must be discovered) or a **Subject/Module** (predefined curriculum, known outcomes) and routes each through a dedicated workflow.
- **Beta-2 Project Workflow** — Mission classification → desirability evaluation → roadmap to ideation → progress validation → DVF (Desirability/Viability/Feasibility) evaluation → decision engine (CONTINUE / IMPROVE / REDESIGN) → final roadmap → execution.
- **Flows** — Research phases within a mission (e.g., Primary Research, Wireframes, Prototyping), each with its own AI memory.
- **Vyrix AI** — A locally-running large language model that knows your project context, remembers decisions, and speaks the language of design research.
- **In-App Browser** — An embedded Chromium browser for research without leaving the app.
- **Notes** — Persistent workspace notes linked to missions.
- **Multimodal Vision** — AI analysis of uploaded images, 3D model screenshots, and design tool captures.

**What makes Vyrix different:**

- Zero cloud AI costs. All inference runs on your hardware via llama.cpp.
- Zero data upload. Your documents, notes, and conversations never leave your device.
- Zero subscription fees for core functionality. The AI is a one-time model download.
- Designed for 16 GB RAM laptops. Total system RAM footprint is under 6.3 GB.

---

## 2. Core Philosophy

### 100% Local Execution

No cloud APIs for AI inference. No remote database for project data. Vyrix treats privacy as a default, not a premium feature.

### Zero-Overhead State Management

There are no databases — no SQL, no NoSQL, no vector stores. All project state is managed through plain text files and JSON on the local file system. A project is just a folder: portable, transparent, sync-friendly, and resilient.

### Strict Process Separation

The React renderer knows nothing about AI, file I/O, or system state. The Electron main process knows nothing about rendering. The llama.cpp sidecar knows nothing about either. Each layer has one job.

### Design for Real Hardware

Every performance decision is validated against a 16 GB RAM laptop running the full application alongside heavy creative tools like Figma or the Adobe suite.

---

## 3. Architecture Overview

```
┌──────────────────────────────────────────────────────────────────┐
│  ELECTRON RENDERER PROCESS                                        │
│  Next.js 15 App Router · React 19 · TypeScript                   │
│                                                                  │
│  src/app/(app)/           — Authenticated app routes             │
│  src/app/(auth)/          — Login / signup / onboarding          │
│  src/components/app/      — Sidebar, Mission, Folder pages       │
│  src/lib/ipc.ts           — Typed IPC bridge (window.vyrix)      │
│  src/lib/streamAi.ts      — Streaming AI helper                  │
│                                                                  │
│  RULE: Only calls ipc.* and renders results.                     │
│         No AI logic. No file I/O. No Node.js APIs.               │
└──────────────────┬───────────────────────────────────────────────┘
                   │
         window.vyrix  (Electron contextBridge)
         Typed by: src/lib/electron.d.ts
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│  ELECTRON MAIN PROCESS                                            │
│  Node.js · IPC handlers · File system · Process management       │
│                                                                  │
│  electron/ai/             — AI subsystem (30 modules) ✅ BUILT   │
│    └── ipc/AiContainer.ts — Dependency injection root            │
│    └── ipc/AiIpcHandlers  — IPC channel registrations (21)       │
│  electron/ipc/            — General IPC handlers (TBD)           │
│  electron/windows/        — Window lifecycle (TBD)               │
│  electron/preload.js      — contextBridge (TBD)                  │
│                                                                  │
│  RULE: Orchestrates everything. Never renders UI.                │
└──────────────────┬───────────────────────────────────────────────┘
                   │
         child_process (stdin/stdout + HTTP :8765)
                   │
┌──────────────────▼───────────────────────────────────────────────┐
│  llama.cpp SIDECAR                                                │
│  Qwen2.5-VL 7B · Q4_K_M GGUF · 8192 ctx · GBNF constraints      │
│  Fallback: Ollama HTTP at localhost:11434 (dev/fallback)          │
│                                                                  │
│  RULE: Inference only. Knows nothing about the application.      │
└──────────────────────────────────────────────────────────────────┘
```

### Streaming Request Lifecycle

```
User types message → React component
  → handleSubmit()
  → ipc.ai.streamMessage(message, conversationId?, projectId?)   [renderer → main via IPC]
     → AiIpcHandlers: "ai:stream-message"
        → PromptEngine.stream()
           → ContextInjector.resolve()         → reads project list, infers context
           → ContextBuilder.build()            → reads keywords.json + global-memory.log
           → GrammarRegistry.get()             → loads GBNF file from disk
           → PromptCompiler.compile()          → assembles messages[] array
           → ModelRouter.stream()
              → LlamaSidecar OR OllamaAdapter  → HTTP /v1/chat/completions
     → sender.send("ai:stream:chunk", { chunk })    [main → renderer via IPC]
     → sender.send("ai:stream:done",  { full, latencyMs })
  → streamAi.ts: onChunk / onDone callbacks → React state update
  → [background] MemoryDistillation.distill()   [async, non-blocking, fire-and-forget]
```

---

## 4. Tech Stack

### Renderer (Frontend)

| Technology | Version | Role |
|---|---|---|
| Next.js | 15.x | App Router, SSR disabled (Electron), routing |
| React | 19.x | UI component layer |
| TypeScript | 5.x | Type safety across all layers |
| Tailwind CSS | 4.x | Utility-first styling |
| shadcn/ui | 4.x | Component primitives (via @base-ui/react) |
| Plus Jakarta Sans | Google Fonts | Body text, labels, inputs |
| Unbounded | Google Fonts | Brand headings |

### Main Process (AI Subsystem)

| Technology | Role |
|---|---|
| Electron | Desktop shell, IPC bus, window management |
| Node.js (≥20) | File I/O, process management, prompt construction |
| child_process | llama.cpp sidecar lifecycle |
| fs/promises | All storage operations (no database) |
| ajv 8.x | JSON Schema validation of AI responses |
| pdf-parse 1.x | PDF text extraction |
| mammoth 1.x | DOCX text extraction |
| sharp (optional) | Image resize before vision inference |

### AI Inference

| Technology | Role |
|---|---|
| llama.cpp | Primary local inference server (production) |
| Qwen2.5-VL 7B Q4_K_M | Multimodal model (text + image) |
| GBNF Grammars | Constrained JSON output from the model |
| Ollama | HTTP-based fallback / development mode |

### Infrastructure

| Service | Cost | Purpose |
|---|---|---|
| DigitalOcean Droplet | $12–24/mo | Landing page, waitlist, API relay |
| DigitalOcean Spaces | $5/mo | Installer hosting (.exe / .dmg) |
| Clerk (Free Tier) | $0 | Authentication (PKCE + loopback OAuth) |

---

## 5. Implementation Status

### Summary

| Layer | Status | Notes |
|---|---|---|
| Renderer (Next.js UI) | ✅ Complete | Reference repo — do not modify |
| IPC Bridge (`electron.d.ts`, `ipc.ts`) | ✅ Complete | Immutable contract |
| AI Subsystem v1 (`electron/ai/`) | ✅ Complete | 27 modules — calibrated (96 % — 78/81 passing across 16 phases; 100 % excl. sidecar) |
| AI Subsystem v2 — Beta-2 Product Workflow | ✅ Complete | 7 new modules, 5 new schemas, 5 new grammars, 5 new prompt templates, 13 new IPC channels |
| Electron main process shell | ⬜ Not started | `electron/main.js`, `preload.js` |
| Electron IPC wiring (non-AI) | ⬜ Not started | Projects, folders, auth handlers |
| Model download / setup tooling | ⬜ Not started | GGUF download, first-run wizard |
| Electron app packaging | ⬜ Not started | `electron-builder` config |
| CI pipeline | ⬜ Not started | GitHub Actions, test runner |

### AI Module Status

All 30 modules in `electron/ai/` are **fully implemented**.

#### v1 — Core AI Infrastructure (27 modules)

| ID | Module | Path | Status | Tests |
|---|---|---|---|---|
| M00 | Schemas & Grammars (v1) | `schemas/*.json`, `grammars/*.gbnf` (7 each) | ✅ Done | — |
| M00 | TypeScript Interfaces | `types/ai-schemas.d.ts` | ✅ Done | — |
| M01 | ProjectStateManager | `project/ProjectStateManager.ts` | ✅ Done | ✅ |
| M02 | MessageStore | `conversation/MessageStore.ts` | ✅ Done | ✅ |
| M03 | MemoryEngine | `memory/MemoryEngine.ts` | ✅ Done | ✅ |
| M04 | KeywordRepository | `memory/KeywordRepository.ts` | ✅ Done | ✅ |
| M05 | LlamaSidecar | `core/LlamaSidecar.ts` | ✅ Done | ✅ |
| M06 | OllamaAdapter | `core/OllamaAdapter.ts` | ✅ Done | ✅ |
| M07 | LruOptimizer | `context/LruOptimizer.ts` | ✅ Done | ✅ |
| M08 | ContextBuilder | `context/ContextBuilder.ts` | ✅ Done | ✅ |
| M09 | ModelRouter | `core/ModelRouter.ts` | ✅ Done | ✅ |
| M10 | PromptTemplates | `prompt/PromptTemplates.ts` + `templates/` | ✅ Done | — |
| M11 | GrammarRegistry | `prompt/GrammarRegistry.ts` | ✅ Done | ✅ |
| M12 | PromptCompiler | `prompt/PromptCompiler.ts` | ✅ Done | — |
| M13 | PromptEngine | `prompt/PromptEngine.ts` | ✅ Done | — |
| M14 | ConversationStateManager | `conversation/ConversationStateManager.ts` | ✅ Done | ✅ |
| M15 | MemoryDistillation | `memory/MemoryDistillation.ts` | ✅ Done | — |
| M16 | ContextInjector | `context/ContextInjector.ts` | ✅ Done | — |
| M17 | AdaptiveInterviewEngine | `interview/AdaptiveInterviewEngine.ts` | ✅ Done | — |
| M18 | AiPlanningEngine | `planning/AiPlanningEngine.ts` | ✅ Done | — |
| M19 | AiEvaluationFramework | `evaluation/AiEvaluationFramework.ts` | ✅ Done | — |
| M20 | FileExtractor | `multimodal/FileExtractor.ts` | ✅ Done | ✅ |
| M21 | VisionProcessor | `multimodal/VisionProcessor.ts` | ✅ Done | — |
| M22 | Testing Framework | `__tests__/` | ✅ Done | — |
| — | SchemaValidator | `validation/SchemaValidator.ts` | ✅ Done | — |
| — | AiContainer (DI root) | `ipc/AiContainer.ts` | ✅ Done | — |
| — | AiIpcHandlers | `ipc/AiIpcHandlers.ts` | ✅ Done | — |

#### v2 — Beta-2 Product Workflow (7 new modules)

| ID | Module | Path | Status | Tests |
|---|---|---|---|---|
| M23 | MissionClassifier | `mission/MissionClassifier.ts` | ✅ Done | ✅ |
| M24 | MissionWorkflowEngine | `mission/MissionWorkflowEngine.ts` | ✅ Done | ✅ |
| M25 | DesirabilityEvaluator | `evaluation/DesirabilityEvaluator.ts` | ✅ Done | — |
| M26 | DVFEvaluator | `evaluation/DVFEvaluator.ts` | ✅ Done | ✅ |
| M27 | ProgressEvaluator | `evaluation/ProgressEvaluator.ts` | ✅ Done | ✅ |
| M28 | DecisionEngine | `evaluation/DecisionEngine.ts` | ✅ Done | — |
| M29 | RoadmapVersioning | `planning/RoadmapVersioning.ts` | ✅ Done | — |
| M00+ | Schemas & Grammars (v2) | `schemas/*.json`, `grammars/*.gbnf` (5 each) | ✅ Done | — |
| M00+ | Prompt Templates (v2) | `prompt/templates/` (5 new files) | ✅ Done | — |
| M00+ | Mock Responses | `__tests__/mocks/MockBeta2Responses.ts` | ✅ Done | — |

**Integration tests (requiring a live model) are skipped by default — enable with `ENABLE_INTEGRATION_TESTS=1`.**

---

## 6. Project Structure

```
Vyrix-AI/
├── src/                                   # Renderer process (Next.js — reference repo)
│   ├── app/
│   │   ├── (app)/                         # Authenticated app shell
│   │   │   ├── layout.tsx                 # App layout with Sidebar
│   │   │   ├── ai/page.tsx                # AI chat page (streaming, attachments)
│   │   │   ├── mission/[id]/page.tsx      # Mission detail page
│   │   │   └── ...                        # browser, home, notes, settings, etc.
│   │   ├── (auth)/                        # Login / signup / onboarding
│   │   └── api/ai/chat/route.ts           # Ollama proxy (non-Electron fallback only)
│   │
│   ├── components/
│   │   ├── app/
│   │   │   ├── Sidebar.tsx                # Primary navigation
│   │   │   └── MissionPage.tsx            # Mission detail + flows + AI chat
│   │   └── ui/                            # Design system primitives
│   │
│   └── lib/
│       ├── ipc.ts                         # ⚡ Typed IPC bridge — all renderer→main calls
│       ├── electron.d.ts                  # 🔒 IMMUTABLE: window.vyrix type contract
│       └── streamAi.ts                    # Streaming AI helper (IPC event listener)
│
├── electron/                              # Main process
│   ├── main.js                            # ⬜ TO BUILD: App entry, window creation
│   ├── preload.js                         # ⬜ TO BUILD: contextBridge (window.vyrix)
│   ├── ipc/                               # ⬜ TO BUILD: Non-AI IPC handlers
│   └── ai/                               # ✅ COMPLETE: AI subsystem (30 modules)
│       │
│       ├── package.json                   # AI subsystem dependencies
│       ├── jest.config.ts                 # Test runner configuration
│       │
│       ├── schemas/                       # JSON Schema definitions (12 files)
│       │   ├── interview-step.schema.json        # v1
│       │   ├── interview-plan.schema.json        # v1
│       │   ├── memory-delta.schema.json          # v1
│       │   ├── keyword-extraction.schema.json    # v1
│       │   ├── evaluation-result.schema.json     # v1
│       │   ├── context-resolve.schema.json       # v1
│       │   ├── generative-ui.schema.json         # v1
│       │   ├── mission-classification.schema.json  # v2 Beta-2
│       │   ├── desirability-evaluation.schema.json # v2 Beta-2
│       │   ├── dvf-evaluation.schema.json          # v2 Beta-2
│       │   ├── progress-evaluation.schema.json     # v2 Beta-2
│       │   └── decision.schema.json                # v2 Beta-2
│       │
│       ├── grammars/                      # GBNF grammar files (12 files, mirrors schemas)
│       │   ├── interview-step.gbnf               # v1
│       │   ├── interview-plan.gbnf               # v1
│       │   ├── memory-delta.gbnf                 # v1
│       │   ├── keyword-extraction.gbnf           # v1
│       │   ├── evaluation-result.gbnf            # v1
│       │   ├── context-resolve.gbnf              # v1
│       │   ├── generative-ui.gbnf                # v1
│       │   ├── mission-classification.gbnf       # v2 Beta-2
│       │   ├── desirability-evaluation.gbnf      # v2 Beta-2
│       │   ├── dvf-evaluation.gbnf               # v2 Beta-2
│       │   ├── progress-evaluation.gbnf          # v2 Beta-2
│       │   └── decision.gbnf                     # v2 Beta-2
│       │
│       ├── types/
│       │   └── ai-schemas.d.ts            # TypeScript interfaces for all schema types
│       │
│       ├── core/                          # AI backend management
│       │   ├── types.ts
│       │   ├── HardwareDetector.ts        # RAM/CPU/GPU detection
│       │   ├── LlamaSidecar.ts            # M05: llama.cpp process manager
│       │   ├── OllamaAdapter.ts           # M06: Ollama HTTP client
│       │   └── ModelRouter.ts             # M09: Circuit-breaker + backend selection
│       │
│       ├── context/                       # Context assembly
│       │   ├── types.ts
│       │   ├── LruOptimizer.ts            # M07: Token budget + LRU keyword selection
│       │   ├── ContextBuilder.ts          # M08: Memory + keywords → context string
│       │   └── ContextInjector.ts         # M16: Project inference + context assembly
│       │
│       ├── memory/                        # Project memory
│       │   ├── types.ts
│       │   ├── MemoryEngine.ts            # M03: Append-only memory delta log
│       │   ├── KeywordRepository.ts       # M04: LRU keyword store (per flow)
│       │   └── MemoryDistillation.ts      # M15: Background keyword/decision extraction
│       │
│       ├── conversation/                  # Chat history
│       │   ├── types.ts
│       │   ├── MessageStore.ts            # M02: NDJSON append-only message log
│       │   └── ConversationStateManager.ts# M14: Conversation registry + lifecycle
│       │
│       ├── project/                       # Project metadata
│       │   ├── types.ts
│       │   └── ProjectStateManager.ts     # M01: project.json + settings.json CRUD
│       │
│       ├── prompt/                        # Prompt assembly
│       │   ├── types.ts
│       │   ├── PromptTemplates.ts         # M10: Namespace facade for all templates
│       │   ├── GrammarRegistry.ts         # M11: GBNF loader + cache
│       │   ├── PromptCompiler.ts          # M12: Assembles messages[] for inference
│       │   ├── PromptEngine.ts            # M13: Single-turn orchestrator
│       │   └── templates/                 # Template functions (10 modules)
│       │       ├── interview.ts           # v1
│       │       ├── chat.ts               # v1
│       │       ├── memory.ts             # v1
│       │       ├── planning.ts           # v1
│       │       ├── evaluation.ts         # v1 (scoring rubric fix applied)
│       │       ├── mission.ts            # v2 Beta-2
│       │       ├── desirability.ts       # v2 Beta-2
│       │       ├── dvf.ts                # v2 Beta-2
│       │       ├── progress.ts           # v2 Beta-2
│       │       └── decision.ts           # v2 Beta-2
│       │
│       ├── validation/
│       │   └── SchemaValidator.ts         # ajv-based JSON output validator
│       │
│       ├── interview/                     # Adaptive interview engine
│       │   ├── types.ts
│       │   └── AdaptiveInterviewEngine.ts # M17: 6-step state machine
│       │
│       ├── mission/                       # Beta-2: Mission workflow (new)
│       │   ├── MissionClassifier.ts       # M23: Project vs Subject classification
│       │   └── MissionWorkflowEngine.ts   # M24: 24-state workflow state machine
│       │
│       ├── planning/
│       │   ├── AiPlanningEngine.ts        # M18: Roadmap generation + refinement
│       │   └── RoadmapVersioning.ts       # M29: Versioned refine (fixes overwrite bug)
│       │
│       ├── evaluation/
│       │   ├── AiEvaluationFramework.ts   # M19: Quality gating + evaluation
│       │   ├── DesirabilityEvaluator.ts   # M25: Initial desirability scoring
│       │   ├── DVFEvaluator.ts            # M26: Desirability/Viability/Feasibility
│       │   ├── ProgressEvaluator.ts       # M27: Step progress validation
│       │   └── DecisionEngine.ts          # M28: CONTINUE/IMPROVE/REDESIGN decision
│       │
│       ├── multimodal/                    # File + image handling
│       │   ├── types.ts
│       │   ├── FileExtractor.ts           # M20: PDF/DOCX/text/image extraction
│       │   └── VisionProcessor.ts         # M21: Image → Ollama-native vision message builder
│       │
│       ├── ipc/                           # IPC integration layer
│       │   ├── AiContainer.ts             # DI composition root (all module instances)
│       │   ├── AiIpcHandlers.ts           # IPC channel registrations
│       │   └── index.ts                   # Public entry point
│       │
│       └── __tests__/                     # M22: Testing framework
│           ├── mocks/
│           │   ├── MockModelRouter.ts
│           │   ├── MockPromptEngine.ts
│           │   └── MockBeta2Responses.ts  # v2: canned responses for all 5 new task types
│           ├── fixtures/
│           │   └── schemas.ts             # Valid JSON fixtures for all schema types
│           ├── factories/
│           │   ├── project.factory.ts
│           │   └── conversation.factory.ts
│           └── stubs/
│               └── IpcStub.ts
│
├── training/                              # QLoRA fine-tuning scaffold (see §13c training service)
│   ├── Dockerfile                         # Python 3.11-slim image; CPU torch for prep+merge
│   ├── requirements.txt                   # torch, transformers, peft, trl, bitsandbytes, etc.
│   ├── configs/
│   │   └── qlora_config.yaml              # r=16, alpha=32, nf4 4-bit bfloat16, 3 epochs
│   ├── data/
│   │   └── FORMAT.md                      # JSONL training format spec + examples
│   └── scripts/
│       ├── prepare_dataset.py             # Converts calibration results → JSONL
│       ├── train_qlora.py                 # QLoRA fine-tuning (requires 24GB+ VRAM)
│       └── merge_adapter.py              # Merges LoRA adapter → base model for GGUF conversion
│
├── docker/                                # Containerised dev environment
│   ├── Dockerfile                         # Node.js 20-slim image; runs calibration + tests
│   ├── docker-compose.yml                 # 6-service compose (ollama, calibrate, test, dev, training, llama-server)
│   ├── .dockerignore                      # Excludes node_modules, model files, build output
│   └── pull-model.sh                      # Pulls Ollama model before calibration run
│
├── BETA2-GAP-REPORT.md                    # Beta-2 compatibility & gap analysis
├── AI-MODULE-ROADMAP.md                   # Per-module specifications (30 modules)
├── PRODUCTION-READINESS.md                # v1 + v2 readiness checklist, bugs fixed, action items
├── README.md                              # This file
└── package.json                           # Renderer dependencies
```

---

## 7. AI Subsystem — Module Reference

This section documents every implemented module's public API. Use this as the primary reference when integrating, testing, or extending any module.

---

### M01 — ProjectStateManager

**Path:** `electron/ai/project/ProjectStateManager.ts`
**Purpose:** Single source of truth for project metadata (`project.json`) and settings (`settings.json`).

```typescript
class ProjectStateManager {
  constructor(storageRoot: string)

  // Create a new project directory + project.json + settings.json
  async create(opts?: CreateProjectOptions): Promise<ProjectResult<ProjectMeta>>

  // Read project metadata
  async getMeta(projectId: string): Promise<ProjectResult<ProjectMeta>>

  // Read project settings
  async getSettings(projectId: string): Promise<ProjectResult<ProjectSettings>>

  // Patch project metadata (deep merge)
  async updateMeta(projectId: string, patch: Partial<ProjectMeta>): Promise<ProjectResult<ProjectMeta>>

  // Patch project settings
  async updateSettings(projectId: string, patch: Partial<ProjectSettings>): Promise<ProjectResult<ProjectSettings>>

  // Mark interview complete + write roadmap
  async completeInterview(projectId: string, roadmap: PlanStep[]): Promise<ProjectResult<ProjectMeta>>

  // Advance interview by one step (updates completed_steps[])
  async completeStep(projectId: string, stepNumber: number): Promise<ProjectResult<ProjectMeta>>

  // Check whether the interview has been completed
  async isInterviewComplete(projectId: string): Promise<boolean>

  // List all non-deleted projects
  async listAll(): Promise<ProjectMeta[]>

  // Soft-delete (sets deleted_at timestamp)
  async softDelete(projectId: string): Promise<ProjectResult<ProjectMeta>>

  // Restore a soft-deleted project
  async restore(projectId: string): Promise<ProjectResult<ProjectMeta>>

  // Returns array of validation error strings (empty = valid)
  async validate(projectId: string): Promise<string[]>

  // Returns the absolute path to a project's directory
  projectDir(projectId: string): string
}

// Return type — discriminated union
type ProjectResult<T> =
  | { ok: true;  data: T }
  | { ok: false; error: string }
```

---

### M02 — MessageStore

**Path:** `electron/ai/conversation/MessageStore.ts`
**Purpose:** Append-only NDJSON chat log with per-file mutex. Log rotation at 2 MB.

```typescript
class MessageStore {
  // Append one message to a log file
  async append(
    logPath: string,
    conversationId: string,
    role: "user" | "assistant" | "system",
    content: string,
    opts?: AppendMessageOptions,
  ): Promise<StoredMessage>

  // Read all messages from a log file (skips corrupted lines)
  async readAll(logPath: string): Promise<StoredMessage[]>

  // Read the last N turns (default: 20 messages = 10 turns)
  async readHistory(logPath: string, opts?: ReadHistoryOptions): Promise<StoredMessage[]>

  // Count messages in a log file
  async count(logPath: string): Promise<number>

  // Timestamp of the most recent message
  async lastMessageAt(logPath: string): Promise<string | null>

  // Truncate the log file (irreversible)
  async clear(logPath: string): Promise<void>
}
```

---

### M03 — MemoryEngine

**Path:** `electron/ai/memory/MemoryEngine.ts`
**Purpose:** Append-only delta log (`global-memory.log`) for long-term project facts.

```typescript
class MemoryEngine {
  constructor(projectDir: string)

  // Synchronous append — safe because fs.appendFileSync is atomic
  append(delta: MemoryDelta): MemoryDeltaRecord

  // Replay all deltas → current state (last-write-wins per key)
  async compileState(): Promise<MemoryState>

  // Replay deltas up to index N (for rollback / history)
  async compileStateAt(upToIndex: number): Promise<MemoryState>

  // Read the raw delta log
  async readAllDeltas(): Promise<MemoryDeltaRecord[]>

  // Statistics (count, file size, oldest/newest timestamps)
  async getStats(): Promise<MemoryEngineStats>

  // Approximate token count (4 chars ≈ 1 token)
  async estimateTokens(): Promise<number>

  // Format compiled state for system prompt injection
  // Output: "[PROJECT CONTEXT]\nKey: Value\n..."
  async formatAsContext(): Promise<string>

  // True if the log file exists and is non-empty
  async exists(): Promise<boolean>
}
```

---

### M04 — KeywordRepository

**Path:** `electron/ai/memory/KeywordRepository.ts`
**Purpose:** LRU keyword store. One `keywords.json` file per flow.

```typescript
class KeywordRepository {
  // Returns the path to a flow's keywords.json
  static keywordsPath(projectDir: string, flowId: string): string

  // Add a keyword (normalised to lowercase). Bumps timestamp if already present.
  async add(keywordsPath: string, keyword: string): Promise<KeywordAddResult>

  // Remove a keyword (idempotent — does not error if missing)
  async remove(keywordsPath: string, keyword: string): Promise<KeywordRemoveResult>

  // Read all keywords as a { keyword: ISO-timestamp } map
  async getAll(keywordsPath: string): Promise<GetKeywordsResult>

  // Read keywords sorted oldest-first (for LRU eviction decisions)
  async getSortedByAge(keywordsPath: string): Promise<Array<{ keyword: string; timestamp: string }>>

  // Update the last_referenced timestamp for a set of keywords to "now"
  async refreshTimestamps(keywordsPath: string, keywords: string[]): Promise<void>

  // Count keywords in the file
  async count(keywordsPath: string): Promise<number>

  // Check whether a keyword exists
  async has(keywordsPath: string, keyword: string): Promise<boolean>
}
```

---

### M05 — LlamaSidecar

**Path:** `electron/ai/core/LlamaSidecar.ts`
**Purpose:** Manages the `llama-server` child process. Extends `EventEmitter`.

```typescript
class LlamaSidecar extends EventEmitter {
  constructor(opts: LlamaSidecarOptions)
  // { binary, modelPath, flags, port? = 8765, startTimeout? = 60000 }

  // Spawn llama-server. Resolves when "llama server listening" is detected.
  async start(): Promise<void>

  // Gracefully terminate the sidecar process
  async stop(): Promise<void>

  // Non-streaming inference via POST /v1/chat/completions
  async complete(req: InferenceRequest): Promise<InferenceResponse>

  // Streaming inference. Calls callbacks as chunks arrive.
  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void>

  // Health check — calls GET /health on the sidecar HTTP port
  async health(): Promise<SidecarHealth>

  // True when the sidecar is running and has passed the ready check
  get isReady(): boolean

  // Events emitted:
  // "ready"          — sidecar started and model loaded
  // "error"          — unexpected crash or start failure
  // "circuit-open"   — 3 consecutive failures; circuit-breaker activated
  // "restarting"     — auto-restart initiated after crash
}
```

---

### M06 — OllamaAdapter

**Path:** `electron/ai/core/OllamaAdapter.ts`
**Purpose:** HTTP client for a locally-running Ollama server. Same interface as `LlamaSidecar`.

```typescript
class OllamaAdapter {
  constructor(opts?: { baseUrl?: string; model?: string })
  // defaults: baseUrl = "http://localhost:11434", model = "llama3.2"

  async complete(req: InferenceRequest): Promise<InferenceResponse>
  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void>
  async health(): Promise<OllamaHealth>
  // health() → { ok, installedModels: string[] }
}

class OllamaError extends Error {
  constructor(statusCode: number, message: string)
  get isModelNotFound(): boolean  // true when statusCode === 404
}
```

---

### M07 — LruOptimizer

**Path:** `electron/ai/context/LruOptimizer.ts`
**Purpose:** Token budget enforcement. Selects which keywords fit within the available context window.

```typescript
class LruOptimizer {
  // Select keywords that fit within budget (tokens). Newest-first priority.
  // Always includes at least 1 keyword regardless of budget.
  optimize(keywords: KeywordMap, budget: number): LruResult
  // LruResult → { included: string[], dropped: string[], usedTokens: number }

  // Token cost of one keyword (accounts for ", " separator)
  estimateTokens(keyword: string): number

  // Token cost of a comma-separated keyword string
  estimateKeywordSetTokens(keywords: string[]): number

  // Calculate how many tokens are available for keywords
  buildBudget(options: {
    totalContextTokens:    number;  // 8192
    systemPromptTokens:    number;
    memoryContextTokens:   number;
    historyTokens:         number;
    currentMessageTokens?: number;  // default 100
    generationBudget?:     number;  // default 2000
  }): TokenBudget
  // TokenBudget → { total, reserved, available }

  // Estimate token count for any string (4 chars = 1 token)
  static estimateString(text: string): number
}
```

---

### M08 — ContextBuilder

**Path:** `electron/ai/context/ContextBuilder.ts`
**Purpose:** Combines MemoryEngine output and KeywordRepository output into a formatted context block for the system prompt.

```typescript
class ContextBuilder {
  constructor(memory: MemoryEngine, keywords: KeywordRepository, optimizer: LruOptimizer)

  // Build the full context block for a project + flow
  async build(opts: ContextBuildOptions): Promise<ContextResult>
  // ContextBuildOptions → { projectDir, flowId, tokenBudget? = 1500 }
  // ContextResult → { context, estimatedTokens, includedKeywords, droppedKeywords, hasMemory }
  // Output format:
  // "[PROJECT CONTEXT]\nTech Stack: React\n...\n\n[KEYWORDS]\nauth, dashboard, ..."

  // Convenience: returns only the context string
  async buildString(opts: ContextBuildOptions): Promise<string>
}
```

---

### M09 — ModelRouter

**Path:** `electron/ai/core/ModelRouter.ts`
**Purpose:** Single entry point for all inference. Implements circuit-breaker pattern.

```typescript
class ModelRouter {
  constructor(sidecar: LlamaSidecar, ollama: OllamaAdapter)

  // Non-streaming inference. Selects backend, retries with Ollama on sidecar failure.
  async complete(req: InferenceRequest): Promise<InferenceResponse>

  // Streaming inference. Transparent fallback to Ollama on stream error.
  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void>

  // Health status of both backends + active backend
  async health(): Promise<RouterHealth>

  // Which backend is currently active
  get activeBackend(): "sidecar" | "ollama"

  // Circuit-breaker constants:
  // MAX_SIDECAR_FAILURES = 3  (opens circuit after 3 consecutive failures)
  // RESET_INTERVAL_MS = 60000 (retries sidecar after 60 seconds)
}

class RouterUnavailableError extends Error {}
```

---

### M10 — PromptTemplates

**Path:** `electron/ai/prompt/PromptTemplates.ts`
**Purpose:** Namespace facade and barrel export for all prompt template functions.

```typescript
// Direct function imports (preferred):
import {
  interviewSystemPrompt,
  interviewStepPrompt,      // (vars: InterviewTemplateVars) => string
  interviewSkipEvalPrompt,

  chatSystemPrompt,         // (vars: ChatSystemPromptVars) => string
  suggestionChipPrompt,
  contextPrimerPrompt,

  memoryDistillationSystemPrompt,
  memoryExtractionPrompt,
  keywordExtractionSystemPrompt,
  keywordExtractionPrompt,

  planningSystemPrompt,
  planGenerationPrompt,     // (vars: PlanGenerationVars) => string
  roadmapRefinementPrompt,
  contextResolvePrompt,

  evaluationSystemPrompt,
  evaluationPrompt,
  stepCompletionEvalPrompt,
  roadmapEvalPrompt,
} from "./prompt/PromptTemplates";

// Namespace class (alternative style):
const pt = new PromptTemplates();
pt.chat.chatSystemPrompt({ contextBlock, projectTitle });
pt.interview.interviewStepPrompt({ step: 1, missionTitle: "My Project" });
```

**Template files (v1):**
- `templates/interview.ts` — 6-step interview prompts, skip evaluation
- `templates/chat.ts` — Main chat system prompt, suggestion chips, context primer
- `templates/memory.ts` — Memory distillation, keyword extraction
- `templates/planning.ts` — Roadmap generation, refinement, context resolution
- `templates/evaluation.ts` — General evaluation, step completion, roadmap quality (**scoring rubric fix applied**)

**Template files (v2 — Beta-2):**
- `templates/mission.ts` — Mission classification, confirmation, goal capture prompts
- `templates/desirability.ts` — Initial desirability evaluation prompt
- `templates/dvf.ts` — DVF evaluation (Desirability × 0.4 + Viability × 0.3 + Feasibility × 0.3)
- `templates/progress.ts` — Step progress validation (6-band rubric, threshold 60/100)
- `templates/decision.ts` — CONTINUE / IMPROVE / REDESIGN decision prompt

---

### M11 — GrammarRegistry

**Path:** `electron/ai/prompt/GrammarRegistry.ts`
**Purpose:** Loads and caches GBNF grammar files. Grammars constrain LLM output to valid JSON.

```typescript
class GrammarRegistry {
  constructor(opts?: { grammarsDir?: string })

  // Load and return grammar content. Throws GrammarNotFoundError if missing.
  async get(taskType: TaskType | string): Promise<string>

  // Pre-load all 7 known grammars at startup (recommended)
  async preload(): Promise<void>

  // Check whether a grammar file exists
  async has(taskType: TaskType | string): Promise<boolean>

  // List cached task types
  cached(): string[]

  // Clear the in-memory cache
  clear(): void
}

class GrammarNotFoundError extends Error {}

// TaskType values:
// "interview-step" | "interview-plan" | "memory-delta" |
// "keyword-extraction" | "evaluation-result" | "context-resolve" | "generative-ui"
```

---

### M12 — PromptCompiler

**Path:** `electron/ai/prompt/PromptCompiler.ts`
**Purpose:** Pure transformation step — assembles the `messages[]` array for an inference request.

```typescript
class PromptCompiler {
  compile(opts: CompileOptions): CompiledPrompt
  // CompileOptions:
  //   systemPrompt, history, userMessage, contextBlock?,
  //   grammar?, taskType?, maxHistoryTurns? = 10
  // CompiledPrompt:
  //   messages[], estimatedTokens, historyTurns, grammar?

  static estimateTokens(text: string): number
}
```

---

### M13 — PromptEngine

**Path:** `electron/ai/prompt/PromptEngine.ts`
**Purpose:** High-level orchestrator for one inference turn. Wires Compiler + Grammar + Router + Validator.

```typescript
class PromptEngine {
  constructor(
    compiler:  PromptCompiler,
    grammar:   GrammarRegistry,
    router:    ModelRouter,
    validator: SchemaValidator,
  )

  // Non-streaming. Returns validated text or error.
  async run(req: PromptEngineRequest): Promise<PromptEngineResponse>
  // PromptEngineRequest: { systemPrompt, userMessage, contextBlock?, history?,
  //                        taskType?, grammar?, stream?, maxHistoryTurns? }
  // PromptEngineResponse: { ok, text?, error?, tokens?, backend?, latencyMs? }

  // Streaming. Validates full response in onDone callback.
  async stream(
    req:     PromptEngineRequest,
    onChunk: (chunk: string) => void,
    onDone:  (full: string, latencyMs: number) => void,
    onError: (error: string) => void,
  ): Promise<void>
}
```

---

### M14 — ConversationStateManager

**Path:** `electron/ai/conversation/ConversationStateManager.ts`
**Purpose:** Manages the conversation registry and delegates message I/O to MessageStore.

```typescript
class ConversationStateManager {
  constructor(projectDir: string)

  async create(opts?: CreateConversationOptions): Promise<Conversation>
  // CreateConversationOptions: { id?, title?, flowId? }

  async get(convId: string, historyOpts?: ReadHistoryOptions): Promise<Conversation | null>

  async list(): Promise<Conversation[]>

  async appendMessage(
    convId:  string,
    role:    "user" | "assistant" | "system",
    content: string,
    opts?:   AppendMessageOptions,
  ): Promise<StoredMessage | null>

  async readHistory(convId: string, opts?: ReadHistoryOptions): Promise<StoredMessage[]>

  async delete(convId: string): Promise<boolean>

  async getRegistry(): Promise<ConversationRegistry>
}
```

---

### M15 — MemoryDistillation

**Path:** `electron/ai/memory/MemoryDistillation.ts`
**Purpose:** Background pipeline that extracts memory deltas and keywords from conversation turns.

```typescript
class MemoryDistillation {
  constructor(
    memory:       MemoryEngine,
    promptEngine: PromptEngine,
    keywords:     KeywordRepository,
    validator:    SchemaValidator,
  )

  // Fire-and-forget safe. Runs both extractions in parallel.
  // 1. Calls model with memory-delta task → appends to MemoryEngine
  // 2. Calls model with keyword-extraction task → adds to KeywordRepository
  async distill(
    projectDir:  string,
    flowId:      string,
    userMessage: string,
    aiMessage:   string,
  ): Promise<void>
}
```

---

### M16 — ContextInjector

**Path:** `electron/ai/context/ContextInjector.ts`
**Purpose:** Resolves which project is relevant to a user message, then builds the context block.

```typescript
class ContextInjector {
  constructor(
    promptEngine:   PromptEngine,
    validator:      SchemaValidator,
    contextBuilder: ContextBuilder,
    projectState:   ProjectStateManager,
  )

  // Infer project from message → build context block
  async resolve(opts: ContextResolveOptions): Promise<ContextInjectResult>
  // ContextResolveOptions: { message, storageRoot }
  // ContextInjectResult:   { ok, hasContext, context, error? }
}
```

---

### M17 — AdaptiveInterviewEngine

**Path:** `electron/ai/interview/AdaptiveInterviewEngine.ts`
**Purpose:** Drives the 6-step onboarding interview state machine.

```typescript
class AdaptiveInterviewEngine {
  constructor(
    promptEngine: PromptEngine,
    validator:    SchemaValidator,
    planning:     AiPlanningEngine,
    evaluation:   AiEvaluationFramework,
  )

  // Process one user turn. Returns the AI's response + updated state.
  async processUserTurn(input: InterviewTurnInput): Promise<InterviewTurnResult>
  // InterviewTurnInput:  { projectId, userMessage, state: InterviewState }
  // InterviewTurnResult: { ok, aiMessage?, nextState?, isComplete?, roadmap?, error? }
}

// Create initial state for a new interview
function initialInterviewState(projectId: string): InterviewState
// InterviewState: { projectId, currentStep (1-6), completedSteps[], priorSummary,
//                  extracted, isComplete, skippedStep2 }
```

**Step 2 skip logic:** If the AI sets `skip_next_step: true` in the Step 1 response, the engine automatically advances to Step 3. This happens when the user's opening message already contains both concrete goals and domain understanding.

---

### M18 — AiPlanningEngine

**Path:** `electron/ai/planning/AiPlanningEngine.ts`
**Purpose:** Generates and refines the InterviewPlan (5–10 step project roadmap).

```typescript
class AiPlanningEngine {
  constructor(
    promptEngine: PromptEngine,
    validator:    SchemaValidator,
    projectState: ProjectStateManager,
  )

  // Generate an initial roadmap. Optionally persists to project.json.
  async generate(opts: GeneratePlanOptions): Promise<PlanResult>
  // GeneratePlanOptions: { projectId, contextBlock?, stepCount? = 7,
  //                        userConstraints?, persist? = true }

  // Refine an existing roadmap based on user feedback.
  async refine(opts: RefinePlanOptions): Promise<PlanResult>
  // RefinePlanOptions: { projectId, userRequest, contextBlock? }

  // PlanResult: { ok, plan?: InterviewPlan, error? }
}
```

---

### M19 — AiEvaluationFramework

**Path:** `electron/ai/evaluation/AiEvaluationFramework.ts`
**Purpose:** Quality gating for interview steps, roadmaps, and arbitrary content.

```typescript
class AiEvaluationFramework {
  constructor(promptEngine: PromptEngine, validator: SchemaValidator)

  // Evaluate whether a user's interview step response is sufficient (threshold: 60/100)
  async evaluateStepCompletion(input: StepCompletionInput): Promise<EvalResponse>
  // StepCompletionInput: { stepNumber, userResponse, stepGoal }

  // Evaluate the quality of a generated roadmap (threshold: 75/100)
  async evaluateRoadmap(input: RoadmapEvalInput): Promise<EvalResponse>
  // RoadmapEvalInput: { projectId, missionTitle, roadmapJson, contextBlock? }

  // General-purpose evaluation against custom criteria
  async evaluate(input: GeneralEvalInput): Promise<EvalResponse>
  // GeneralEvalInput: { subject, content, criteria: string[], contextBlock? }

  // EvalResponse: { ok, result?: EvaluationResult, error? }
  // EvaluationResult: { is_valid, feedback, suggestions[], ready_to_advance, score (0-100) }
}
```

---

### M20 — FileExtractor

**Path:** `electron/ai/multimodal/FileExtractor.ts`
**Purpose:** Extracts text and metadata from user-attached files. Caps text at 24,000 characters.

```typescript
class FileExtractor {
  constructor(opts?: { charCap?: number })  // default charCap: 24000

  // Extract content from any supported file. Never throws — returns ExtractResult.
  async extract(filePath: string): Promise<ExtractResult>
  // ExtractResult: { ok, file?: ExtractedFile, error? }
  // ExtractedFile: { filePath, fileType, text, truncated, originalLength,
  //                  pageCount?, isImage, dataUrl?, mimeType? }
}

// Supported file types:
// Text:  .txt .md .csv .json .ts .js .py .html .css
// Docs:  .pdf (via pdf-parse) · .docx (via mammoth)
// Images: .png .jpg .jpeg .webp .gif (returned as base64 data URL)
```

---

### M21 — VisionProcessor

**Path:** `electron/ai/multimodal/VisionProcessor.ts`
**Purpose:** Prepares images for multimodal inference. Returns an **Ollama-native** `ChatMessage` (not OpenAI content arrays).

```typescript
class VisionProcessor {
  constructor(opts?: { maxDimension?: number })  // default maxDimension: 1024

  // Build an Ollama-native ChatMessage from text + image paths.
  // Returns: { role: "user", content: string, images?: string[] }
  // images[] contains raw base64 (no data URL prefix) — ready for Ollama /api/chat
  async prepare(
    textPrompt: string,
    imagePaths: string[],
  ): Promise<VisionPrepareResult>
  // VisionPrepareResult: { ok, message?: ChatMessage, warnings?, error? }
  // ChatMessage: { role: "user", content: string, images?: string[] }

  // Fallback for non-vision backends — returns text with image names appended
  buildFallbackText(textPrompt: string, imagePaths: string[]): string

  // True if the file extension is a supported image format
  static isSupportedImage(filePath: string): boolean

  // Conservative token cost estimate for one image (~1280 tokens)
  static estimateImageTokens(imagePath: string): number
}
```

---

### SchemaValidator

**Path:** `electron/ai/validation/SchemaValidator.ts`
**Purpose:** Validates AI-generated JSON against the JSON Schemas in `schemas/`.

```typescript
class SchemaValidator {
  constructor(schemasDir?: string)

  // Load and compile a schema (cached after first load)
  async load(taskType: TaskType | string): Promise<void>

  // Pre-load all 7 schemas at startup (recommended)
  async preload(): Promise<void>

  // Validate a JSON string. Strips markdown code fences before parsing.
  validate(taskType: TaskType | string, jsonText: string): ValidationResult
  // ValidationResult: { valid, errors: string[], data? }

  // Parse + validate — returns typed T or null on failure
  parseAndValidate<T>(taskType: TaskType | string, jsonText: string): T | null
}
```

---

### AiContainer (Dependency Injection Root)

**Path:** `electron/ai/ipc/AiContainer.ts`
**Purpose:** Creates and wires all module instances. One singleton per application lifecycle.

```typescript
class AiContainer {
  // All public properties are singletons:
  readonly storageRoot:         string
  readonly sidecar:             LlamaSidecar
  readonly ollama:              OllamaAdapter
  readonly router:              ModelRouter
  readonly projectState:        ProjectStateManager
  readonly messageStore:        MessageStore
  readonly keywords:            KeywordRepository
  readonly compiler:            PromptCompiler
  readonly grammar:             GrammarRegistry
  readonly validator:           SchemaValidator
  readonly promptEngine:        PromptEngine
  readonly templates:           PromptTemplates
  readonly lru:                 LruOptimizer
  readonly fileExtractor:       FileExtractor
  readonly visionProcessor:     VisionProcessor
  readonly contextInjector:     ContextInjector
  readonly memoryDistillation:  MemoryDistillation
  readonly planningEngine:      AiPlanningEngine
  readonly evaluationFramework: AiEvaluationFramework
  readonly interviewEngine:     AdaptiveInterviewEngine

  // Beta-2 singletons (v2)
  readonly missionClassifier:     MissionClassifier
  readonly missionWorkflow:       MissionWorkflowEngine
  readonly desirabilityEvaluator: DesirabilityEvaluator
  readonly dvfEvaluator:          DVFEvaluator
  readonly progressEvaluator:     ProgressEvaluator
  readonly decisionEngine:        DecisionEngine
  readonly roadmapVersioning:     RoadmapVersioning

  // Factory — creates the container and starts the sidecar
  static async create(opts: AiContainerOptions): Promise<AiContainer>
  // AiContainerOptions: { storageRoot, llamaBinary?, modelPath?, ollamaBaseUrl? }

  // Per-project helpers (lazy-initialised, cached)
  getProjectDir(projectId: string): string
  getMemoryEngine(projectId: string): MemoryEngine
  getContextBuilder(projectId: string): ContextBuilder
  getConversationManager(projectId: string): ConversationStateManager
  async getHistory(projectId: string, conversationId?: string): Promise<ChatMessage[]>

  // Graceful shutdown — call on app.before-quit
  async dispose(): Promise<void>
}
```

---

### AiIpcHandlers — Registered Channels

**Path:** `electron/ai/ipc/AiIpcHandlers.ts`
**Purpose:** Registers `ipcMain.handle()` for all AI IPC channels.

#### v1 Channels (8)

| Channel | Direction | Handler |
|---|---|---|
| `ai:stream-message` | renderer → main | `PromptEngine.stream()` |
| `ai:get-context` | renderer → main | `ContextInjector.resolve()` |
| `ai:start-interview` | renderer → main | `AdaptiveInterviewEngine.processUserTurn()` (step 1) |
| `ai:interview-step` | renderer → main | `AdaptiveInterviewEngine.processUserTurn()` (steps 2–6) |
| `ai:generate-plan` | renderer → main | `AiPlanningEngine.generate()` |
| `ai:get-memory` | renderer → main | `MemoryEngine.formatAsContext()` |
| `ai:clear-memory` | renderer → main | Truncates `global-memory.log` |
| `ai:extract-file` | renderer → main | `FileExtractor.extract()` |
| `ai:stream:chunk` | main → renderer | Chunk payload: `{ requestId?: string, chunk: string }` |
| `ai:stream:done` | main → renderer | Done payload: `{ requestId?: string, full: string, latencyMs: number }` |
| `ai:stream:error` | main → renderer | Error payload: `{ requestId?: string, error: string }` |

#### v2 Beta-2 Channels (13)

| Channel | Direction | Handler |
|---|---|---|
| `ai:classify-mission` | renderer → main | `MissionWorkflowEngine.classify()` |
| `ai:confirm-classification` | renderer → main | `MissionWorkflowEngine.confirmClassification()` |
| `ai:capture-goal` | renderer → main | `MissionWorkflowEngine.saveProjectGoal()` |
| `ai:capture-end-goal` | renderer → main | `MissionWorkflowEngine.saveEndGoal()` |
| `ai:evaluate-desirability` | renderer → main | `MissionWorkflowEngine.evaluateDesirability()` |
| `ai:generate-ideation-roadmap` | renderer → main | `MissionWorkflowEngine.generateIdeationRoadmap()` |
| `ai:refine-roadmap` | renderer → main | `MissionWorkflowEngine.refineRoadmap()` (+ version snapshot) |
| `ai:validate-progress` | renderer → main | `MissionWorkflowEngine.validateProgress()` |
| `ai:start-ideation` | renderer → main | `MissionWorkflowEngine.startIdeation()` |
| `ai:ideation-ready` | renderer → main | `MissionWorkflowEngine.markIdeationReady()` |
| `ai:evaluate-dvf` | renderer → main | `MissionWorkflowEngine.evaluateDVF()` (append-only) |
| `ai:record-decision` | renderer → main | `MissionWorkflowEngine.recordDecision()` |
| `ai:generate-final-roadmap` | renderer → main | `MissionWorkflowEngine.generateFinalRoadmap()` |

---

### M22 — Testing Framework

**Path:** `electron/ai/__tests__/`

| File | Purpose |
|---|---|
| `mocks/MockModelRouter.ts` | Fake router with programmable response queues |
| `mocks/MockPromptEngine.ts` | Fake engine with per-taskType response map |
| `fixtures/schemas.ts` | Valid JSON fixture objects for all 7 schema types |
| `factories/project.factory.ts` | `buildProjectMeta()`, `buildProjectSettings()` |
| `factories/conversation.factory.ts` | `buildStoredMessage()`, `buildConversation()`, `buildMessagePair()` |
| `stubs/IpcStub.ts` | `IpcAiStub` + `IpcEventBusStub` for integration-level tests |
| `mocks/MockBeta2Responses.ts` | Canned JSON for all 5 Beta-2 task types + `applyBeta2Defaults()` helper |

**Running tests:**

```bash
cd electron/ai
npm install

# Unit tests only (no llama.cpp or Ollama required)
npm run test:unit

# All tests including integration (requires Ollama running)
ENABLE_INTEGRATION_TESTS=1 npm test

# With coverage report
npm run test:coverage
```

---

### M23 — MissionClassifier

**Path:** `electron/ai/mission/MissionClassifier.ts`
**Purpose:** Classifies a user's opening message as `project` or `subject/module` using the `mission-classification` schema.

```typescript
class MissionClassifier {
  constructor(promptEngine: PromptEngine, validator: SchemaValidator)

  // Runs a single inference turn and validates the result against mission-classification schema.
  // Returns the parsed MissionClassification on success, or an error string.
  async classify(userMessage: string): Promise<ClassifyResult>
  // ClassifyResult: { ok: true; classification: MissionClassification }
  //               | { ok: false; error: string }

  // Build the AI's confirmation message from a classification result.
  confirmationMessage(classification: MissionClassification): string
}

// MissionClassification shape:
// { mission_type: "project" | "subject", confidence: number (0-100),
//   reasoning: string, understood_problem: string,
//   detected_goals?: string[], detected_outcomes?: string[],
//   constraints?: string[], resources?: string[] }
```

---

### M24 — MissionWorkflowEngine

**Path:** `electron/ai/mission/MissionWorkflowEngine.ts`
**Purpose:** 24-state workflow state machine that drives the full Beta-2 mission lifecycle from classification through final roadmap. Persists state into `ProjectMeta` via `ProjectStateManager.updateMeta()`.

```typescript
class MissionWorkflowEngine {
  constructor(
    projectState:        ProjectStateManager,
    classifier:          MissionClassifier,
    desirability:        DesirabilityEvaluator,
    dvf:                 DVFEvaluator,
    progress:            ProgressEvaluator,
    decision:            DecisionEngine,
    planning:            AiPlanningEngine,
    roadmapVersioning:   RoadmapVersioning,
  )

  async classify(projectId: string, userMessage: string): Promise<WorkflowResult>
  // → state: AWAITING_CLASSIFICATION_CONFIRMATION

  async confirmClassification(projectId: string, confirmed: boolean, correctedMessage?: string): Promise<WorkflowResult>
  // confirmed=true → PROJECT_GOAL_CAPTURE or SUBJECT_SETUP
  // confirmed=false + correctedMessage → reclassify

  async saveProjectGoal(projectId: string, goal: ProjectGoal): Promise<WorkflowResult>
  // → state: PROJECT_END_GOAL_CAPTURE

  async saveEndGoal(projectId: string, endGoal: EndGoal): Promise<WorkflowResult>
  // → state: INITIAL_DESIRABILITY_EVALUATION

  async evaluateDesirability(projectId: string, vars: DesirabilityEvalVars): Promise<WorkflowResult>
  // → state: IDEATION_ROADMAP

  async generateIdeationRoadmap(projectId: string, contextBlock?: string): Promise<WorkflowResult>
  // → state: ROADMAP_REVIEW

  async refineRoadmap(projectId: string, userRequest: string, contextBlock?: string): Promise<WorkflowResult>
  // → state: ROADMAP_REVIEW (with new version snapshot)

  async approveRoadmap(projectId: string): Promise<WorkflowResult>
  // → state: PROJECT_EXECUTION

  async validateProgress(projectId: string, vars: ProgressEvalVars): Promise<WorkflowResult>
  // score ≥ 60 → PROJECT_EXECUTION | score < 60 → PROGRESS_CORRECTION

  async startIdeation(projectId: string): Promise<WorkflowResult>
  // → state: IDEATION

  async markIdeationReady(projectId: string): Promise<WorkflowResult>
  // → state: IDEATION_READY

  async evaluateDVF(projectId: string, vars: DVFEvalVars): Promise<WorkflowResult>
  // Appends to dvf_evaluations[] (never overwrites) → state: DVF_REVIEW

  async recordDecision(projectId: string, vars: DecisionPromptVars): Promise<WorkflowResult>
  // continue → FINAL_ROADMAP | improve → IMPROVEMENT | redesign → REDESIGN

  async generateFinalRoadmap(projectId: string, contextBlock?: string): Promise<WorkflowResult>
  // → state: EXECUTION
}

// WorkflowResult: { ok: boolean; state?: MissionWorkflowState; error?: string }
```

**24 states:** `NEW_MISSION` · `CLASSIFYING` · `AWAITING_CLASSIFICATION_CONFIRMATION` · `SUBJECT_SETUP` · `SUBJECT_OUTCOME_CONFIRMATION` · `SUBJECT_FLOW_CREATION` · `SUBJECT_ACTIVE` · `PROJECT_GOAL_CAPTURE` · `PROJECT_END_GOAL_CAPTURE` · `INITIAL_DESIRABILITY_EVALUATION` · `IDEATION_ROADMAP` · `ROADMAP_REVIEW` · `PROJECT_EXECUTION` · `PROGRESS_VALIDATION` · `PROGRESS_CORRECTION` · `IDEATION` · `IDEATION_READY` · `DVF_EVALUATION` · `DVF_REVIEW` · `AWAITING_DECISION` · `IMPROVEMENT` · `REDESIGN` · `FINAL_ROADMAP` · `EXECUTION` · `COMPLETED`

Transitions are enforced via a flat `VALID_TRANSITIONS` lookup table. Invalid transitions return `{ ok: false, error }` without modifying state.

---

### M25 — DesirabilityEvaluator

**Path:** `electron/ai/evaluation/DesirabilityEvaluator.ts`
**Purpose:** Evaluates initial market desirability at the start of a project workflow. Does **not** perform full DVF — only demand and problem clarity.

```typescript
class DesirabilityEvaluator {
  constructor(promptEngine: PromptEngine, validator: SchemaValidator)

  async evaluate(vars: DesirabilityEvalVars): Promise<DesirabilityEvalResult>
  // DesirabilityEvalVars: { projectTitle, problemStatement, detectedGoals,
  //                         detectedOutcomes, constraints, resources }
  // DesirabilityEvalResult: { ok, result?: DesirabilityResult, error? }
  // DesirabilityResult: { stage, score, problem_clarity, demand_strength,
  //                       evidence[], ready_for_ideation }
  // ready_for_ideation: true when score >= 40
}
```

**Evidence/assumption distinction:** All evidence items are tagged with `type: "evidence" | "assumption" | "unknown" | "requires_validation"`. AI must never promote assumptions to factual claims.

---

### M26 — DVFEvaluator

**Path:** `electron/ai/evaluation/DVFEvaluator.ts`
**Purpose:** Evaluates a project on three dimensions after ideation is complete.

```typescript
class DVFEvaluator {
  constructor(promptEngine: PromptEngine, validator: SchemaValidator)

  async evaluate(vars: DVFEvalVars): Promise<DVFEvalResult>
  // DVFEvalVars: { projectTitle, problemStatement, ideationSummary,
  //               endGoal, constraints, resources, previousDVF? }
  // DVFEvalResult: { ok, result?: DVFResult, error? }
  // DVFResult: { stage, version, desirability, viability, feasibility,
  //              overall_score, recommendation, ready_for_decision }
}

// Scoring formula: overall_score = D×0.4 + V×0.3 + F×0.3
// Dimensions: { score, summary, evidence[], risks[] }
```

---

### M27 — ProgressEvaluator

**Path:** `electron/ai/evaluation/ProgressEvaluator.ts`
**Purpose:** Validates user progress on a project step. Uses the same 6-band scoring rubric as `AiEvaluationFramework`.

```typescript
class ProgressEvaluator {
  constructor(promptEngine: PromptEngine, validator: SchemaValidator)

  async evaluate(vars: ProgressEvalVars): Promise<ProgressEvalResult>
  // ProgressEvalVars: { stepNumber, stepTitle, stepGoal, userResponse,
  //                     projectContext?, previousFeedback? }
  // ProgressEvalResult: { ok, result?: ProgressEvaluation, error? }
  // ProgressEvaluation: { step, step_title, is_complete, score,
  //                        feedback, suggestions[], ready_to_advance,
  //                        understanding_score? }
  // ready_to_advance: true when score >= 60
}

// Scoring rubric (identical to stepCompletionEvalPrompt fix in evaluation.ts):
//  0-10:  No attempt or completely off-topic
// 11-29:  Minimal attempt — tangentially related
// 30-50:  Meaningful partial attempt — some required fields, missing key info
// 51-74:  Mostly complete — main goal addressed, minor gaps
// 75-89:  Strong response — specific, on-topic, covers goal fully
// 90-100: Exceptional — specific, well-supported, goes beyond minimum
```

---

### M28 — DecisionEngine

**Path:** `electron/ai/evaluation/DecisionEngine.ts`
**Purpose:** Routes the project to CONTINUE, IMPROVE, or REDESIGN after DVF evaluation.

```typescript
class DecisionEngine {
  constructor(promptEngine: PromptEngine, validator: SchemaValidator)

  async classify(vars: DecisionPromptVars): Promise<DecisionEngineResult>
  // DecisionPromptVars: { projectTitle, dvfResult, endGoal, userInput? }
  // DecisionEngineResult: { ok, result?: DecisionResult, error? }
  // DecisionResult: { decision: "continue" | "improve" | "redesign",
  //                   reasoning, confidence, next_steps[] }
}

// Routing thresholds:
// CONTINUE:  overall_score >= 70
// IMPROVE:   overall_score 40–69
// REDESIGN:  overall_score < 40 OR any single dimension < 25
```

---

### M29 — RoadmapVersioning

**Path:** `electron/ai/planning/RoadmapVersioning.ts`
**Purpose:** Wraps `AiPlanningEngine.refine()` to snapshot the current roadmap before every refinement. Fixes the overwrite bug in the original `refine()`.

```typescript
class RoadmapVersioning {
  constructor(planning: AiPlanningEngine, projectState: ProjectStateManager)

  // Snapshot current roadmap into roadmap_versions[], then call planning.refine().
  async refineWithHistory(opts: RefineWithHistoryOptions): Promise<RefineWithHistoryResult>
  // RefineWithHistoryOptions: { projectId, userRequest, contextBlock? }
  // RefineWithHistoryResult:  { ok, plan?, versionSaved, versionNumber, error? }
}

// RoadmapVersion shape (appended to project.json roadmap_versions[]):
// { version: number, timestamp: ISO, roadmap: PlanStep[],
//   user_feedback: string, previous_version: number | null }
```

---

## 8. IPC Contract Reference

The IPC contract is defined in `src/lib/electron.d.ts` and is **immutable** — all main process implementations must match it exactly. Never modify this file unless explicitly doing a coordinated contract change.

### AI Namespace (`ipc.ai.*`)

```typescript
// Stream a message — response arrives via push events below
ipc.ai.streamMessage(conversationId: string, message: string, opts?: {
  num_ctx?: number;
  systemSuffix?: string;
}) → Promise<{ requestId: string; userMessage: VyrixMessage; error?: string }>

// Resolve @-mention to project context
ipc.ai.resolveContext(message: string)
  → Promise<{ ok: boolean; hasContext: boolean; context: string }>

// Get or create a conversation
ipc.ai.getOrCreateConversation(opts: { projectId?: string; scope?: string; title?: string })
  → Promise<{ conversation: VyrixConversation }>

// Get conversation with full message history
ipc.ai.getConversation(id: string)
  → Promise<{ conversation: VyrixConversation; messages: VyrixMessage[] }>

// AI health check
ipc.ai.health()
  → Promise<{ ok: boolean; message: string; installedModels: { name: string }[]; preferredModel: string }>
```

### IPC Push Events (Main → Renderer)

```typescript
// requestId echoes the id passed in ai:stream-message opts — filter by it so
// concurrent streams (Main AI tab + POP tab) don't interleave.
ipc.on('ai:stream:chunk', (payload: { requestId?: string; chunk: string }) => void)
ipc.on('ai:stream:done',  (payload: { requestId?: string; full: string; latencyMs: number }) => void)
ipc.on('ai:stream:error', (payload: { requestId?: string; error: string }) => void)
```

### Aspects Namespace (`ipc.aspects.*`)

```typescript
ipc.aspects.addKeyword(projectId: string, aspectId: string, keyword: string)
  → Promise<{ ok: boolean; movedTo?: string; movedToName?: string; error?: string }>

ipc.aspects.removeKeyword(projectId: string, aspectId: string, keyword: string)
  → Promise<{ ok: boolean; error?: string }>

ipc.aspects.getKeywords(projectId: string, aspectId: string)
  → Promise<{ ok: boolean; keywords: Record<string, string>; error?: string }>

ipc.aspects.buildContextPrompt(projectId: string)
  → Promise<{ ok: boolean; prompt: string; keywords: Record<string, string[]>; error?: string }>
```

### Projects Namespace (`ipc.projects.*`)

```typescript
ipc.projects.list()        → Promise<VyrixProject[]>
ipc.projects.listActive()  → Promise<Pick<VyrixProject, "id" | "title" | "color">[]>
ipc.projects.get(id)       → Promise<VyrixProject | null>
ipc.projects.create(parentId?: string, color?: string) → Promise<Partial<VyrixProject>>
ipc.projects.save(id, patch)        → Promise<{ id: string; updated_at: string } | null>
ipc.projects.star(id)               → Promise<{ ok: boolean }>
ipc.projects.unstar(id)             → Promise<{ ok: boolean }>
ipc.projects.trash(id)              → Promise<{ ok: boolean }>
ipc.projects.restore(id)            → Promise<{ ok: boolean }>
ipc.projects.delete(id)             → Promise<{ ok: boolean }>
ipc.projects.move(id, targetFolderId) → Promise<{ ok: boolean }>
```

### Core Type Definitions

```typescript
interface VyrixProject {
  id:           string;
  title:        string;
  description:  string;
  content:      Record<string, unknown>;  // roadmap, interview state, etc.
  color:        string;
  cover_index:  number;
  folder_id:    string | null;
  parent_id:    string | null;
  starred:      number;        // 0 | 1
  deleted_at:   string | null;
  created_at:   string;
  updated_at:   string;
  flows?:       VyrixFlow[];
}

interface VyrixConversation {
  id:            string;
  projectId?:    string;
  scope:         string;  // "workspace" | "project"
  model:         string;
  messageCount:  number;
  lastMessageAt: string;
  createdAt:     string;
  updatedAt:     string;
}

interface VyrixMessage {
  id:             string;
  conversationId: string;
  role:           "user" | "assistant";
  content:        string;
  model?:         string;
  latencyMs?:     number;
  createdAt:      string;
}

interface VyrixFlow {
  id:          string;
  projectId:   string;
  title:       string;
  description: string;
  order:       number;
  created_at:  string;
  updated_at:  string;
  files?:      VyrixFlowFile[];
}
```

---

## 9. Design System

Vyrix uses a CSS custom property–based design system with `--vx-*` prefixed tokens. **All colors in all components must use these tokens — never hardcode color values.**

### Color Tokens

| Token | Light | Dark | Usage |
|---|---|---|---|
| `--vx-bg` | `#f3f3f7` | `#0a0a0d` | Page background |
| `--vx-sidebar` | `#ececf1` | `#0a0a0d` | Sidebar background |
| `--vx-surface` | `rgba(0,0,0,0.04)` | `rgba(255,255,255,0.03)` | Card / panel fill |
| `--vx-surface-2` | `rgba(0,0,0,0.07)` | `rgba(255,255,255,0.07)` | Active state fill |
| `--vx-surface-3` | `rgba(0,0,0,0.12)` | `rgba(255,255,255,0.12)` | Hover state fill |
| `--vx-overlay` | `rgba(250,250,252,0.97)` | `rgba(18,18,26,0.97)` | Modal/popover backdrop |
| `--vx-border` | `rgba(0,0,0,0.08)` | `rgba(255,255,255,0.06)` | Default border |
| `--vx-border-2` | `rgba(0,0,0,0.15)` | `rgba(255,255,255,0.12)` | Emphasized border |
| `--vx-text` | `#0d0d12` | `#ffffff` | Primary text |
| `--vx-text-2` | `#5a5a6e` | `#aaaaaa` | Secondary text |
| `--vx-text-3` | `#8c8c9e` | `#555555` | Tertiary / placeholder |
| `--vx-text-4` | `#b4b4c6` | `#333333` | Muted / disabled |
| `--vx-accent` | `#3E72E8` | `#5B8AF0` | Brand blue (CTAs, active states) |
| `--vx-accent-dim` | `rgba(62,114,232,0.15)` | `rgba(91,138,240,0.2)` | Accent background wash |

### Typography

| Class | Size | Usage |
|---|---|---|
| `font-unbounded` | varies | Brand name "vyrix", section headings |
| `font-sans` | `text-[14px]` | Input text, body copy |
| `font-sans` | `text-[13px]` | Labels, nav items, buttons |
| `font-sans` | `text-[12px]` | Secondary labels, captions |
| `font-sans` | `text-[11px]` | Meta labels (uppercase + tracking) |
| `font-sans` | `text-[10px]` | Fine print, version info |

### Spacing & Shape

| Element | Border Radius |
|---|---|
| Text inputs | `rounded-[10px]` |
| Cards, sections | `rounded-[12px]` |
| Panels, drawers | `rounded-[16px]` |
| Modals | `rounded-[16px]` |
| Buttons | `rounded-[10px]` |
| Icon buttons | `rounded-[8px]` |
| Tags / chips | `rounded-full` |
| Active nav indicator | `rounded-r-full` (left edge, 3px wide) |

### Component Patterns

```tsx
// Active nav item with left accent bar
<div className={`relative flex h-[36px] items-center gap-2.5 rounded-[10px] px-3 transition-colors ${
  active
    ? "bg-[var(--vx-surface-2)] text-[var(--vx-text)]"
    : "text-[var(--vx-text-3)] hover:bg-[var(--vx-surface)] hover:text-[var(--vx-text-2)]"
}`}>
  {active && <span className="absolute left-0 top-[7px] h-[22px] w-[3px] rounded-r-full bg-[var(--vx-accent)]" />}
  {children}
</div>

// Standard input field
<input className="w-full rounded-[10px] border border-[var(--vx-border-2)] bg-[var(--vx-surface)] px-4 py-3 font-sans text-[14px] text-[var(--vx-text)] outline-none placeholder:text-[var(--vx-text-4)] focus:border-[rgba(91,138,240,0.5)] transition-colors" />

// Primary CTA button
<button className="flex h-[36px] items-center justify-center gap-2 rounded-[10px] bg-[var(--vx-accent)] font-sans text-[13px] font-semibold text-white transition-opacity hover:opacity-90" />

// Section meta label (uppercase)
<span className="font-sans text-[11px] font-semibold uppercase tracking-[0.12em] text-[var(--vx-text-3)]" />
```

---

## 10. Data Storage Model

No databases. All data is stored as plain files on the local file system.

### Directory Layout

```
%APPDATA%\Vyrix\              (Windows)
~/Library/Application Support/Vyrix/   (macOS)
│
├── projects/
│   └── <project-uuid>/
│       ├── project.json              # Metadata, roadmap, interview state
│       ├── settings.json             # AI model settings, preferences
│       ├── global-memory.log         # Append-only decision log
│       ├── conversations.json        # Conversation registry index
│       └── conv-<uuid>.log           # NDJSON message log per conversation
│           (note: flow keywords stored at flow-level)
│           └── flow-<flow-id>/
│               └── keywords.json     # { "keyword": "ISO-timestamp" }
│
├── workspace/
│   ├── conversations.json
│   └── workspace-memory.log
│
└── models/
    └── qwen2.5-vl-7b-q4_k_m.gguf   # ~4.7 GB model weights
```

### File Formats

**`global-memory.log`** — Append-only, one delta per line, prefix `"+ "`:
```
+ {"key":"Platform","value":"iOS","category":"technical","timestamp":"2026-08-05T10:30:00Z"}
+ {"key":"OutputType","value":"Physical Prototype","category":"design","timestamp":"2026-08-05T10:32:15Z"}
```

**`conv-<uuid>.log`** — NDJSON, one message per line:
```json
{"id":"msg_001","conversationId":"conv-xyz","role":"user","content":"I want to design a campus navigation app","createdAt":"2026-08-05T10:29:55.000Z"}
{"id":"msg_002","conversationId":"conv-xyz","role":"assistant","content":"Great! Tell me more...","createdAt":"2026-08-05T10:30:01.000Z"}
```

**`keywords.json`** — LRU keyword map:
```json
{
  "empathy mapping":  "2026-08-05T11:10:00.000Z",
  "proximity matrix": "2026-08-05T10:55:00.000Z",
  "user journey":     "2026-08-05T10:40:00.000Z"
}
```

**`project.json`** — Project metadata:
```json
{
  "id":                  "proj-abc123",
  "title":               "Smart Campus Navigation",
  "color":               "#5B8AF0",
  "interview_completed": true,
  "roadmap": [
    { "step": 1, "title": "Problem Hypothesis Validation", "description": "...", "methodology": "..." },
    { "step": 2, "title": "Competition Analysis", "description": "..." }
  ],
  "created_at": "2026-08-05T10:00:00.000Z",
  "updated_at": "2026-08-05T11:00:00.000Z"
}
```

---

## 11. Memory & Context System

The AI subsystem uses a two-level memory architecture to keep prompts accurate and within the 8192-token context window.

### Level 1 — Global Memory (`global-memory.log`)

Long-term project facts. Never deleted — only appended. Current state is compiled by replaying all deltas (last-write-wins per key). Examples: project platform, target user, final deliverable type, major decisions.

### Level 2 — Flow Keywords (`keywords.json`)

Short-to-medium-term domain vocabulary. Specific to each research flow. Keywords decay by LRU when the context window is under budget pressure. Examples: "empathy mapping", "proximity matrix", "Bluetooth beacon".

### Token Budget (8192 total)

| Component | Reserved Tokens |
|---|---|
| System prompt (role + instructions) | ~300 |
| Global memory context | ~200 |
| Flow keyword context | variable (LRU-managed) |
| Conversation history (last 10 turns) | ~800 |
| Current user message | ~100 |
| Model generation space | ~2000 |
| **Available for keywords** | **~4792 (max)** |

### LRU Context Injection Flow

Before every inference call:
1. `MemoryEngine.compileState()` — replay all deltas into current state
2. `KeywordRepository.getAll()` — read the active flow's keyword map
3. `LruOptimizer.buildBudget()` — calculate available tokens for keywords
4. `LruOptimizer.optimize()` — sort newest-first, drop oldest until under budget
5. `ContextBuilder.build()` — format the context block with `[PROJECT CONTEXT]` + `[KEYWORDS]` headers
6. After response: `KeywordRepository.refreshTimestamps()` for included keywords

### Memory Distillation

After every AI response, `MemoryDistillation.distill()` runs in the background (fire-and-forget):
- Calls model with `memory-delta` task → extracts one key/value fact → appends to `MemoryEngine`
- Calls model with `keyword-extraction` task → extracts domain keywords + decisions → writes to `KeywordRepository`

---

## 12. Adaptive Interview Engine

> **Beta-2 note:** In the Beta-2 product workflow, a new mission first passes through `MissionClassifier` and `MissionWorkflowEngine` before the interview. The interview engine (below) is invoked as part of the project-path subject/module branch. See §14a for the full workflow.

When a user creates a new Mission, a 6-step adaptive interview runs before the mission page becomes accessible. The interview collects the foundational project context that the AI will use for the entire project lifecycle.

### State Machine

```
CREATE MISSION
     │
     ▼
  Step 1: Open question (describe mission, goals, constraints)
     │
     ├─── [skip_next_step = true if Step 1 captured goals + understanding]
     │
     ▼
  Step 2: Goals clarification (SKIPPED if flagged above)
     │
     ▼
  Step 3: Expected output type (prototype / document / strategy / etc.)
     │
     ▼
  Step 4: Domain context (tech stack, sector, audience, constraints)
     │
     ▼
  Step 5: Timeline (deadlines, milestones, urgency)
     │
     ▼
  Step 6: Confirmation (AI summarises; user confirms)
     │
     ▼
  AiPlanningEngine.generate() → InterviewPlan (5–10 steps)
     │
     ▼
  ProjectStateManager.completeInterview()
  → writes roadmap to project.json
  → sets interview_completed: true
     │
     ▼
  MISSION PAGE UNLOCKED
```

### Evaluation Gate

Before advancing each step, `AiEvaluationFramework.evaluateStepCompletion()` scores the user's response. Score threshold is 60/100. If below threshold, the AI re-asks the question with targeted feedback incorporated.

### Interview Persistence

The `InterviewState` object is designed to be serialised to JSON and stored (in `project.json` or a separate `interview-session.json`) so that if the app is closed mid-interview, the session restores exactly where it left off. **This persistence wiring is part of the remaining Electron main process work** — the engine itself is stateless and receives state as input.

---

## 13. Development Setup

### Prerequisites

```bash
node --version  # 20.x or later (node:crypto, node:fs/promises required)
npm --version   # 10.x or later
```

### Install and Test the AI Subsystem

```bash
cd electron/ai
npm install

# Run unit tests (no AI backend required)
npm run test:unit

# Run with coverage
npm run test:coverage

# TypeScript check
npm run typecheck
```

### Renderer (Reference — Do Not Modify)

```bash
npm install         # root of the repository
npm run dev         # Next.js dev server at http://localhost:3000
npm run build
npm run lint
```

### AI Development Mode (Renderer Without Electron)

When `window.vyrix` is not present (`ipc.isElectron()` returns `false`), the AI page falls back to the `/api/ai/chat` Next.js API route which proxies to Ollama.

```bash
ollama serve
ollama pull llama3.2
npm run dev
```

Full AI subsystem features (memory, context, interview engine, planning) are **not available** in this mode. Full functionality requires the complete Electron shell.

### Environment Variables

```env
# .env.local (renderer only)
OLLAMA_BASE_URL=http://localhost:11434    # Ollama base URL (non-Electron fallback only)
```

---

## 13a. Ollama Setup Guide

The calibration suite and AI development mode both require Ollama with **Qwen2.5-VL 7B**.

### 1. Install Ollama

Download from [https://ollama.com/download](https://ollama.com/download) and install for your OS.

Verify:
```bash
ollama --version
```

### 2. Pull the Model

The production model is `qwen2.5vl:7b` (≈ 6 GB, Q4_K_M quantized, vision-capable). The Ollama registry name has **no hyphen** — the previously documented `qwen2.5vl:7b` tag does not exist and `ollama pull` fails on it.

```bash
ollama pull qwen2.5vl:7b
```

For machines with < 12 GB RAM, a smaller variant is acceptable for development (pair with `VYRIX_MODEL=qwen2.5vl:3b`):
```bash
ollama pull qwen2.5vl:3b
```

> Low-RAM dev machines can also set `VYRIX_NUM_CTX=2048` and `VYRIX_MAX_IMAGE_DIM=512` to run live checks without swapping. Project defaults (7B @ 8192 ctx) are unchanged by these env vars.

### 3. Verify Installation

```bash
ollama list                    # should show qwen2.5vl:7b
ollama run qwen2.5vl:7b "Say hi in JSON: {\"ok\":true}"
```

Ollama must be running before calibration (`ollama serve`).

### 4. Run Calibration Suite

```bash
cd electron/ai
npm install       # installs tsx if not already present

# Full suite (all 16 phases, ~20–35 min on a mid-range laptop; phases 12-16 require live model)
npm run calibrate

# Single phase
npm run calibrate:phase -- 01
npm run calibrate:phase -- 01 02 05

# Beta-2 phases only
npm run calibrate:phase -- 12 13 14 15 16

# With custom Ollama URL or model
OLLAMA_BASE_URL=http://192.168.1.10:11434 VYRIX_MODEL=qwen2.5vl:7b npm run calibrate
```

Results are written to `electron/ai/calibration/results/`:
- `01-setup.json` through `10-e2e.json` — per-phase results
- `summary.json` — merged pass/fail totals

### 5. Interpreting Results

Each result file contains:
```json
{
  "phase": "01-setup",
  "passRate": "83%",
  "avgLatency": "1240ms",
  "cases": [
    { "name": "basic-inference", "passed": true, "latencyMs": 1180, "notes": "parsed ok" }
  ]
}
```

**Pass rate < 80%** on phases 02–05 → prompt templates need adjustment.
**Pass rate < 80%** on phase 03 → GBNF grammar has a syntax error (run with sidecar active).
**All phases passing** → system is production-ready for that model.

---

## 13b. Calibration Status

> **Last updated:** 2026-08-11 — Beta-2 phases (12–16) live-validated for the first time: **96 % (27/28)** across phases 01, 02, 12, 13, 14, 15, 16 on `qwen2.5vl:7b`, plus a live Main-vs-POP persona check (PASS).
> The single failure is phase 15's ambiguous partial-completion case: the Q4 model occasionally emits `is_complete` as a non-boolean. Production is protected by AJV schema validation (clean error, no corrupt state); the permanent fix is GBNF grammar enforcement via the llama.cpp sidecar, or the QLoRA fine-tune in `training/`. See INTEGRATION.md §9.

| Phase | Description | Passed | Total | Pass Rate | Avg Latency | Notes |
|---|---|---|---|---|---|---|
| 01 | Model installation & health | 6 | 6 | **100 %** | 6 388 ms | Model resolved via fuzzy alias (`qwen2.5vl`) |
| 02 | JSON schema outputs (all 6 types) | 6 | 6 | **100 %** | 24 644 ms | All schema types valid |
| 03 | GBNF grammar validation | 0 | 3 | ⚠ **0 %** | — | **Environmental** — sidecar not running. See §13b-fix below. |
| 04 | Prompt template calibration | 5 | 5 | **100 %** | 12 920 ms | All prompt variants passing |
| 05 | Memory distillation accuracy | 6 | 6 | **100 %** | 11 620 ms | Key/value extraction correct |
| 06 | Adaptive interview flow | 7 | 7 | **100 %** | 52 458 ms | All 6 steps + extraction accumulation |
| 07 | Planning generation quality | 3 | 3 | **100 %** | 96 188 ms | Generation, refinement, vague-input |
| 08 | Evaluation framework scoring | 6 | 6 | **100 %** | 35 970 ms | ✅ Fixed — scoring rubric + explicit floor added to `partial-step` test prompt |
| 09 | Vision pipeline validation | 5 | 5 | **100 %** | 11 581 ms | Ollama-native format confirmed working |
| 10 | End-to-end workflow | 10 | 10 | **100 %** | 29 373 ms | Full interview → planning → chat → memory |
| 11 | Benchmark (latency, throughput) | 8 | 8 | **100 %** | 21 338 ms | All latency + streaming benchmarks pass |
| 12 | Mission classification | 4 | 4 | **100 %** | 42 364 ms | ✅ Fixed — added subject/project definitions to test prompt |
| 13 | Desirability evaluation | 3 | 3 | **100 %** | 76 074 ms | ✅ Fixed — added explicit low-score anchor for vague problems |
| 14 | DVF evaluation | 3 | 3 | **100 %** | — | All 3 dimensions present, score direction correct |
| 15 | Progress evaluation | 3 | 3 | **100 %** | — | Score direction correct, partial ≥ 30 rubric holds |
| 16 | Decision engine | 3 | 3 | **100 %** | — | CONTINUE / IMPROVE / REDESIGN all correct |

---

### Phase 03 — GBNF Grammar Enforcement (sidecar required)

Phase 03 will always report **0 %** when run against Ollama. Ollama does not support the `grammar` parameter — grammar enforcement requires the llama.cpp sidecar (`llama-server`) running on port 8765.

**To pass phase 03, run the sidecar manually:**

**Step 1 — Download the GGUF model** (if not already present):
```bash
pip install huggingface_hub
huggingface-cli download bartowski/Qwen2.5-VL-7B-Instruct-GGUF \
  --include "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" \
  --local-dir ~/.vyrix/models
mv ~/.vyrix/models/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf \
   ~/.vyrix/models/qwen2.5-vl-7b-q4_k_m.gguf
```

On Windows:
```powershell
huggingface-cli download bartowski/Qwen2.5-VL-7B-Instruct-GGUF `
  --include "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" `
  --local-dir "$env:USERPROFILE\.vyrix\models"
Rename-Item "$env:USERPROFILE\.vyrix\models\Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" `
            "qwen2.5-vl-7b-q4_k_m.gguf"
```

**Step 2 — Download `llama-server`** from the [llama.cpp releases page](https://github.com/ggerganov/llama.cpp/releases/latest). On Windows, download `llama-<version>-bin-win-avx2-x64.zip` (or `noavx` for older CPUs) and extract `llama-server.exe`.

**Step 3 — Start the sidecar** (in a separate terminal):
```bash
# macOS / Linux
llama-server --model ~/.vyrix/models/qwen2.5-vl-7b-q4_k_m.gguf   --host 0.0.0.0 --port 8765 --ctx-size 8192 --n-gpu-layers 0
```
```powershell
# Windows
.\llama-server.exe --model "$env:USERPROFILE\.vyrix\models\qwen2.5-vl-7b-q4_k_m.gguf" `
  --host 0.0.0.0 --port 8765 --ctx-size 8192 --n-gpu-layers 0
```
Wait for: `llama server listening at http://0.0.0.0:8765`

**Step 4 — Run phase 03 against the sidecar:**
```bash
SIDECAR_BASE_URL=http://localhost:8765 npm run calibrate:phase -- 03
```

Alternatively, use the Docker sidecar profile (see §13c), which handles the binary automatically.

---

**Root causes of the 3 prompt-level fixes (phases 08, 12, 13):** all three calibration test prompts called `call()` directly without including the guidance that lives in the production templates. The production code was correct; the test prompts were underspecified. See `PRODUCTION-READINESS.md` §2 for the full bug list (13 bugs fixed across all sessions). Benchmark latencies are from a mid-range laptop (no GPU); expect 3–5× faster with NVIDIA GPU passthrough in Docker.

---

## 13c. Docker Environment

The full project is containerised via `docker/docker-compose.yml`. Six services cover every development scenario. All commands run from the **repo root**.

### Services

| Service | Profile | Purpose |
|---|---|---|
| `ollama` | _(always on)_ | Ollama inference server — required for all AI work |
| `calibrate` | _(default)_ | Runs the full 16-phase calibration suite |
| `test` | `test` | Unit tests only — no Ollama, no model required |
| `dev` | `dev` | Interactive Node.js shell with Ollama available |
| `training` | `training` | Python 3.11 environment for QLoRA dataset prep and model merge |
| `llama-server` | `sidecar` | llama.cpp sidecar — required for GBNF grammar enforcement (phase 03) |

### Quick start — calibration

```bash
# Full 16-phase calibration suite (~20-35 min first run; model pulled automatically)
docker compose -f docker/docker-compose.yml up --abort-on-container-exit

# Results land in docker/calibration-results/

# Single phase
docker compose -f docker/docker-compose.yml run --rm calibrate   npx tsx electron/ai/calibration/phases/08-evaluation.ts

# Custom model tag
VYRIX_MODEL=qwen2.5vl:3b docker compose -f docker/docker-compose.yml up --abort-on-container-exit
```

### Unit tests (no model required)

```bash
docker compose -f docker/docker-compose.yml --profile test run --rm test
```

Runs `npm run test:unit` — deterministic tests only. No Ollama, no GGUF, no network. Useful in CI.

### Interactive dev shell

```bash
docker compose -f docker/docker-compose.yml --profile dev run --rm dev
# Inside the container:
cd electron/ai && npm run calibrate:phase -- 08 12 13
cd electron/ai && npx tsx some/script.ts
```

Source files are live-mounted — edits on the host are reflected immediately. `node_modules` stay from the build layer (avoids cross-platform native binary issues).

### Training environment

```bash
# Prepare dataset from calibration results
docker compose -f docker/docker-compose.yml --profile training run --rm training   python training/scripts/prepare_dataset.py

# Merge LoRA adapter into base model (after training on GPU machine)
docker compose -f docker/docker-compose.yml --profile training run --rm training   python training/scripts/merge_adapter.py     --adapter /models/qlora_adapter     --base Qwen/Qwen2.5-VL-7B-Instruct     --output /models/vyrix-qwen-merged
```

> **⚠️ Important — QLoRA training RAM/VRAM requirement:**
> `train_qlora.py` requires a CUDA GPU with **24 GB+ VRAM**. It will fail at runtime on a CPU-only machine. `prepare_dataset.py` and `merge_adapter.py` are fully CPU-compatible and run fine in this container. For actual training, copy the prepared dataset to a capable machine and run `train_qlora.py` there with the GPU `deploy` block uncommented in the compose file.

Hugging Face model downloads are cached to `GGUF_MODELS_PATH/hf-cache` on the host so they survive container restarts.

### Grammar enforcement tests (sidecar profile)

Phase 03 tests GBNF grammar enforcement, which requires llama.cpp. Ollama does **not** support GBNF.

**Step 1 — Download the GGUF model** (one-time, ~4.7 GB):

```bash
# macOS / Linux
pip install huggingface_hub
huggingface-cli download bartowski/Qwen2.5-VL-7B-Instruct-GGUF   --include "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf"   --local-dir ~/.vyrix/models
mv ~/.vyrix/models/Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf    ~/.vyrix/models/qwen2.5-vl-7b-q4_k_m.gguf
```

```powershell
# Windows
huggingface-cli download bartowski/Qwen2.5-VL-7B-Instruct-GGUF `
  --include "Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" `
  --local-dir "$env:USERPROFILE\.vyrix\models"
Rename-Item "$env:USERPROFILE\.vyrix\models\Qwen2.5-VL-7B-Instruct-Q4_K_M.gguf" `
            "qwen2.5-vl-7b-q4_k_m.gguf"
```

**Step 2 — Run with the sidecar profile:**

```bash
GGUF_MODELS_PATH=~/.vyrix/models   docker compose -f docker/docker-compose.yml --profile sidecar up --abort-on-container-exit
```

The sidecar container (`vyrix-llama`) serves `http://llama-server:8765` inside Docker. Phase 03 reads `SIDECAR_BASE_URL` and routes grammar calls there automatically.

### Environment variables

| Variable | Default | Purpose |
|---|---|---|
| `OLLAMA_MODELS_PATH` | `~/.ollama` | Host path for Ollama model storage |
| `GGUF_MODELS_PATH` | `~/.vyrix/models` | Host path for GGUF model + HF cache (must contain `qwen2.5-vl-7b-q4_k_m.gguf`) |
| `VYRIX_MODEL` | `qwen2.5vl:7b` | Ollama model tag |
| `HF_HOME` | `/models/hf-cache` | Hugging Face cache dir inside training container |

### NVIDIA GPU passthrough

Uncomment the `deploy` block under the `ollama` service for inference acceleration. Uncomment the `deploy` block under the `training` service for QLoRA training. Both require `nvidia-container-toolkit` on the host.

### Key implementation notes

The `calibrate` service mounts only the directories that change during iteration (`calibration/`, `prompt/`, `schemas/`, `grammars/`) — not the entire `electron/ai/`. This prevents the volume mount from shadowing the `node_modules` installed during `docker build`, which is a common source of "module not found" errors with native packages (e.g. `sharp`, `pdf-parse`). The `dev` and `test` services mount the full `electron/ai/` but use an anonymous volume (`/app/electron/ai/node_modules`) to keep the container's `node_modules` intact.

---

## 14. What Still Needs To Be Done

The AI subsystem (`electron/ai/`) is complete — v1 (27 modules) and v2 Beta-2 (7 new modules) are fully implemented and calibrated at **96 % overall** (78/81 across 16 phases; 100 % excluding the sidecar-only phase 03). The following work remains before Vyrix Beta-2 can be run end-to-end.

### Priority 1 — Electron Shell (Blocking)

These are required before any end-to-end testing is possible.

| Task | File(s) to Create | Notes |
|---|---|---|
| App entry point | `electron/main.js` | `app.whenReady()`, `BrowserWindow`, menu setup |
| contextBridge preload | `electron/preload.js` | Exposes `window.vyrix` matching `electron.d.ts` exactly |
| Wire AI IPC | `electron/main.js` | `AiContainer.create()` → `AiIpcHandlers.register()` |
| Projects IPC handlers | `electron/ipc/projects.js` | `ipc.projects.*` — create/read/update/delete/move/star |
| Folders IPC handlers | `electron/ipc/folders.js` | `ipc.folders.*` |
| Flows/Aspects IPC handlers | `electron/ipc/aspects.js` | `ipc.aspects.*` (keyword pipeline) |
| Auth IPC handlers | `electron/ipc/auth.js` | `ipc.auth.*` — Clerk PKCE integration |
| Window management | `electron/windows/` | Focus, minimize, close, tray |
| `package.json` (root Electron) | `package.json` | electron, electron-builder as devDeps |

### Priority 1a — Grammar Enforcement (Sidecar Setup)

Phase 03 of the calibration suite currently reports 0 % because Ollama does not support GBNF grammars. Grammar enforcement is only possible via the llama.cpp sidecar (`LlamaSidecar.ts`, port 8765).

To get phase 03 passing:
1. Download the GGUF model (see §13b — Phase 03 sidecar instructions).
2. Run calibration with the sidecar profile: `GGUF_MODELS_PATH=~/.vyrix/models docker compose -f docker/docker-compose.yml --profile sidecar up --abort-on-container-exit`
3. Or, run the sidecar directly: `llama-server --model ~/.vyrix/models/qwen2.5-vl-7b-q4_k_m.gguf --host 0.0.0.0 --port 8765 --ctx-size 8192`

In the full Electron app, `AiContainer` spawns `LlamaSidecar` automatically if the GGUF path and binary path are provided in `AiContainerOptions`. The sidecar binary is not yet bundled (see Priority 2).

### Priority 2 — Model Download & First-Run Setup (End-User Installer)

The GGUF model (~4.7 GB) cannot be bundled in the installer — every user who installs Vyrix must download it on first launch. This work is about building that end-user experience, not the developer setup (which is covered in §13a).

| Task | Notes |
|---|---|
| First-run wizard | Detect whether `qwen2.5-vl-7b-q4_k_m.gguf` exists in the user's app data; show download UI if not |
| Model downloader | In-app download of `qwen2.5-vl-7b-q4_k_m.gguf` for each new user (~4.7 GB, needs resume support) |
| llama-server binary | Bundle pre-built `llama-server` for macOS arm64, macOS x64, Windows x64 inside the installer |
| Hardware detection on first run | Detect GPU, set optimal `llama-server` flags (e.g., `-ngl`), write to `settings.json` |

### Priority 3 — Integration & Testing

| Task | Notes |
|---|---|
| End-to-end smoke test | Full flow: create project → interview → planning → chat → memory |
| IPC contract conformance test | Verify `AiIpcHandlers` return shapes match `electron.d.ts` exactly |
| Interview engine integration test | Complete 6-step interview with a real or mock model |
| Memory distillation integration test | Verify keyword + memory extraction after N conversation turns |
| ContextInjector accuracy test | Verify correct project is inferred from message content |

### Priority 4 — Packaging & Distribution

| Task | Notes |
|---|---|
| `electron-builder` config | `electron-builder.yml` — targets: dmg (macOS), nsis (Windows) |
| Code signing | macOS notarisation, Windows Authenticode |
| Auto-updater | `electron-updater` with DigitalOcean Spaces as update server |
| Installer includes llama-server binary | Bundle in `resources/bin/` |

### Priority 5 — Missing AI Features (Nice-to-Have for Beta)

| Feature | Module | Status |
|---|---|---|
| Interview state persistence (save/resume) | `ProjectStateManager` | Needs wiring in Electron main |
| Streaming interview responses | `AdaptiveInterviewEngine` | Currently non-streaming |
| Generative UI rendering | Renderer: `ai/page.tsx` | Schema + IPC ready; UI renderer not built |
| Save-to-aspects from AI chat | `ipc.aspects.addKeyword` | UI button exists in reference; IPC not wired |
| Memory approval notification | Renderer push event | Architecture designed; event not wired |
| Vision attachment in chat | `VisionProcessor` | Module ready; UI file picker not wired |
| ContextInjector Beta-2 fields | `context/ContextInjector.ts` | `workflow_state`, `dvf_evaluations`, `decision` not yet injected into context |
| QLoRA fine-tuning | `training/scripts/` | Scaffold ready; `training` Docker service handles prep+merge on CPU; `train_qlora.py` requires 24GB+ VRAM on a GPU machine |
| Beta-2 renderer IPC bindings | `src/lib/electron.d.ts` + `ipc.ts` | 13 new channels need renderer-side type bindings (in reference repo — coordinated change) |

---

## 14a. Beta-2 Product Workflow

The Beta-2 workflow is the product-level state machine that replaces the original interview-only flow for all new missions. Every project now passes through mission classification before entering either the subject/module path or the full project path.

### Workflow Overview

```
User message
  ↓
MissionClassifier  →  mission_type: "project" | "subject"
  ↓
MissionWorkflowEngine (24-state machine)
  │
  ├── SUBJECT path:
  │     Subject detection → Outcome confirmation → Flow creation → AI assistance
  │
  └── PROJECT path:
        Project Goal capture
          ↓
        End Goal capture
          ↓
        DesirabilityEvaluator  (initial demand/problem clarity check)
          ↓  score ≥ 40 → ready_for_ideation: true
        AiPlanningEngine.generate()  (roadmap to ideation)
          ↓
        ROADMAP_REVIEW  ←─── RoadmapVersioning.refineWithHistory()
          ↓  user approves
        PROJECT_EXECUTION  (repeated progress validation loops)
          ↓
        ProgressEvaluator  (score ≥ 60 → advance; < 60 → PROGRESS_CORRECTION)
          ↓  all steps complete
        IDEATION → IDEATION_READY
          ↓
        DVFEvaluator  (Desirability × 0.4 + Viability × 0.3 + Feasibility × 0.3)
          ↓
        DecisionEngine
          ├── CONTINUE  (score ≥ 70)  → FINAL_ROADMAP → EXECUTION
          ├── IMPROVE   (score 40–69) → IMPROVEMENT
          └── REDESIGN  (score < 40 or any dim < 25) → REDESIGN
```

### State Machine Rules

- All 24 states are defined in `MissionWorkflowState` (union type in `project/types.ts`).
- Transitions are enforced by a flat `VALID_TRANSITIONS: Record<MissionWorkflowState, MissionWorkflowState[]>` lookup table.
- `canTransition(from, to)` is a pure guard — returns `boolean`, never throws.
- State is persisted into `project.json` via `ProjectStateManager.updateMeta()` after every transition.
- The engine never writes raw transitions directly — all state changes go through the private `transition()` method which validates, updates state, and persists in a single operation.

### DVF Formula

```
overall_score = desirability.score × 0.4
             + viability.score    × 0.3
             + feasibility.score  × 0.3
```

### Roadmap Versioning

Every call to `MissionWorkflowEngine.refineRoadmap()` snapshots the current roadmap before refinement:

```json
{
  "version": 2,
  "timestamp": "2026-08-08T12:00:00Z",
  "roadmap": [...previous steps...],
  "user_feedback": "Add a competitor analysis step",
  "previous_version": 1
}
```

Snapshots are appended to `project.json` under `roadmap_versions[]` and are never deleted.

### Extended ProjectMeta (Beta-2 fields)

All 13 new fields are optional and additive — existing projects without Beta-2 data are fully backward compatible:

| Field | Type | Purpose |
|---|---|---|
| `workflow_state` | `MissionWorkflowState` | Current state machine position |
| `mission_type` | `"project" \| "subject"` | Classification result |
| `mission_classification` | `MissionClassification` | Full classification object |
| `project_goal` | `ProjectGoal` | Captured problem + constraints |
| `end_goal` | `EndGoal` | User's desired final deliverable |
| `initial_desirability` | `DesirabilityResult` | First desirability evaluation |
| `dvf_evaluations` | `DVFResult[]` | Append-only DVF history |
| `decision` | `DecisionResult` | Final CONTINUE/IMPROVE/REDESIGN |
| `roadmap_versions` | `RoadmapVersion[]` | All roadmap snapshots |
| `ideation_state` | `IdeationState` | Ideation phase tracking |
| `workflow_updated_at` | `string` | ISO timestamp of last state change |
| `workflow_error` | `string` | Last error (if any) |
| `subject_outcomes` | `string[]` | Subject/module expected outcomes |

---

## 15. Coding Standards

### TypeScript

- Strict mode enabled. No `any` types. No type assertions without documented justification.
- Use `unknown` and type guards instead of `any` for external data.
- All IPC return shapes must match `electron.d.ts` exactly.
- Export named types alongside implementation — no anonymous inline types in function signatures.

### IPC Safety Pattern (Renderer)

```typescript
// Always guard IPC calls in the renderer
if (!ipc.isElectron()) {
  // fallback or silent no-op with comment explaining why
  return;
}
const result = await ipc.ai.health().catch(console.error);
```

### React Components

- All interactive components must have `"use client"` as their first line.
- Never import from `electron`, `fs`, `path`, `child_process`, or any Node.js built-in.
- Components exceeding ~300 lines should be split into sub-components.
- CSS variable tokens only — never hardcode `#hex` or `rgb()` values.

### File Naming

| Type | Convention | Example |
|---|---|---|
| React components | PascalCase | `MissionPage.tsx` |
| Lib utilities | camelCase | `streamAi.ts` |
| Main process modules | PascalCase | `PromptEngine.ts` |
| Test files | `<name>.test.ts` | `MemoryEngine.test.ts` |
| Schema files | kebab-case | `interview-step.schema.json` |
| Grammar files | kebab-case | `interview-step.gbnf` |

### Error Handling

- IPC handlers must never throw — always return `{ ok: false, error: string }`.
- Never `console.error` for expected IPC failures in the renderer — surface to user or swallow with a comment.
- Main process: log diagnostics to a file channel, not stdout (which the sidecar also uses).
- All AI module methods must be async-safe — use `Promise.allSettled` for fire-and-forget parallel operations.

### Comments

- Comment the *why*, not the *what*.
- All public methods in main-process modules must have JSDoc.
- Complex logic (LRU eviction, token budget, circuit-breaker, GBNF assembly) must have inline explanation.

---

## 16. Contributing

### Branching Strategy

```
main              — stable, always deployable
dev               — active development integration branch
feature/<name>    — feature branches
fix/<name>        — bug fix branches
ai/<module-id>    — AI subsystem module branches (e.g., ai/M17-interview-engine)
```

### Pull Request Requirements

1. Title format: `[M17] AdaptiveInterviewEngine` for module work, `[fix] Sidebar overflow` for UI fixes.
2. PRs targeting AI modules must reference `AI-MODULE-ROADMAP.md`.
3. New modules need: implementation file + test file + any schema/grammar files.
4. Changes to `src/lib/electron.d.ts` or `src/lib/ipc.ts` require a coordinated update to all affected IPC handlers in the same PR.
5. All unit tests must pass. Integration tests may be skipped in CI if `ENABLE_INTEGRATION_TESTS` is not set.

### Adding a New Module

1. Add a spec to `AI-MODULE-ROADMAP.md` following the existing format.
2. Identify all dependencies and update the dependency graph.
3. Confirm the implementation order doesn't violate a tier boundary.
4. Get spec reviewed before writing implementation code.

### Architecture Decision Records

Non-trivial architectural choices (storage format changes, token estimation algorithm changes, LRU strategy changes) should have a brief ADR entry added to `AI-MODULE-ROADMAP.md` before implementation.

---

## 17. Memory & Performance Profile

### Target Hardware

16 GB RAM laptop (MacBook Pro M2 / Windows equivalent). Must coexist with heavy creative tools simultaneously (Figma, Adobe, browser with 10+ tabs).

### RAM Allocation

| Component | Allocation |
|---|---|
| Electron (Chromium + Node.js Main + Renderer) | ~120–180 MB |
| Node.js AI subsystem (logs, JSON, prompt construction) | ~10–20 MB |
| Qwen2.5-VL 7B Q4_K_M GGUF weights | ~4.7–5.0 GB |
| llama.cpp KV Cache (8192 ctx) | ~1.0 GB |
| OS headroom | ~0.5 GB |
| **Total system footprint** | **~6.0–6.3 GB** |

### Performance Targets

| Operation | Target |
|---|---|
| App cold start to interactive | < 4 seconds |
| llama.cpp sidecar ready after launch | < 8 seconds |
| First token latency (streaming) | < 2 seconds |
| File extraction (5-page PDF) | < 1 second |
| `ContextBuilder.build()` | < 50 ms |
| `KeywordRepository` read/write | < 10 ms |
| `MemoryEngine.compileState()` (100 deltas) | < 5 ms |

---

## 18. Glossary

| Term | Definition |
|---|---|
| **Mission** | A project in Vyrix. Called "project" in the code; "Mission" in the UI. |
| **Flow** | A research phase within a Mission (e.g., "Primary Research", "Wireframes"). |
| **Aspect** | The keyword pipeline associated with a Flow. `ipc.aspects.*` manages keywords per flow. |
| **Keyword** | A domain-specific term tracked with a timestamp in `keywords.json` for LRU context injection. |
| **Global Memory** | The `global-memory.log` append-only delta log. Stores high-level project decisions. |
| **LRU Decay** | Least Recently Used — the strategy for dropping old keywords when context window budget is exceeded. |
| **Context Injection** | Building a system prompt prefix from project memory and keywords before every inference call. |
| **IPC** | Inter-Process Communication — the message-passing channel between Electron renderer and main processes. |
| **Sidecar** | The `llama-server` process managed as a Node.js `child_process`. Runs alongside the app. |
| **GBNF** | Grammar format used by llama.cpp to constrain model output to valid JSON matching a defined schema. |
| **GGUF** | Model file format used by llama.cpp. All model weights are distributed as `.gguf` files. |
| **Context Window** | Maximum tokens the model can process in one call. Capped at 8192 in Vyrix. |
| **Distillation** | Background extraction of keywords and memory deltas from a completed conversation turn. |
| **Interview** | The 6-step adaptive onboarding flow that runs when a new Mission is created. |
| **Roadmap** | The 5–10 step project execution plan generated by the AI Planning Engine during the interview. |
| **Token Budget** | The constraint that system prompt + history + user message must not exceed 8192 tokens. |
| **`window.vyrix`** | The Electron `contextBridge` object exposing the main process API to the renderer. Typed in `electron.d.ts`. |
| **Circuit-Breaker** | The pattern in `ModelRouter` that switches to Ollama after 3 consecutive sidecar failures. |
| **Fire-and-Forget** | An async operation that is deliberately not awaited (e.g., `MemoryDistillation.distill()`). |
| **AiContainer** | The DI composition root that wires and holds all AI module singletons. |
| **TaskType** | One of 12 enum values identifying which schema/grammar pair to use for an inference call (7 v1 + 5 v2). |
| **MissionWorkflowState** | One of 24 string states tracking where a project is in the Beta-2 lifecycle. |
| **DVF** | Desirability / Viability / Feasibility — the three-dimension framework used to evaluate a project after ideation. |
| **DVF Score** | Weighted composite: D × 0.4 + V × 0.3 + F × 0.3. Range 0–100. |
| **Desirability Evaluation** | The lightweight initial check (score ≥ 40 → proceed to ideation) run before any roadmap is generated. Distinct from DVF. |
| **Decision Engine** | The module that routes a project to CONTINUE (≥70), IMPROVE (40–69), or REDESIGN (<40 or any dim <25) after DVF. |
| **RoadmapVersioning** | Wrapper around `AiPlanningEngine.refine()` that snapshots the previous roadmap before every refinement call. |
| **Scoring Rubric** | The 6-band rubric (0-10 / 11-29 / 30-50 / 51-74 / 75-89 / 90-100) used by `stepCompletionEvalPrompt` and `ProgressEvaluator`. Guarantees partial attempts score ≥ 30. |
| **QLoRA** | Quantised Low-Rank Adaptation — the fine-tuning method used to adapt Qwen2.5-VL 7B to Vyrix-specific tasks. Requires 24GB+ VRAM. |
| **EvidenceType** | `"evidence" \| "assumption" \| "unknown" \| "requires_validation"` — the tag applied to every finding in desirability and DVF evaluations. |
| **EndGoal** | The user's desired final deliverable for a project (prototype, research report, proof of concept, etc.). Captured before desirability evaluation. |
| **Subject/Module** | A mission type where the goal, methodology, and expected outcomes are predefined (e.g., following an AWS certification curriculum). Routed to the subject branch of the Beta-2 workflow. Contrast with **Project**. |
| **Project** (mission type) | A mission type where the solution must be discovered. Has a problem statement, constraints, and an outcome that is not predetermined. Routed to the full DVF workflow. Contrast with **Subject/Module**. |
| **ProjectGoal** | Structured capture of a project's problem statement, target outcome, constraints, and available resources. Written to `project.json` before desirability evaluation. |
| **MissionClassifier** | The M23 module that determines whether a new mission is a Project or Subject/Module. Returns a `MissionClassification` object with `mission_type`, `confidence`, and extracted goals/constraints. |
| **IdeationState** | Object tracking the ideation phase inside a project: concept list, selected concept, and ideation completion flag. Stored under `project.json → ideation_state`. |
| **ProgressEvaluator** | The M27 module that scores a completed project step (0–100) using the 6-band rubric. A score ≥ 60 advances the workflow; < 60 triggers `PROGRESS_CORRECTION`. |

---

*Vyrix Beta-2 — Built for thinkers. Runs locally. Stays private.*
