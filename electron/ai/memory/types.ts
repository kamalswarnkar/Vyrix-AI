/**
 * types.ts — Memory module type definitions
 */

import type { MemoryCategory } from "../types/ai-schemas.d";

// ─── Memory Engine ────────────────────────────────────────────────────────────

/** A single line in global-memory.log */
export interface MemoryDeltaRecord {
  key:       string;
  value:     string;
  category:  MemoryCategory;
  timestamp: string; // ISO 8601
}

/** The compiled current state derived from replaying all deltas */
export type MemoryState = Record<string, MemoryDeltaRecord>;

export interface MemoryEngineStats {
  totalDeltas:     number;
  uniqueKeys:      number;
  estimatedTokens: number;
  oldestEntry:     string | null; // ISO 8601
  newestEntry:     string | null; // ISO 8601
}

// ─── Keyword Repository ───────────────────────────────────────────────────────

/** { "empathy mapping": "2026-08-05T10:30:00.000Z" } */
export type KeywordMap = Record<string, string>;

export interface KeywordEntry {
  keyword:         string;
  last_referenced: string; // ISO 8601
}

export interface KeywordAddResult {
  ok:           boolean;
  moved_to?:    string; // flowId of the flow it was moved to (if duplicate)
  moved_to_name?: string;
  error?:       string;
}

export interface KeywordRemoveResult {
  ok:    boolean;
  error?: string;
}

export interface GetKeywordsResult {
  ok:       boolean;
  keywords: KeywordMap;
  error?:   string;
}
