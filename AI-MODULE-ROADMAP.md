# Vyrix Beta-2 — AI Subsystem Module Roadmap

**Document Version:** 1.0  
**Last Updated:** 2026-08-05  
**Author:** AI Architecture Division  
**Status:** Active — Authoritative Implementation Reference

---

## Overview

This document is the single source of truth for the decomposition, ordering, and specification of every module inside the Vyrix Beta-2 AI subsystem. It lives inside the Electron main process (`electron/ai/`) and is completely invisible to the React renderer, which communicates with it exclusively through the typed IPC bridge defined in `src/lib/ipc.ts` and `src/lib/electron.d.ts`.

The goal of this roadmap is to eliminate integration risk by building the subsystem in dependency-correct order — each module is independently testable before the modules that depend on it are written.

---

## Architectural Boundaries

```
┌─────────────────────────────────────────────────────────────┐
│  RENDERER PROCESS  (src/)                                    │
│  React + Next.js — presentation only                        │
│  Calls: ipc.ai.*, ipc.aspects.*, ipc.projects.*             │
└──────────────────────┬──────────────────────────────────────┘
                       │  window.vyrix  (Electron contextBridge)
┌──────────────────────▼──────────────────────────────────────┐
│  MAIN PROCESS  (electron/)                                   │
│  IPC Handlers → AI Subsystem modules                        │
│                                                             │
│  ┌─────────┐  ┌────────────┐  ┌──────────────────────────┐ │
│  │ Storage │  │   Prompt   │  │  Conversation / Memory   │ │
│  │  Layer  │  │   System   │  │        System            │ │
│  └─────────┘  └────────────┘  └──────────────────────────┘ │
│                                                             │
│  ┌──────────────────┐  ┌────────────────────────────────┐  │
│  │  Interview /     │  │  Multimodal Processing         │  │
│  │  Planning / Eval │  │  (Vision + File Extraction)    │  │
│  └──────────────────┘  └────────────────────────────────┘  │
└──────────────────────┬──────────────────────────────────────┘
                       │  child_process  (stdin/stdout)
┌──────────────────────▼──────────────────────────────────────┐
│  llama.cpp SIDECAR                                          │
│  Qwen2.5-VL 7B Q4_K_M · GBNF-constrained · 8192 ctx        │
└─────────────────────────────────────────────────────────────┘
```

---

## Dependency Graph

```
Tier 0 (Foundation — No AI Dependencies)
├── M00: JSON Schema & GBNF Grammar Definitions
├── M01: Project State Manager
├── M02: Message Store
├── M03: Memory Engine
└── M04: Keyword Repository

Tier 1 (Core AI Infrastructure)
├── M05: llama.cpp Sidecar Manager       ← depends on M00
├── M06: Ollama Adapter                  ← no deps (HTTP only)
└── M07: LRU Optimizer                   ← depends on M04

Tier 2 (Context System)
├── M08: Context Builder                 ← depends on M03, M04, M07
└── M09: Model Router                    ← depends on M05, M06

Tier 3 (Prompt System)
├── M10: Prompt Templates                ← depends on M00
├── M11: Grammar Registry               ← depends on M00, M05
├── M12: Prompt Compiler                ← depends on M08, M10, M11
└── M13: Prompt Engine                  ← depends on M09, M12

Tier 4 (Conversation & Memory Intelligence)
├── M14: Conversation State Manager     ← depends on M02, M03
├── M15: Memory Distillation            ← depends on M13, M04
└── M16: Context Injector               ← depends on M08, M12

Tier 5 (High-Level AI Features)
├── M17: Adaptive Interview Engine      ← depends on M01, M13, M14, M15, M16
├── M18: AI Planning Engine             ← depends on M13, M16, M17
└── M19: AI Evaluation Framework        ← depends on M13, M14, M18

Tier 6 (Multimodal)
├── M20: File Extractor                 ← depends on M00
└── M21: Vision Processor               ← depends on M09, M20

Tier 7 (Quality Assurance)
└── M22: Testing Framework              ← depends on all above
```

---

## Module Specifications

---

### M00 — JSON Schema & GBNF Grammar Definitions

**Directory:** `electron/ai/schemas/` · `electron/ai/grammars/`

**Purpose**  
Defines all structured output contracts used by the AI subsystem. Every llama.cpp inference call is constrained by a GBNF grammar that forces valid JSON output, eliminating brittle text-parsing. JSON Schemas provide the parallel validation layer used by Node.js after receiving model output.

**Responsibilities**
- Define GBNF grammar files for each AI task type (interview steps, memory deltas, planning output, keyword extraction, evaluation responses)
- Define JSON Schema files that mirror each grammar, used for post-inference validation via `ajv`
- Export TypeScript interfaces generated from each schema
- Provide a schema-to-grammar consistency check utility

**Dependencies**  
None. This is the absolute foundation — nothing else can be built until output contracts are defined.

**Files to Deliver**
```
electron/ai/schemas/
├── interview-step.schema.json       # Per-step interview response
├── interview-plan.schema.json       # 10-step roadmap output
├── memory-delta.schema.json         # global-memory.log delta update
├── keyword-extraction.schema.json   # distilled keywords from AI response
├── evaluation-result.schema.json    # step validation output
├── context-resolve.schema.json      # @-mention resolution output
└── generative-ui.schema.json        # structured UI component payloads

electron/ai/grammars/
├── interview-step.gbnf
├── interview-plan.gbnf
├── memory-delta.gbnf
├── keyword-extraction.gbnf
├── evaluation-result.gbnf
├── context-resolve.gbnf
└── generative-ui.gbnf

electron/ai/types/
└── ai-schemas.d.ts                  # TypeScript interfaces derived from schemas
```

**Estimated Complexity:** Low-Medium  
Schema writing is deliberate but not algorithmically complex. The constraint is getting grammar correctness right — GBNF has strict syntax rules that must be validated against llama.cpp's parser.

**Implementation Order:** 1st — Must be complete before any other module begins.

**Testing Strategy**
- Unit: Validate each `.gbnf` file parses without error using llama.cpp's `--grammar-file` flag in a minimal test harness
- Unit: Validate each `.schema.json` against its corresponding sample output fixture using `ajv`
- Contract: For every grammar, generate 10 sample outputs from the model and assert all pass schema validation
- Regression: Add each validated sample to a fixture file; re-run on grammar edits

---

### M01 — Project State Manager

**Directory:** `electron/ai/project/ProjectStateManager.ts`

**Purpose**  
Manages the lifecycle of a project's on-disk metadata. Handles reading, writing, and updating `project.json` and `settings.json` files inside the project directory. Acts as the single authoritative source for project-level state on disk.

**Responsibilities**
- Create the project directory scaffold on new mission creation
- Read and write `project.json` (title, description, created_at, interview_completed flag)
- Read and write `settings.json` (user preferences for this project)
- Expose a typed API consumed by IPC handlers
- Emit typed events when project state changes
- Validate project directory integrity on load

**Dependencies**  
None. Pure Node.js `fs/promises` + TypeScript.

**Files to Deliver**
```
electron/ai/project/
├── ProjectStateManager.ts
├── ProjectStateManager.test.ts
└── types.ts                   # ProjectMeta, ProjectSettings interfaces
```

**Estimated Complexity:** Low  
Purely file I/O with typed wrappers. Well-understood domain.

**Implementation Order:** 1st (parallel with M00, M02, M03, M04)

**Testing Strategy**
- Unit: Create project → assert directory + files exist on disk
- Unit: Read/write round-trip for `project.json` and `settings.json`
- Unit: Corrupted JSON → assert graceful error with safe fallback
- Unit: Missing directory → assert scaffold creation
- Edge: Concurrent writes → assert last-write-wins with no corruption

---

### M02 — Message Store

**Directory:** `electron/ai/conversation/MessageStore.ts`

**Purpose**  
Manages `chat-history.log` files. Each conversation (per-topic/per-flow) has its own append-only log. The Message Store provides the primitives to append new messages and hydrate conversation history for context injection into prompts.

**Responsibilities**
- Append user and assistant messages to `chat-history.log` as newline-delimited JSON records
- Read and parse history from a log file, returning a typed `VyrixMessage[]` array
- Enforce a configurable history window (last N turns) for context hydration
- Handle log rotation when files exceed a configurable byte threshold
- Provide atomic append operations (no partial writes)

**Dependencies**  
None. Pure `fs/promises` + TypeScript.

**Files to Deliver**
```
electron/ai/conversation/
├── MessageStore.ts
├── MessageStore.test.ts
└── types.ts                   # StoredMessage, MessageRole interfaces
```

**Estimated Complexity:** Low  
Append-only log with NDJSON format. Rotation adds minor complexity.

**Implementation Order:** 1st (parallel with M00, M01, M03, M04)

**Testing Strategy**
- Unit: Append message → read back → assert round-trip fidelity
- Unit: History window enforcement — assert only last N turns returned
- Unit: Log rotation trigger — assert new file created, old archived
- Unit: Corrupted/partial last line → assert graceful skip on read
- Concurrent: Multiple appends in rapid succession → assert no corruption

---

### M03 — Memory Engine

**Directory:** `electron/ai/memory/MemoryEngine.ts`

**Purpose**  
Manages the `global-memory.log` append-only event log at the project root. This log is the project's long-term memory — a sequential record of AI-confirmed decisions, context changes, and project facts. The Memory Engine provides read (compiled state) and write (append delta) operations.

**Responsibilities**
- Append memory delta entries as `+ { "key": "value", "timestamp": "ISO" }` lines using `fs.appendFileSync` for atomicity
- Compile the full log into a current-state object by replaying all deltas in order
- Support rollback by re-compiling up to a given delta index
- Provide a token-count estimate for compiled memory (used by LRU Optimizer)
- Validate incoming delta payloads against `memory-delta.schema.json` (M00)

**Dependencies**  
M00 (schema validation for delta payloads)

**Files to Deliver**
```
electron/ai/memory/
├── MemoryEngine.ts
├── MemoryEngine.test.ts
└── types.ts                   # MemoryDelta, MemoryState interfaces
```

**Estimated Complexity:** Low-Medium  
Append is trivial. Replay-based state compilation and rollback add moderate complexity.

**Implementation Order:** 1st tier (can start after M00 schemas are drafted — does not require M00 to be complete)

**Testing Strategy**
- Unit: Append 10 deltas → compile → assert merged state is correct
- Unit: Rollback to delta 5 → assert state matches replay to that point
- Unit: Corrupted delta line → assert skip + continue replay
- Unit: Token count estimate → assert within 10% of actual tokenizer count
- Fixture: Replay a 100-delta log and assert deterministic output

---

### M04 — Keyword Repository

**Directory:** `electron/ai/memory/KeywordRepository.ts`

**Purpose**  
Manages the `keywords.json` file inside each Flow (topic) directory. Keywords are domain-specific terms extracted from conversations. Each keyword is stored with a `last_referenced` ISO timestamp, enabling LRU decay when the context window budget is exceeded.

**Responsibilities**
- Add a keyword with current timestamp; update timestamp if it already exists
- Remove a keyword by name
- Read all keywords for a given flow, sorted by `last_referenced` descending
- Detect and handle cross-flow duplicate keywords (move to correct flow on conflict)
- Refresh timestamps for all keywords injected into a prompt (called by LRU Optimizer after injection)
- Validate the `keywords.json` schema on read

**Dependencies**  
None. Pure `fs/promises` + TypeScript.

**Files to Deliver**
```
electron/ai/memory/
├── KeywordRepository.ts
├── KeywordRepository.test.ts
└── types.ts                   # KeywordRecord, KeywordMap interfaces
```

**Estimated Complexity:** Low  
JSON file CRUD with timestamp tracking. Cross-flow detection adds minor complexity.

**Implementation Order:** 1st (parallel with M00–M03)

**Testing Strategy**
- Unit: Add keyword → read back → assert present with timestamp
- Unit: Add duplicate → assert timestamp updated, not duplicated
- Unit: Remove keyword → assert absent on next read
- Unit: Cross-flow duplicate → assert moved to correct flow
- Unit: Sort order → assert descending by `last_referenced`
- Edge: Concurrent add calls → assert no race condition (use file lock)

---

### M05 — llama.cpp Sidecar Manager

**Directory:** `electron/ai/core/LlamaSidecar.ts`

**Purpose**  
Manages the full lifecycle of the `llama.cpp` server process as a Node.js `child_process`. This is the production AI inference backend for Electron builds. It launches, monitors, restarts, and gracefully shuts down the llama.cpp server, and exposes a streaming HTTP client to send inference requests to it.

**Responsibilities**
- Launch `llama-server` (or `llama.cpp` server binary) as a child_process with the correct flags:
  - `--model <path>` — path to the GGUF model file
  - `--ctx-size 8192` — context window cap
  - `--threads <N>` — auto-detect from `os.cpus()`
  - `--n-gpu-layers <N>` — GPU offload if available
  - `--grammar-file <path>` — GBNF constraint (passed per-request, not at launch)
- Monitor stdout/stderr for the ready signal (`llama server listening`)
- Restart automatically on unexpected exit (with backoff)
- Gracefully stop the process on app quit
- Expose a `complete(request: LlamaRequest): Promise<string>` method
- Expose a `stream(request: LlamaRequest, onChunk, onDone, onError)` method
- Detect hardware (RAM via `os.totalmem()`, GPU via system query) and set appropriate flags
- Expose `health(): Promise<SidecarHealth>` for the IPC `ai.health()` handler

**Dependencies**  
M00 (grammar files must exist on disk before sidecar can be pointed at them)

**Files to Deliver**
```
electron/ai/core/
├── LlamaSidecar.ts
├── LlamaSidecar.test.ts
├── HardwareDetector.ts        # RAM/GPU detection utilities
└── types.ts                   # LlamaRequest, LlamaResponse, SidecarHealth
```

**Estimated Complexity:** High  
Process lifecycle management, streaming stdout parsing, hardware detection, graceful shutdown, and restart backoff are all non-trivial. This is the most critical infrastructure module.

**Implementation Order:** 2nd tier — begin immediately after M00 schema files exist.

**Testing Strategy**
- Integration: Launch sidecar with a minimal test model → assert ready signal received
- Integration: Send a minimal prompt → assert non-empty response string returned
- Integration: Send grammar-constrained prompt → assert response is valid JSON matching schema
- Integration: Kill the process externally → assert auto-restart within 3 seconds
- Unit: Hardware detection → assert flag calculation from mocked `os.totalmem()` values
- Unit: Streaming → assert onChunk called multiple times, onDone called once, full text assembled correctly
- Shutdown: Send shutdown signal → assert child process exits cleanly (no zombie)

---

### M06 — Ollama Adapter

**Directory:** `electron/ai/core/OllamaAdapter.ts`

**Purpose**  
Provides a clean, typed HTTP client to the locally-running Ollama server. This is the development/fallback inference path used when the llama.cpp sidecar is not available (non-Electron dev mode, initial setup). It mirrors the interface of `LlamaSidecar` so that `ModelRouter` (M09) can swap between them transparently.

**Responsibilities**
- Send chat completion requests to `http://localhost:11434/api/chat`
- Support both streaming (NDJSON) and non-streaming modes
- Expose the same `complete()` and `stream()` interface as `LlamaSidecar`
- Handle Ollama-specific error states (model not found, server not running)
- Support model selection per-request
- Expose `health(): Promise<OllamaHealth>` — checks if Ollama is running and lists installed models

**Dependencies**  
None. Pure HTTP + TypeScript.

**Files to Deliver**
```
electron/ai/core/
├── OllamaAdapter.ts
├── OllamaAdapter.test.ts
└── types.ts                   # OllamaRequest, OllamaResponse, OllamaHealth
```

**Estimated Complexity:** Low  
The Next.js API route (`src/app/api/ai/chat/route.ts`) already proxies Ollama — this is a clean Node.js port of that logic with typed error handling added.

**Implementation Order:** 2nd tier (parallel with M05)

**Testing Strategy**
- Integration: Start Ollama locally → send request → assert valid response
- Unit: `health()` with Ollama down → assert error returned, not thrown
- Unit: Streaming parse → mock NDJSON stream → assert chunk/done callbacks fired correctly
- Unit: Model-not-found 404 → assert typed error with `model_not_found` code

---

### M07 — LRU Optimizer

**Directory:** `electron/ai/context/LruOptimizer.ts`

**Purpose**  
Enforces the 8192-token context window budget. When the combined token count of the system prompt, memory, and keyword context exceeds the budget, the LRU Optimizer trims the least recently used keywords until the prompt fits within the limit. After injection, it refreshes the `last_referenced` timestamps for all included keywords.

**Responsibilities**
- Accept a keyword map (from M04) and the current memory state (from M03) as input
- Estimate the token count of each component using a character-based approximation (4 chars ≈ 1 token)
- Sort keywords by `last_referenced` ascending (oldest first)
- Drop keywords from the tail until total token estimate is within budget
- Return the trimmed keyword set and a list of dropped keywords (for diagnostics)
- After a prompt is dispatched, call `KeywordRepository.refreshTimestamps()` for included keywords

**Dependencies**  
M04 (KeywordRepository — for timestamp reads and refresh)

**Files to Deliver**
```
electron/ai/context/
├── LruOptimizer.ts
├── LruOptimizer.test.ts
└── types.ts                   # TokenBudget, LruResult interfaces
```

**Estimated Complexity:** Low-Medium  
Sorting and slicing with timestamp-based LRU is straightforward. The token estimation heuristic needs calibration against actual llama.cpp tokenization.

**Implementation Order:** 2nd tier (after M04 is complete)

**Testing Strategy**
- Unit: 50 keywords within budget → assert none dropped
- Unit: 50 keywords exceeding budget → assert oldest N dropped, total estimate within limit
- Unit: Single keyword exceeding budget → assert it is included anyway (never drop below 1)
- Unit: Token estimate accuracy → compare approximation against real llama.cpp token counts for 20 sample strings, assert within 15%
- Integration: Full cycle with KeywordRepository → add keywords → optimize → assert timestamps refreshed for included set

---

### M08 — Context Builder

**Directory:** `electron/ai/context/ContextBuilder.ts`

**Purpose**  
Assembles the full context string that will be injected as the system prompt before every inference call. It reads from the Memory Engine (global project decisions) and the Keyword Repository (flow-specific terms), applies LRU optimization, and produces a formatted, token-safe context string ready for the Prompt Compiler.

**Responsibilities**
- Accept `projectId` and `flowId` as inputs
- Read compiled memory state from `MemoryEngine` (M03)
- Read keyword map for the specified flow from `KeywordRepository` (M04)
- Pass both through `LruOptimizer` (M07) to enforce token budget
- Format the result into a structured context block:
  ```
  [PROJECT CONTEXT]
  Platform: iOS · Output: Physical Prototype
  
  [ASPECT KEYWORDS — Wireframes]
  user flow, empathy map, proximity matrix, information architecture
  ```
- Return the formatted string and metadata (tokens used, keywords dropped)

**Dependencies**  
M03 (MemoryEngine), M04 (KeywordRepository), M07 (LruOptimizer)

**Files to Deliver**
```
electron/ai/context/
├── ContextBuilder.ts
├── ContextBuilder.test.ts
└── types.ts                   # ContextResult, ContextMeta interfaces
```

**Estimated Complexity:** Low-Medium  
Orchestration module — complexity comes from coordinating three dependencies correctly, not from any single algorithm.

**Implementation Order:** 3rd tier (after M03, M04, M07 are complete)

**Testing Strategy**
- Unit: Empty memory + empty keywords → assert minimal context block (not empty string)
- Unit: Memory with 5 deltas + 20 keywords within budget → assert all present in output
- Unit: Memory + 100 keywords over budget → assert LRU trimming applied, output within token limit
- Snapshot: For a canonical project fixture, assert context string is deterministic across runs
- Integration: End-to-end with real file system → create project → add memory → add keywords → build context → assert expected string

---

### M09 — Model Router

**Directory:** `electron/ai/core/ModelRouter.ts`

**Purpose**  
The single entry point for all inference calls in the system. Determines whether to route a request to the `LlamaSidecar` (M05) or the `OllamaAdapter` (M06) based on runtime availability, then dispatches the request. All higher-level modules call the Model Router — never the sidecar or adapter directly.

**Responsibilities**
- Check sidecar health on startup; fall back to Ollama if sidecar is unavailable
- Expose a unified `complete(request)` and `stream(request, callbacks)` interface
- Pass grammar files through to the sidecar for GBNF-constrained requests
- Implement a circuit-breaker: if sidecar fails 3 times in a row, fall back to Ollama for the session
- Log route decisions to a diagnostic channel (not to the renderer)
- Expose `health()` that aggregates sidecar + Ollama health and returns the active backend

**Dependencies**  
M05 (LlamaSidecar), M06 (OllamaAdapter)

**Files to Deliver**
```
electron/ai/core/
├── ModelRouter.ts
├── ModelRouter.test.ts
└── types.ts                   # RouterRequest, RouterResponse, BackendHealth
```

**Estimated Complexity:** Medium  
Circuit-breaker pattern and transparent fallback logic require careful state management.

**Implementation Order:** 3rd tier (after M05 and M06 are complete)

**Testing Strategy**
- Unit: Sidecar healthy → assert request routed to sidecar
- Unit: Sidecar down → assert request routed to Ollama
- Unit: Circuit breaker → mock 3 sidecar failures → assert subsequent requests go to Ollama
- Unit: Circuit breaker reset → mock sidecar recovery after 60s → assert routing restored
- Integration: Send 5 real requests through router with Ollama running → assert all succeed

---

### M10 — Prompt Templates

**Directory:** `electron/ai/prompt/PromptTemplates.ts`

**Purpose**  
A library of reusable, parameterized prompt templates for every AI task the system performs. Templates define the static scaffolding of a prompt; dynamic content (context, user input, history) is injected by the Prompt Compiler (M12). Templates enforce consistent tone, formatting, and output requirements across all AI interactions.

**Responsibilities**
- Define templates for all task types:
  - `INTERVIEW_STEP_1` through `INTERVIEW_STEP_6` (new mission onboarding)
  - `WORKSPACE_CHAT` (general AI tab conversation)
  - `PROJECT_CHAT` (mission-aware conversation)
  - `MEMORY_DISTILL` (keyword extraction from conversation)
  - `PLANNING_ROADMAP` (10-step project plan generation)
  - `EVALUATION_CHECK` (step validation and progress assessment)
  - `CONTEXT_RESOLVE` (@-mention resolution)
- Expose a `getTemplate(taskType, params)` function that returns a filled template string
- All templates must include an output format directive referencing the appropriate JSON Schema (M00)

**Dependencies**  
M00 (schema references in template directives)

**Files to Deliver**
```
electron/ai/prompt/
├── PromptTemplates.ts
├── PromptTemplates.test.ts
├── templates/
│   ├── interview.ts           # Steps 1-6
│   ├── chat.ts                # Workspace and project chat
│   ├── memory.ts              # Distillation template
│   ├── planning.ts            # Roadmap template
│   └── evaluation.ts          # Evaluation template
└── types.ts                   # TemplateType enum, TemplateParams
```

**Estimated Complexity:** Low-Medium  
Writing good prompts is a craft. The TypeScript infrastructure is simple; the quality of each template determines the quality of all AI output.

**Implementation Order:** 3rd tier (after M00 is complete, parallel with M08, M09)

**Testing Strategy**
- Unit: Each `getTemplate()` call with valid params → assert non-empty string returned
- Unit: Missing required param → assert typed error, not runtime crash
- Snapshot: For each template type, assert rendered output is deterministic for identical inputs
- Quality: For each interview step template, manually verify with a real model that the output consistently matches the expected JSON schema

---

### M11 — Grammar Registry

**Directory:** `electron/ai/prompt/GrammarRegistry.ts`

**Purpose**  
Manages the loading, caching, and selection of GBNF grammar files. Provides the Prompt Compiler with the correct grammar for each inference call. Also handles grammar compilation — some task types require dynamically assembled grammars based on project-specific fields (e.g., an interview step grammar that includes the project's topic name as a string literal constraint).

**Responsibilities**
- Load and cache all static grammar files from `electron/ai/grammars/` at startup
- Expose `getGrammar(taskType): string` — returns the GBNF string for a given task
- Support dynamic grammar assembly for parameterized constraints
- Validate grammar syntax before caching (using llama.cpp's grammar validation path)
- Expose `listGrammars()` for diagnostics

**Dependencies**  
M00 (grammar files), M05 (LlamaSidecar — for grammar validation)

**Files to Deliver**
```
electron/ai/prompt/
├── GrammarRegistry.ts
└── GrammarRegistry.test.ts
```

**Estimated Complexity:** Low  
File loading + caching is straightforward. Dynamic grammar assembly is only needed for a subset of task types.

**Implementation Order:** 3rd tier (after M00 and M05 are complete)

**Testing Strategy**
- Unit: Load all grammars on startup → assert no load errors
- Unit: `getGrammar('interview-step')` → assert returns non-empty GBNF string
- Unit: Unknown task type → assert typed error with available grammar list
- Integration: Pass loaded grammar to sidecar on a test request → assert constrained output is valid JSON

---

### M12 — Prompt Compiler

**Directory:** `electron/ai/prompt/PromptCompiler.ts`

**Purpose**  
Assembles the complete, ready-to-send prompt by combining a template (from M10), a context block (from M08), conversation history (from M02), and a GBNF grammar selector (from M11). The output of the Prompt Compiler is the exact payload sent to the Model Router.

**Responsibilities**
- Accept `CompileRequest` containing: task type, user message, project ID, flow ID, conversation ID, additional options
- Retrieve the appropriate template via M10
- Build the context block via M08 (context + LRU-optimized keywords)
- Fetch recent conversation history via M02 (up to history window limit)
- Fetch the appropriate grammar via M11
- Assemble the final prompt payload: `{ system: string, messages: Message[], grammar: string }`
- Enforce total token budget (system + history + user message must fit within 8192 tokens)
- Truncate history turns (oldest first) if total exceeds budget after context injection

**Dependencies**  
M08 (ContextBuilder), M10 (PromptTemplates), M11 (GrammarRegistry), M02 (MessageStore — for history)

**Files to Deliver**
```
electron/ai/prompt/
├── PromptCompiler.ts
├── PromptCompiler.test.ts
└── types.ts                   # CompileRequest, CompiledPrompt interfaces
```

**Estimated Complexity:** Medium  
The hardest part is correctly enforcing the token budget across three variable-length components (context, history, user message) while ensuring the most important information is preserved.

**Implementation Order:** 4th tier (after M08, M10, M11 are complete)

**Testing Strategy**
- Unit: Minimal input (no context, no history) → assert valid prompt assembled
- Unit: Full input with all components → assert all sections present in correct order
- Unit: Combined length exceeds budget → assert oldest history turns dropped first
- Unit: Context alone exceeds budget → assert LRU kicks in (tested via M08 integration)
- Snapshot: Canonical project + task → assert deterministic prompt output
- Integration: Compiled prompt sent to Ollama → assert valid JSON response matching task schema

---

### M13 — Prompt Engine

**Directory:** `electron/ai/prompt/PromptEngine.ts`

**Purpose**  
The top-level orchestrator for the inference pipeline. It coordinates the Prompt Compiler and the Model Router, handles streaming delivery via IPC events, validates the response against the expected JSON Schema, and provides the `streamMessage` and `complete` methods consumed by IPC handlers.

**Responsibilities**
- Expose `streamMessage(conversationId, userMessage, opts)` → fulfills `ipc.ai.streamMessage()` contract
- Expose `complete(taskType, params)` → for non-streaming structured inference (interview, planning)
- Call `PromptCompiler` to build the prompt
- Dispatch to `ModelRouter` for inference
- For streaming: pipe chunks back to the renderer via IPC push events (`ai:stream:chunk`, `ai:stream:done`, `ai:stream:error`) with the `requestId` correlation
- For structured calls: validate response against the task's JSON Schema; retry once on schema mismatch
- After completion, trigger `MessageStore.append()` for both the user message and assistant response

**Dependencies**  
M09 (ModelRouter), M12 (PromptCompiler), M02 (MessageStore — post-response append)

**Files to Deliver**
```
electron/ai/prompt/
├── PromptEngine.ts
├── PromptEngine.test.ts
└── types.ts                   # StreamRequest, CompleteRequest, EngineResponse
```

**Estimated Complexity:** High  
This module bridges the prompt system, the inference backend, and the IPC event pipeline. Streaming, request correlation (by `requestId`), schema validation with retry, and message persistence must all work reliably in concert.

**Implementation Order:** 4th tier (after M09, M12 are complete)

**Testing Strategy**
- Unit: `streamMessage()` → mock ModelRouter → assert IPC events fired with correct requestId
- Unit: Schema validation pass → assert response returned as-is
- Unit: Schema validation fail → mock one bad response then one good → assert retry succeeds
- Unit: Schema validation fail twice → assert error surfaced to renderer, not crash
- Integration: Full pipeline with Ollama → `streamMessage()` → assert chunks arrive → assert final message appended to MessageStore
- Concurrency: Two simultaneous `streamMessage()` calls → assert each receives its own chunks, no cross-contamination

---

### M14 — Conversation State Manager

**Directory:** `electron/ai/conversation/ConversationStateManager.ts`

**Purpose**  
Manages the full lifecycle of conversations — creation, retrieval, listing, and deletion. A conversation is the pairing of a scope (workspace or project-specific), a model reference, and a `chat-history.log` file. This module fulfills the `ipc.ai.getOrCreateConversation()`, `ipc.ai.getConversation()`, and related IPC contracts.

**Responsibilities**
- Create a new conversation record (UUID, scope, model, timestamps) and initialize its `chat-history.log`
- Retrieve a conversation by ID with its full message history (via M02)
- `getOrCreate` — return existing conversation for a scope, or create one if none exists
- List all conversations for a project
- Delete a conversation (archive log, remove record)
- Expose conversation metadata (`messageCount`, `lastMessageAt`) for the sidebar
- Persist conversation registry as a `conversations.json` index file at the project root (or workspace root for workspace-scoped conversations)

**Dependencies**  
M02 (MessageStore — for chat-history.log access), M03 (MemoryEngine — referenced for project-scoped conversations)

**Files to Deliver**
```
electron/ai/conversation/
├── ConversationStateManager.ts
├── ConversationStateManager.test.ts
└── types.ts                   # Conversation, ConversationRegistry interfaces
```

**Estimated Complexity:** Medium  
Conversation lifecycle management with persistent indexing. The `getOrCreate` semantics require careful idempotency handling.

**Implementation Order:** 4th tier (after M02, M03 are complete)

**Testing Strategy**
- Unit: `create()` → assert UUID generated, files created on disk
- Unit: `getOrCreate()` twice with same scope → assert same conversation returned
- Unit: `getConversation(id)` with history → assert messages array populated from log
- Unit: `delete(id)` → assert log archived, record removed from index
- Unit: Registry corruption → assert graceful rebuild from log files on disk
- Integration: Create 5 conversations → list → assert all present → delete 2 → list → assert count correct

---

### M15 — Memory Distillation

**Directory:** `electron/ai/memory/MemoryDistillation.ts`

**Purpose**  
After each AI response, scans the conversation for new project facts, decisions, and domain-specific keywords worth preserving in long-term memory. Distillation runs as a background operation after response delivery — it never blocks the user. It feeds extracted keywords into the Keyword Repository and proposes memory deltas to the Memory Engine.

**Responsibilities**
- After each `streamMessage` completion, trigger distillation asynchronously
- Use the Prompt Engine (M13) in structured mode with the `MEMORY_DISTILL` template to ask the model to extract keywords and decisions from the last exchange
- Parse the JSON output (validated against `keyword-extraction.schema.json`)
- Write new keywords to the appropriate flow's `KeywordRepository` (M04)
- For significant decisions, propose a memory delta to the `MemoryEngine` (M03) — surface to renderer as a dismissible "Save to memory?" notification via IPC push
- Batch distillation calls — run at most once per 3 messages to avoid latency spikes

**Dependencies**  
M13 (PromptEngine — for the distillation inference call), M04 (KeywordRepository), M03 (MemoryEngine), M00 (schema for distillation output)

**Files to Deliver**
```
electron/ai/memory/
├── MemoryDistillation.ts
├── MemoryDistillation.test.ts
└── types.ts                   # DistillationResult, DistillationBatch interfaces
```

**Estimated Complexity:** Medium  
Asynchronous background processing with batching. The challenge is not blocking the main conversation flow while still being timely about surfacing memory suggestions.

**Implementation Order:** 5th tier (after M13 and M04 are complete)

**Testing Strategy**
- Unit: Distillation disabled during streaming → assert no distillation calls fired until `onDone`
- Unit: Batch throttle → send 3 messages rapidly → assert only 1 distillation call triggered
- Unit: Distillation response with 5 keywords → assert all 5 written to KeywordRepository
- Unit: Distillation response with a memory delta → assert IPC push event emitted to renderer
- Integration: Full conversation with project context → after 3 turns → assert keywords present in repository

---

### M16 — Context Injector

**Directory:** `electron/ai/context/ContextInjector.ts`

**Purpose**  
The bridge between the Context Builder (M08) and the Prompt Compiler (M12). Handles the `ipc.ai.resolveContext()` IPC method — which is called when the user types `@` in the chat input — and provides on-demand context resolution for @-mention project references.

**Responsibilities**
- Fulfill `ipc.ai.resolveContext(message)` — detect @-mentions in a message string and resolve them to project context blocks
- For @-mention of a project name, call `ContextBuilder` with that project's ID and active flow
- Return `{ hasContext: boolean, context: string }` as specified in the IPC contract
- Cache the last resolved context per conversation to avoid redundant file reads on consecutive messages
- Support `buildContextPrompt(projectId)` — fulfills `ipc.aspects.buildContextPrompt()` IPC contract — returns the full context primer for a project on first load

**Dependencies**  
M08 (ContextBuilder), M01 (ProjectStateManager — to resolve project names to IDs)

**Files to Deliver**
```
electron/ai/context/
├── ContextInjector.ts
├── ContextInjector.test.ts
└── types.ts                   # ContextResolveResult, ContextCache interfaces
```

**Estimated Complexity:** Low-Medium  
Mostly orchestration. The @-mention parsing and project name resolution are the only non-trivial parts.

**Implementation Order:** 5th tier (after M08, M01 are complete)

**Testing Strategy**
- Unit: Message without @-mention → assert `hasContext: false`
- Unit: Message with `@ProjectName` → assert resolved context string returned
- Unit: Unknown @-mention → assert `hasContext: false`, no error
- Unit: Cache hit → assert second call within same conversation does not re-read disk
- Integration: Full `buildContextPrompt()` call with project that has 20 keywords → assert formatted string within token budget

---

### M17 — Adaptive Interview Engine

**Directory:** `electron/ai/interview/AdaptiveInterviewEngine.ts`

**Purpose**  
Implements the 6-step adaptive onboarding interview that runs when a user creates a new Mission. This is the most user-visible AI feature in the entire system. The interview is stateful, skip-aware, and produces the foundational project memory that all subsequent AI interactions build upon. The mission page is locked until the interview completes.

**Responsibilities**
- Manage interview session state: current step, completed steps, collected answers, skip decisions
- Step 1: Accept project description or uploaded file (PDF/DOCX via M20)
- Step 2: Elicit project goals and user understanding — skip if both already provided in Step 1
- Step 3: Assess user's knowledge level of the project topic
- Step 4: Ask for desired final deliverable type (prototype, 3D model, ideation only)
- Step 5: Generate a 10-step project roadmap using the AI Planning Engine (M18)
- Step 6: Accept user corrections to the roadmap, finalize the plan
- On completion: write all collected answers and the roadmap to the project's `global-memory.log` via M03, mark `interview_completed: true` in `project.json` via M01, unlock the mission page
- Persist partial interview state to disk so it survives app restarts
- Expose IPC handlers that the renderer calls per-turn

**Dependencies**  
M01 (ProjectStateManager), M13 (PromptEngine), M14 (ConversationStateManager), M15 (MemoryDistillation), M16 (ContextInjector), M18 (AiPlanningEngine — for Step 5), M20 (FileExtractor — for Step 1 uploads)

**Files to Deliver**
```
electron/ai/interview/
├── AdaptiveInterviewEngine.ts
├── AdaptiveInterviewEngine.test.ts
├── InterviewSessionStore.ts   # Persist/restore partial interview state
└── types.ts                   # InterviewSession, InterviewStep, InterviewAnswer
```

**Estimated Complexity:** High  
The skip logic, stateful step sequencing, partial persistence, and integration of five upstream modules make this the most complex feature module. It also has the highest user-facing impact — errors here block mission creation entirely.

**Implementation Order:** 6th tier (after M01, M13, M14, M15, M16, M18 are complete)

**Testing Strategy**
- Unit: Step 1 → user provides full description → assert Step 2 is skipped correctly
- Unit: Step 1 → user provides partial info → assert Step 2 is asked
- Unit: Complete all 6 steps → assert `interview_completed: true` in `project.json`
- Unit: App restart mid-interview → restore state → assert correct step resumed
- Unit: Step 5 roadmap → assert between 5 and 10 steps generated
- Unit: Step 6 correction → assert corrected roadmap persisted to memory
- Integration: Full 6-step interview with Ollama → assert project memory populated with all answers
- E2E: Full interview → assert mission page accessible after completion

---

### M18 — AI Planning Engine

**Directory:** `electron/ai/planning/AiPlanningEngine.ts`

**Purpose**  
Generates and manages the project's step-by-step execution roadmap. Called from the Interview Engine during Step 5, and available for re-invocation throughout the project lifecycle. Uses research and design project methodology (empathy mapping, ideation, prototyping, etc.) to produce contextually appropriate plans.

**Responsibilities**
- Accept project context (description, goals, deliverable type, knowledge level) from the interview or directly
- Generate a 5–10 step project plan using the `PLANNING_ROADMAP` template, constrained to `interview-plan.schema.json`
- Apply domain-specific planning terminology: hypothesis validation, competition analysis, empathy mapping, proximity matrix, user insights, prototyping, etc.
- Accept user corrections (Step 6 input) and regenerate or patch the plan accordingly
- Store the finalized plan as a structured JSON record in `project.json` via M01
- Expose `getSuggestedNextStep(projectId)` — returns the contextually appropriate next step for the current project state

**Dependencies**  
M13 (PromptEngine), M16 (ContextInjector), M01 (ProjectStateManager)

**Files to Deliver**
```
electron/ai/planning/
├── AiPlanningEngine.ts
├── AiPlanningEngine.test.ts
└── types.ts                   # ProjectPlan, PlanStep, PlanCorrection interfaces
```

**Estimated Complexity:** Medium-High  
Prompt engineering for the planning template is critical. The correction loop (Step 6) adds state complexity. Domain terminology injection requires careful template design.

**Implementation Order:** 5th tier (required by M17, so must be built before the Interview Engine)

**Testing Strategy**
- Unit: Generate plan for "mobile app" project → assert 5–10 steps returned
- Unit: Plan includes research methodology terms → assert at least one of [empathy, prototype, hypothesis, ideation] present
- Unit: User correction "remove step 3" → assert corrected plan returned without that step
- Unit: `getSuggestedNextStep()` → assert returns the step following last completed one
- Integration: Full plan generation with Ollama → validate against `interview-plan.schema.json`
- Quality: Generate plans for 5 different project types → manually review that each is contextually appropriate

---

### M19 — AI Evaluation Framework

**Directory:** `electron/ai/evaluation/AiEvaluationFramework.ts`

**Purpose**  
Enables the AI to assess a user's completed work at each project step, provide validated progress feedback, and determine whether the user is ready to advance. This fulfills the "validate previous steps" feature described in the AI Chats spec — where the AI asks about each completed step and evaluates whether the progress is valid.

**Responsibilities**
- Accept the current project plan (from M18), the active step, and a description of what the user has done
- Use the `EVALUATION_CHECK` template to assess whether the step output meets the step's success criteria
- Return a structured evaluation: `{ isValid: boolean, feedback: string, suggestions: string[], readyToAdvance: boolean }`
- Validate output against `evaluation-result.schema.json`
- Store evaluation results in the project's `global-memory.log` via M03
- Expose `getStepProgress(projectId)` — returns evaluation status for each completed step

**Dependencies**  
M13 (PromptEngine), M14 (ConversationStateManager), M18 (AiPlanningEngine — for step definitions), M03 (MemoryEngine)

**Files to Deliver**
```
electron/ai/evaluation/
├── AiEvaluationFramework.ts
├── AiEvaluationFramework.test.ts
└── types.ts                   # EvaluationRequest, EvaluationResult, StepProgress
```

**Estimated Complexity:** Medium  
The evaluation logic itself is model-driven; the complexity is in correctly feeding context (what the step requires, what the user did) and validating the structured output.

**Implementation Order:** 6th tier (after M13, M14, M18 are complete)

**Testing Strategy**
- Unit: Valid step completion description → assert `isValid: true`, `readyToAdvance: true`
- Unit: Weak step output → assert `isValid: false`, `suggestions` non-empty
- Unit: Evaluation result stored in memory → assert retrievable via `getStepProgress()`
- Unit: Schema validation on evaluation response → assert malformed responses retried
- Integration: Full evaluation cycle with Ollama for 2 different step types → assert coherent feedback

---

### M20 — File Extractor

**Directory:** `electron/ai/multimodal/FileExtractor.ts`

**Purpose**  
Extracts plain text from uploaded files (PDF, DOCX, TXT, Markdown, code files) for injection into AI prompts. This fulfills `ipc.ai.extractFile()` and powers the file attachment feature on the AI chat page and Interview Step 1. Extraction runs entirely locally — no cloud OCR.

**Responsibilities**
- Accept a local file path and file type
- Extract plain text from PDF files using `pdf-parse` or `pdfjs-dist`
- Extract plain text from DOCX files using `mammoth`
- Return raw text from TXT, MD, CSV, JSON, and code files
- Enforce a character cap (`FILE_CHAR_CAP = 24000` — matching the renderer constant) and truncate gracefully
- Return `{ ok: boolean, name: string, text: string, chars: number, truncated: boolean, error?: string }` — matching the existing IPC contract in `electron.d.ts`

**Dependencies**  
M00 (no schema dependency — output is plain text, not JSON)

**Files to Deliver**
```
electron/ai/multimodal/
├── FileExtractor.ts
├── FileExtractor.test.ts
└── types.ts                   # ExtractRequest, ExtractResult interfaces
```

**Estimated Complexity:** Low-Medium  
Mostly delegating to well-tested libraries (`mammoth`, `pdf-parse`). The truncation logic and error handling are the only custom pieces.

**Implementation Order:** 3rd tier (can be built in parallel with prompt system modules — it has no AI dependencies)

**Testing Strategy**
- Unit: Extract text from a 3-page PDF fixture → assert non-empty text, no error
- Unit: Extract text from a DOCX fixture → assert content matches known text
- Unit: File exceeding 24000 chars → assert truncated flag set, text exactly at cap
- Unit: Unknown file type → assert typed error returned, not thrown
- Unit: Corrupted PDF → assert `ok: false` with error message
- Edge: Empty file → assert `ok: true`, empty text, zero chars

---

### M21 — Vision Processor

**Directory:** `electron/ai/multimodal/VisionProcessor.ts`

**Purpose**  
Enables Qwen2.5-VL's vision capability. Accepts a base64-encoded image (from canvas snapshots, screenshots of design tools, or 3D viewport captures) and sends it to the sidecar as a multimodal inference request. This powers the 3D viewer AI critique feature and Figma/Canva screenshot analysis.

**Responsibilities**
- Accept a base64 image string and a text prompt
- Construct a multimodal inference request in the format llama.cpp expects for vision models
- Send to the `LlamaSidecar` via `ModelRouter` (vision requests are always routed to the sidecar — Ollama may not have the VL model)
- Return a plain text or structured JSON response depending on the task
- Expose `analyzeImage(base64Image, prompt, outputFormat)` as the primary API
- Enforce image size limits (resize if over 1024×1024 before encoding) to manage KV cache usage

**Dependencies**  
M09 (ModelRouter — specifically the sidecar path), M20 (FileExtractor — for any file-to-image conversions)

**Files to Deliver**
```
electron/ai/multimodal/
├── VisionProcessor.ts
├── VisionProcessor.test.ts
└── types.ts                   # VisionRequest, VisionResponse interfaces
```

**Estimated Complexity:** Medium  
The multimodal request format for llama.cpp differs from the standard chat format. Correct base64 encoding, image resizing, and response parsing require careful implementation.

**Implementation Order:** 6th tier (after M09 is stable, can be built in parallel with M17/M19)

**Testing Strategy**
- Unit: Valid base64 PNG → assert non-empty text response
- Unit: Oversized image (2048×2048) → assert resized to ≤1024×1024 before dispatch
- Unit: Vision request routed to sidecar, not Ollama → assert ModelRouter called with `forceSidecar: true`
- Integration: Send a screenshot of a simple UI → assert response contains design-relevant observations
- Edge: Corrupt base64 → assert typed error returned, not crash

---

### M22 — Testing Framework

**Directory:** `electron/ai/testing/`

**Purpose**  
A dedicated testing infrastructure for the entire AI subsystem. Provides fixtures, mocks, test harnesses, and integration test suites that verify the system works end-to-end. Because the AI subsystem has real model dependencies, the testing framework distinguishes between unit tests (fully mocked), integration tests (Ollama required), and E2E tests (full Electron app).

**Responsibilities**
- Provide reusable mock implementations of: `LlamaSidecar`, `OllamaAdapter`, `MessageStore`, `KeywordRepository`, `MemoryEngine`
- Provide fixture data: sample projects, conversations, keyword repositories, memory logs
- Provide a `TestProjectFactory` that scaffolds a complete on-disk project for integration testing and cleans up afterwards
- Provide a `ModelStub` that returns deterministic, schema-valid responses without a real model — for CI pipelines
- Document how to run each test tier: unit (no deps), integration (Ollama required), E2E (Electron required)
- Set up Jest configuration with separate test runners per tier

**Dependencies**  
All modules above (M00–M21)

**Files to Deliver**
```
electron/ai/testing/
├── mocks/
│   ├── LlamaSidecar.mock.ts
│   ├── OllamaAdapter.mock.ts
│   ├── MessageStore.mock.ts
│   ├── KeywordRepository.mock.ts
│   └── MemoryEngine.mock.ts
├── fixtures/
│   ├── sample-project/        # Complete on-disk project fixture
│   ├── conversations/         # Sample chat-history.log files
│   └── schemas/               # Schema validation fixtures
├── factories/
│   └── TestProjectFactory.ts
├── stubs/
│   └── ModelStub.ts
└── jest.config.ts             # Separate unit/integration/e2e runners
```

**Estimated Complexity:** Medium  
Writing good mocks and fixtures is time-consuming but not algorithmically complex. The biggest risk is mocks drifting out of sync with the real implementations.

**Implementation Order:** 7th tier — but mocks and fixtures for each module should be written in parallel with each module, not deferred to the end.

**Testing Strategy**  
The Testing Framework tests itself by:
- Asserting `ModelStub` always returns schema-valid responses for each task type
- Asserting `TestProjectFactory` produces a valid on-disk structure that each module can operate on
- Running the full integration suite against a real Ollama instance in CI

---

## Module Summary Table

| ID  | Module                        | Tier | Complexity  | Blocks              |
|-----|-------------------------------|------|-------------|---------------------|
| M00 | JSON Schema & GBNF Grammars   | 1    | Low-Medium  | M03, M05, M10, M11  |
| M01 | Project State Manager         | 1    | Low         | M16, M17            |
| M02 | Message Store                 | 1    | Low         | M12, M14            |
| M03 | Memory Engine                 | 1    | Low-Medium  | M08, M14, M19       |
| M04 | Keyword Repository            | 1    | Low         | M07, M08, M15       |
| M05 | llama.cpp Sidecar Manager     | 2    | High        | M09, M11, M21       |
| M06 | Ollama Adapter                | 2    | Low         | M09                 |
| M07 | LRU Optimizer                 | 2    | Low-Medium  | M08                 |
| M08 | Context Builder               | 3    | Low-Medium  | M12, M16            |
| M09 | Model Router                  | 3    | Medium      | M13, M21            |
| M10 | Prompt Templates              | 3    | Low-Medium  | M12                 |
| M11 | Grammar Registry              | 3    | Low         | M12                 |
| M12 | Prompt Compiler               | 4    | Medium      | M13                 |
| M13 | Prompt Engine                 | 4    | High        | M15, M17, M18, M19  |
| M14 | Conversation State Manager    | 4    | Medium      | M17, M19            |
| M15 | Memory Distillation           | 5    | Medium      | M17                 |
| M16 | Context Injector              | 5    | Low-Medium  | M17                 |
| M17 | Adaptive Interview Engine     | 6    | High        | —                   |
| M18 | AI Planning Engine            | 5    | Medium-High | M17                 |
| M19 | AI Evaluation Framework       | 6    | Medium      | —                   |
| M20 | File Extractor                | 3    | Low-Medium  | M17, M21            |
| M21 | Vision Processor              | 6    | Medium      | —                   |
| M22 | Testing Framework             | 7    | Medium      | —                   |

---

## Integration Risk Mitigation

**Risk 1: IPC Contract Drift**  
The renderer's `ipc.ts` and `electron.d.ts` define the contract. Every main-process handler must satisfy that contract exactly — same method signatures, same return shapes. Never change `electron.d.ts` to match your implementation; change your implementation to match `electron.d.ts`.

**Risk 2: Token Budget Violations**  
If the LRU Optimizer miscalculates token counts, prompts will be truncated or rejected by llama.cpp. Calibrate the character-to-token approximation against at least 50 real samples using the actual Qwen2.5-VL tokenizer before deploying M07 to production.

**Risk 3: llama.cpp Sidecar Stability**  
The sidecar is a long-running child process that may crash due to OOM, model errors, or OS signals. M05's circuit breaker and M06's Ollama fallback are non-negotiable. Never ship without both.

**Risk 4: Interview Engine Step Skipping**  
The skip logic in M17 is subtle — incorrectly skipping a step removes foundational context that later AI interactions depend on. Test all 8 skip-permutation paths (which combinations of Step 1 info trigger Step 2 skip) exhaustively.

**Risk 5: File System Race Conditions**  
Multiple IPC handlers may access the same `keywords.json` or `chat-history.log` concurrently (e.g., a streaming response completing while the user sends another message). Implement file-level mutex locks in M02 and M04 from the start.

---

## Development Sprint Suggestions

| Sprint | Modules        | Goal                                          |
|--------|----------------|-----------------------------------------------|
| 1      | M00–M04        | All storage and schema foundations working    |
| 2      | M05–M07        | AI inference and LRU both independently tested|
| 3      | M06, M08–M11   | Context and prompt pipeline assembled         |
| 4      | M12–M14        | First end-to-end inference: user message → AI response → stored |
| 5      | M15–M16, M18   | Memory distillation + planning engine ready   |
| 6      | M17, M19–M21   | Interview engine complete + vision support    |
| 7      | M22 (full)     | Complete test coverage, CI configured         |

---

*This document is a living reference. Update module specs here before beginning implementation of any module. If a dependency changes, cascade the change to all downstream module specs before writing code.*
