# Vyrix AI Backend — Frontend Integration Guide

> **This document is self-contained.** Feed it to a developer or an AI coding assistant as context and they have everything needed to wire the renderer to the AI backend. The typed source of truth for every channel is [`electron/ai/ipc/renderer-contract.d.ts`](electron/ai/ipc/renderer-contract.d.ts) — import it, don't re-declare shapes by hand.

**Verified state (2026-08-11):** TypeScript clean · 15/15 test suites (113 tests) · live model calibration **96% (27/28)** on `qwen2.5vl:7b` · Main/POP persona behavior verified live.

---

## 1. What this backend provides

Two AI experiences over one shared pipeline, both project-aware via the same memory system:

| | **Main AI** (`mode: "main"`, default) | **POP AI** (`mode: "pop"`) |
|---|---|---|
| Role | Project mentor, evaluator, critic | Research/design tutor for students |
| Behavior | Challenges unsupported claims, assesses milestone completion against evidence, asks testing questions, refuses to rubber-stamp | Explains concepts first, connects to the project only when it helps, never audits unless asked |
| Same for both | Qwen2.5-VL-7B model · project memory context · conversation history · image input |

The personas live in `electron/ai/prompt/templates/chat.ts`. **Do not soften Main AI's system prompt** — its refusal to blindly agree is the product requirement, not a bug.

---

## 2. Setup (once per machine)

```bash
# 1. Ollama (the dev/default inference backend)
brew install ollama          # or https://ollama.com/download
ollama serve                 # if not already running as a service

# 2. The model — registry name has NO hyphen: "qwen2.5vl"
ollama pull qwen2.5vl:7b     # ~6 GB, Q4_K_M quantized, vision-capable

# 3. Backend dependencies
cd electron/ai && npm ci

# 4. Verify
npm run typecheck            # tsc — must be clean
npm test                     # 15 suites; 2 tests skip without live Ollama
```

> ⚠️ Older docs referenced `qwen2.5-vl:7b-q4_K_M` (with hyphen). **That tag does not exist** in the Ollama registry and `ollama pull` fails on it. The code default is now `qwen2.5vl:7b` everywhere.

---

## 3. Wiring in the Electron main process

This is the only code the app shell needs:

```ts
// electron/main.ts
import { app, ipcMain, dialog } from "electron";
import * as path from "node:path";
import { AiContainer, AiIpcHandlers } from "./ai/ipc";

app.whenReady().then(async () => {
  const container = await AiContainer.create({
    storageRoot: path.join(app.getPath("userData"), "vyrix-projects"),

    // OPTIONAL — llama.cpp sidecar (production inference + GBNF grammars).
    // Omit both and everything runs through Ollama.
    // llamaBinary: path.join(app.getAppPath(), "bin/llama-server"),
    // modelPath:   path.join(app.getPath("userData"), "models/qwen2.5-vl-7b-q4_k_m.gguf"),

    // SECURITY — directories ai:extract-file may read. Unset = any path
    // (legacy). ALWAYS set this in production; pair it with a main-process
    // dialog so users pick files and the renderer never invents paths:
    extractRoots: [app.getPath("downloads"), app.getPath("documents")],
  });

  new AiIpcHandlers(ipcMain, container).register();
  app.on("before-quit", () => container.dispose());
});
```

Preload bridge (typed end to end):

```ts
// electron/preload.ts
import { contextBridge, ipcRenderer } from "electron";
import type { AiInvokeMap, AiStreamEvents } from "./ai/ipc/renderer-contract";

contextBridge.exposeInMainWorld("vyrixAi", {
  invoke: <C extends keyof AiInvokeMap>(channel: C, ...args: AiInvokeMap[C]["args"]) =>
    ipcRenderer.invoke(channel, ...args) as Promise<AiInvokeMap[C]["result"]>,
  on: <E extends keyof AiStreamEvents>(event: E, cb: (payload: AiStreamEvents[E]) => void) => {
    const listener = (_: unknown, payload: AiStreamEvents[E]) => cb(payload);
    ipcRenderer.on(event, listener);
    return () => ipcRenderer.removeListener(event, listener);
  },
});
```

---

## 4. Chat streaming — the one pattern to get right

`ai:stream-message` resolves when the stream *ends*; tokens arrive as push events. **Always generate a `requestId`** and filter events by it — the user can stream in the Main AI tab and the POP tab simultaneously, and without the id the chunks interleave.

```ts
function streamChat(message: string, mode: "main" | "pop", projectId?: string,
                    conversationId?: string, images?: string[]) {
  const requestId = crypto.randomUUID();

  const offChunk = window.vyrixAi.on("ai:stream:chunk", (p) => {
    if (p.requestId !== requestId) return;   // another tab's stream
    appendToUi(p.chunk);
  });
  const offDone = window.vyrixAi.on("ai:stream:done", (p) => {
    if (p.requestId !== requestId) return;
    finalizeUi(p.full, p.latencyMs); offChunk(); offDone(); offErr();
  });
  const offErr = window.vyrixAi.on("ai:stream:error", (p) => {
    if (p.requestId !== requestId) return;
    showError(p.error); offChunk(); offDone(); offErr();
  });

  window.vyrixAi.invoke("ai:stream-message", message, conversationId, projectId,
    { mode, images, requestId });
}
```

- **Tab switching:** the Main AI tab sends `mode: "main"`, the POP tab sends `mode: "pop"`. Omitting `opts` entirely = Main AI (backward compatible).
- **Images:** base64 strings **without** the `data:image/...;base64,` prefix. The backend attaches them to the user message for Qwen2.5-VL and switches the vision/attachment prompt notes on automatically.
- **Memory:** passing `projectId` automatically injects that project's memory/context into the prompt and triggers background memory distillation after each response. No extra calls needed.

---

## 5. All 21 channels

Args and results are typed in `renderer-contract.d.ts`. Object params accept **plain objects** (preferred — IPC serializes natively) or JSON strings (legacy).

**v1 — chat, interview, planning, memory, files**

| Channel | Args | Notes |
|---|---|---|
| `ai:stream-message` | `message, conversationId?, projectId?, opts?` | See §4. `opts = { mode?, images?, requestId? }` |
| `ai:get-context` | `message` | Resolves `@ProjectName` mentions → context block |
| `ai:start-interview` | `projectId` | Begins the 6-step mission interview |
| `ai:interview-step` | `projectId, userMessage, state` | `state` = the state object returned by the previous step |
| `ai:generate-plan` | `projectId, contextBlock?` | 5–10 step roadmap |
| `ai:get-memory` | `projectId` | Compiled project memory as a context string |
| `ai:clear-memory` | `projectId` | Truncates the project's memory log |
| `ai:extract-file` | `filePath` | PDF/DOCX/text → `{ ok, name, text, chars, truncated, error? }`. Path must be inside `extractRoots` when configured |

**v2 — Beta-2 mission workflow** (all return `{ ok, error?, nextState?, data? }`; the state machine rejects out-of-order calls with `Invalid transition: X → Y`)

| Channel | Args |
|---|---|
| `ai:classify-mission` | `projectId, userMessage` |
| `ai:confirm-classification` | `projectId, confirmed, correctedMessage?` |
| `ai:capture-goal` | `projectId, goal` |
| `ai:capture-end-goal` | `projectId, endGoal` |
| `ai:evaluate-desirability` | `projectId, vars` |
| `ai:generate-ideation-roadmap` | `projectId, contextBlock?` |
| `ai:refine-roadmap` | `projectId, userRequest, contextBlock?` |
| `ai:validate-progress` | `projectId, vars` |
| `ai:start-ideation` | `projectId` |
| `ai:ideation-ready` | `projectId` |
| `ai:evaluate-dvf` | `projectId, vars` |
| `ai:record-decision` | `projectId, vars` |
| `ai:generate-final-roadmap` | `projectId, contextBlock?` |

Workflow order: `classify → confirm → capture-goal → capture-end-goal → evaluate-desirability → generate-ideation-roadmap → (refine)* → start-ideation → validate-progress* → ideation-ready → evaluate-dvf → record-decision → generate-final-roadmap → EXECUTION`.

---

## 6. Security constraints (enforced server-side — build UI accordingly)

- `projectId` and `conversationId` must match `/^[A-Za-z0-9_-]+$/`. Anything else (paths, dots, slashes) rejects the call. Use the ids the backend returns — never construct them from user text.
- `ai:extract-file` rejects paths outside `extractRoots` (when configured). Get paths from `dialog.showOpenDialog` in the main process, not from renderer input.
- Streaming events are only sent to the `WebContents` that invoked the request.

## 7. Timing expectations (set UX accordingly)

On Ollama with the 7B model: cold model load ~15 s (first request after idle), then ~10–40 tok/s depending on hardware. Structured workflow calls (classification, DVF, progress) take **20–80 s each** — show progress states, don't let users double-submit. Chat streams start rendering within a few seconds once the model is warm.

## 8. Developer env vars (personal machines only — never ship as app config)

| Var | Effect | Example (8 GB MacBook Air) |
|---|---|---|
| `VYRIX_MODEL` | Override inference model | `qwen2.5vl:3b` |
| `VYRIX_NUM_CTX` | Override 8192 context window | `2048` |
| `VYRIX_MAX_IMAGE_DIM` | Cap vision image size (default 1024) | `512` |

Project defaults stay `qwen2.5vl:7b` @ 8192 — these vars exist so low-RAM dev machines can run checks without swapping.

## 9. Known limitations (documented, not blockers)

1. **Phase 15 boundary case (2/3):** on ambiguous "partial completion" inputs the Q4 model occasionally emits `is_complete` as a string/omits it. AJV schema validation catches it → callers receive a clean `ok: false`, never corrupt state. UI should offer a retry on validation errors. Permanent fix: GBNF grammars via the llama.cpp sidecar, or the QLoRA fine-tune (`training/`, needs 24 GB+ GPU).
2. **Sidecar untested against a real `llama-server` binary** — Ollama is the verified path; the sidecar auto-falls back via circuit breaker.
3. **Main AI can self-contradict in long summaries** (argues "not complete" then summarizes "complete") — mentor-behavior QLoRA (`training/data/mentor-behavior.seed.jsonl`) targets exactly this.

## 10. What changed in the 2026-08-11 integration round

- Main/POP personas (`chat.ts`), `mode`/`images`/`requestId` on `ai:stream-message`, image passthrough to the model
- Correct model tag everywhere (`qwen2.5vl:7b` — old hyphenated tag never existed); Ollama default was `llama3.2`, now Qwen
- Security: id sanitization, `extractRoots`, stream events carry `requestId`
- Toolchain repaired: `tsconfig.json` + `ts-node` added, broken jest `moduleNameMapper` removed — `npm test` and `npm run typecheck` work now (22 latent type errors fixed across 9 files, incl. sidecar spawn args, `uuid` → `node:crypto`, duplicate `estimateTokens`)
- SchemaValidator now lazily loads **all** schemas (Beta-2 validation was silently disabled before); `generateFinalRoadmap` respects the state machine
- Object params accepted on all `*Json` channels; typed contract published; `sharp` bumped (0 npm audit vulns)
- Live-validated for the first time: phases 12–16 + persona smoke on real hardware
