/**
 * ContextBuilder.ts  (M08)
 *
 * Assembles the context block injected into every system prompt.
 * Combines global memory (key/value decisions from MemoryEngine) with
 * flow-scoped keywords (from KeywordRepository), constrained by the
 * LruOptimizer token budget.
 *
 * Output format injected into the system prompt:
 *
 *   [PROJECT CONTEXT]
 *   Goal: Build a multi-tenant SaaS dashboard
 *   Tech Stack: React, Node.js, PostgreSQL
 *   ...
 *   [KEYWORDS]
 *   authentication, role-based access, dashboard, analytics
 *
 * After building context, the included keyword timestamps are refreshed
 * so the LRU optimizer considers them recently used.
 */

import { MemoryEngine }       from "../memory/MemoryEngine";
import { KeywordRepository }  from "../memory/KeywordRepository";
import { LruOptimizer }       from "./LruOptimizer";
import type { ContextBuildOptions, ContextResult } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Default token budget for the context block */
const DEFAULT_CONTEXT_BUDGET = 1500;

/** Section headers */
const MEMORY_HEADER  = "[PROJECT CONTEXT]";
const KEYWORD_HEADER = "[KEYWORDS]";

// ─── ContextBuilder ───────────────────────────────────────────────────────────

export class ContextBuilder {
  private readonly memory:    MemoryEngine;
  private readonly keywords:  KeywordRepository;
  private readonly optimizer: LruOptimizer;

  constructor(
    memory:    MemoryEngine,
    keywords:  KeywordRepository,
    optimizer: LruOptimizer,
  ) {
    this.memory    = memory;
    this.keywords  = keywords;
    this.optimizer = optimizer;
  }

  /**
   * Build the full context string for a given project + flow.
   * Respects the token budget and applies LRU eviction to keywords.
   */
  async build(opts: ContextBuildOptions): Promise<ContextResult> {
    const { projectDir, flowId, tokenBudget = DEFAULT_CONTEXT_BUDGET } = opts;

    // ── 1. Compile global memory ──────────────────────────────────────────────
    const [memoryState, allKeywords] = await Promise.all([
      this.memory.compileState(),
      this.keywords.getAll(KeywordRepository.keywordsPath(projectDir, flowId)),
    ]);

    const hasMemory = Object.keys(memoryState).length > 0;

    // ── 2. Format memory block ────────────────────────────────────────────────
    let memoryText = "";
    if (hasMemory) {
      const lines = Object.entries(memoryState)
        .map(([key, value]) => `${key}: ${value}`)
        .join("\n");
      memoryText = `${MEMORY_HEADER}\n${lines}`;
    }

    const memoryTokens = LruOptimizer.estimateString(memoryText);

    // ── 3. Budget remaining for keywords ──────────────────────────────────────
    const keywordBudget = Math.max(0, tokenBudget - memoryTokens);

    // ── 4. LRU-optimize keywords ──────────────────────────────────────────────
    let includedKeywords: string[] = [];
    let droppedKeywords:  string[] = [];
    let keywordTokens             = 0;

    if (allKeywords.ok && Object.keys(allKeywords.keywords).length > 0) {
      const lruResult = this.optimizer.optimize(allKeywords.keywords, keywordBudget);
      includedKeywords = lruResult.included;
      droppedKeywords  = lruResult.dropped;
      keywordTokens    = lruResult.usedTokens;

      // Refresh LRU timestamps for included keywords
      if (includedKeywords.length > 0) {
        const keywordsPath = KeywordRepository.keywordsPath(projectDir, flowId);
        await this.keywords.refreshTimestamps(keywordsPath, includedKeywords);
      }
    }

    // ── 5. Format keyword block ───────────────────────────────────────────────
    let keywordText = "";
    if (includedKeywords.length > 0) {
      keywordText = `${KEYWORD_HEADER}\n${includedKeywords.join(", ")}`;
    }

    // ── 6. Assemble final context ─────────────────────────────────────────────
    const parts: string[] = [];
    if (memoryText)   parts.push(memoryText);
    if (keywordText)  parts.push(keywordText);

    const context        = parts.join("\n\n");
    const estimatedTokens = memoryTokens + keywordTokens;

    return {
      context,
      estimatedTokens,
      includedKeywords,
      droppedKeywords,
      hasMemory,
    };
  }

  /**
   * Convenience: build and return only the context string.
   */
  async buildString(opts: ContextBuildOptions): Promise<string> {
    const result = await this.build(opts);
    return result.context;
  }
}
