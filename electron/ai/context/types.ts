/**
 * types.ts — Context module type definitions
 */

import type { KeywordMap, MemoryState } from "../memory/types";

// ─── LRU Optimizer ────────────────────────────────────────────────────────────

export interface TokenBudget {
  /** Total tokens available for context (system memory + keywords) */
  total:          number;
  /** Tokens already used by the fixed system prompt and history estimate */
  reserved:       number;
  /** Remaining tokens available for context injection */
  available:      number;
}

export interface LruResult {
  /** Keywords that fit within the budget (to be injected) */
  included:       string[];
  /** Keywords that were dropped due to budget pressure */
  dropped:        string[];
  /** Estimated token count of the included set */
  usedTokens:     number;
}

// ─── Context Builder ─────────────────────────────────────────────────────────

export interface ContextBuildOptions {
  projectDir:   string;
  flowId:       string;
  /** Token budget available for the context block. Default: 1500 */
  tokenBudget?: number;
}

export interface ContextResult {
  /** Formatted context string ready for system prompt injection */
  context:        string;
  /** Estimated token count of the formatted context */
  estimatedTokens: number;
  /** Keywords that were included */
  includedKeywords: string[];
  /** Keywords that were dropped by LRU */
  droppedKeywords: string[];
  /** Whether any global memory entries were present */
  hasMemory:      boolean;
}

// ─── Context Injector ─────────────────────────────────────────────────────────

export interface ContextResolveOptions {
  message:    string;
  storageRoot: string;
}

export interface ContextInjectResult {
  ok:         boolean;
  hasContext: boolean;
  context:    string;
  error?:     string;
}
