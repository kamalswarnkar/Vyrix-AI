/**
 * renderer-contract.d.ts — the IPC contract for the frontend team.
 *
 * Types only, no runtime code. Import these in the renderer/preload to get
 * compile-time safety on every ipcRenderer.invoke call:
 *
 *   import type { AiInvokeMap, AiStreamEvents } from "<ai-module>/ipc/renderer-contract";
 *
 *   function invoke<C extends keyof AiInvokeMap>(
 *     channel: C, ...args: AiInvokeMap[C]["args"]
 *   ): Promise<AiInvokeMap[C]["result"]> {
 *     return ipcRenderer.invoke(channel, ...args);
 *   }
 *
 * Streaming: `ai:stream-message` resolves when the stream ends; chunks arrive
 * as push events. Always pass a `requestId` (any unique string) in opts and
 * match it on incoming events — two tabs streaming at once WILL interleave
 * events otherwise.
 */

export type ChatMode = "main" | "pop";

export interface StreamMessageOpts {
  /** "main" = project mentor/evaluator (default) · "pop" = general research/design assistant */
  mode?:      ChatMode;
  /** Base64-encoded images (no data: prefix) for Qwen2.5-VL multimodal input */
  images?:    string[];
  /** Echoed on every ai:stream:* event — generate one per request (e.g. crypto.randomUUID()) */
  requestId?: string;
}

/** Push events emitted to the WebContents that invoked ai:stream-message */
export interface AiStreamEvents {
  "ai:stream:chunk": { requestId?: string; chunk: string };
  "ai:stream:done":  { requestId?: string; full: string; latencyMs: number };
  "ai:stream:error": { requestId?: string; error: string };
}

export interface ExtractFileResult {
  ok:        boolean;
  name:      string;
  text:      string;
  chars:     number;
  truncated: boolean;
  error?:    string;
}

/** Generic result shape used by workflow/evaluation channels */
export interface WorkflowResult<T = unknown> {
  ok:         boolean;
  error?:     string;
  nextState?: string;
  data?:      T;
}

/**
 * channel → { args, result } for every ipcRenderer.invoke call.
 * Object params may be passed as plain objects (preferred) or JSON strings (legacy).
 */
export interface AiInvokeMap {
  // ── v1 — chat / interview / planning / memory / files ──────────────────────
  "ai:stream-message":        { args: [message: string, conversationId?: string, projectId?: string, opts?: StreamMessageOpts]; result: void };
  "ai:get-context":           { args: [message: string];                                        result: { ok: boolean; hasContext: boolean; context: string } };
  "ai:start-interview":       { args: [projectId: string];                                      result: unknown };
  "ai:interview-step":        { args: [projectId: string, userMessage: string, state: object];  result: unknown };
  "ai:generate-plan":         { args: [projectId: string, contextBlock?: string];               result: unknown };
  "ai:get-memory":            { args: [projectId: string];                                      result: { ok: boolean; context: string } };
  "ai:clear-memory":          { args: [projectId: string];                                      result: { ok: boolean } };
  "ai:extract-file":          { args: [filePath: string];                                       result: ExtractFileResult };

  // ── v2 — Beta-2 mission workflow ───────────────────────────────────────────
  "ai:classify-mission":         { args: [projectId: string, userMessage: string];                             result: WorkflowResult };
  "ai:confirm-classification":   { args: [projectId: string, confirmed: boolean, correctedMessage?: string];   result: WorkflowResult };
  "ai:capture-goal":             { args: [projectId: string, goal: object];                                    result: WorkflowResult };
  "ai:capture-end-goal":         { args: [projectId: string, endGoal: object];                                 result: WorkflowResult };
  "ai:evaluate-desirability":    { args: [projectId: string, vars: object];                                    result: WorkflowResult };
  "ai:generate-ideation-roadmap":{ args: [projectId: string, contextBlock?: string];                           result: WorkflowResult };
  "ai:refine-roadmap":           { args: [projectId: string, userRequest: string, contextBlock?: string];      result: WorkflowResult };
  "ai:validate-progress":        { args: [projectId: string, vars: object];                                    result: WorkflowResult };
  "ai:start-ideation":           { args: [projectId: string];                                                  result: WorkflowResult };
  "ai:ideation-ready":           { args: [projectId: string];                                                  result: WorkflowResult };
  "ai:evaluate-dvf":             { args: [projectId: string, vars: object];                                    result: WorkflowResult };
  "ai:record-decision":          { args: [projectId: string, vars: object];                                    result: WorkflowResult };
  "ai:generate-final-roadmap":   { args: [projectId: string, contextBlock?: string];                           result: WorkflowResult };
}

/**
 * Constraints enforced server-side (invalid input → rejected promise):
 * - projectId / conversationId must match /^[A-Za-z0-9_-]+$/ (no paths, no dots)
 * - ai:extract-file paths must live under the configured extractRoots (when set)
 */
