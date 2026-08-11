/**
 * types.ts — Prompt module type definitions
 */

import type { TaskType } from "../types/ai-schemas";

// ─── Prompt Compiler ──────────────────────────────────────────────────────────

export interface CompileOptions {
  /** System prompt text */
  systemPrompt:   string;
  /** Conversation history to include (most recent first, then reversed) */
  history:        Array<{ role: "user" | "assistant"; content: string }>;
  /** Current user message */
  userMessage:    string;
  /** Context block injected after system prompt (optional) */
  contextBlock?:  string;
  /** Grammar constraint to attach (optional) */
  grammar?:       string;
  /** Task type — used to select the correct grammar if grammar is not provided */
  taskType?:      TaskType;
  /** Max history turns to include. Default: 10 */
  maxHistoryTurns?: number;
}

export interface CompiledPrompt {
  /** Full message array ready for inference */
  messages:       Array<{ role: "system" | "user" | "assistant"; content: string }>;
  /** Estimated token count for the compiled prompt */
  estimatedTokens: number;
  /** Number of history turns included */
  historyTurns:   number;
  /** Grammar constraint attached (if any) */
  grammar?:       string;
}

// ─── Prompt Engine ────────────────────────────────────────────────────────────

export interface PromptEngineRequest {
  /** The system prompt template to use */
  systemPrompt:     string;
  /** User's current message */
  userMessage:      string;
  /** Context block (from ContextBuilder) */
  contextBlock?:    string;
  /** Full conversation history */
  history?:         Array<{ role: "user" | "assistant"; content: string }>;
  /** Task type — if provided, grammar is auto-loaded */
  taskType?:        TaskType;
  /** Force a specific grammar string (overrides auto-load) */
  grammar?:         string;
  /** Whether to stream the response */
  stream?:          boolean;
  /** Base64-encoded images attached to the user message (multimodal) */
  images?:          string[];
  /** Max history turns. Default: 10 */
  maxHistoryTurns?: number;
}

export interface PromptEngineResponse {
  ok:       boolean;
  text?:    string;
  error?:   string;
  /** Estimated tokens used */
  tokens?:  number;
  /** Backend that served the request */
  backend?: string;
  latencyMs?: number;
}

export type PromptEngineStreamCallback = (chunk: string) => void;
export type PromptEngineDoneCallback   = (full: string, latencyMs: number) => void;
export type PromptEngineErrorCallback  = (error: string) => void;
