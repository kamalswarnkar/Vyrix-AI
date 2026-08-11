/**
 * LruOptimizer.ts  (M07)
 *
 * Enforces the 8192-token context window budget for keyword injection.
 * When the combined keyword set exceeds the available budget, the LRU
 * Optimizer drops the oldest (least recently used) keywords first.
 *
 * Token estimation uses a character-to-token heuristic (4 chars ≈ 1 token),
 * calibrated against Qwen2.5 tokenizer samples.
 *
 * After injection, the caller should invoke KeywordRepository.refreshTimestamps()
 * to update LRU timestamps for the included set.
 */

import type { KeywordMap }     from "../memory/types";
import type { LruResult, TokenBudget } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Characters per token approximation (calibrated empirically) */
const CHARS_PER_TOKEN = 4;

/** Minimum number of keywords to include regardless of budget pressure */
const MIN_KEYWORDS = 1;

// ─── LruOptimizer ─────────────────────────────────────────────────────────────

export class LruOptimizer {
  /**
   * Given a keyword map (keyword → ISO timestamp) and a token budget,
   * returns the set of keywords that fit within the budget, dropping
   * the least recently used ones from the tail.
   *
   * @param keywords  - The full keyword map from KeywordRepository
   * @param budget    - Maximum tokens available for keywords
   */
  optimize(keywords: KeywordMap, budget: number): LruResult {
    const entries = Object.entries(keywords)
      .map(([keyword, timestamp]) => ({ keyword, timestamp }))
      .sort((a, b) => b.timestamp.localeCompare(a.timestamp)); // newest first

    const included: string[] = [];
    const dropped:  string[] = [];
    let   usedTokens = 0;

    for (const { keyword } of entries) {
      const tokenCost = this.estimateTokens(keyword);

      // Always include at least MIN_KEYWORDS even if over budget
      if (usedTokens + tokenCost <= budget || included.length < MIN_KEYWORDS) {
        included.push(keyword);
        usedTokens += tokenCost;
      } else {
        dropped.push(keyword);
      }
    }

    return { included, dropped, usedTokens };
  }

  /**
   * Estimates the token cost of injecting a single keyword into the prompt.
   * Accounts for separator punctuation (", ").
   */
  estimateTokens(keyword: string): number {
    // keyword + ", " separator ≈ keyword.length + 2 chars
    return Math.ceil((keyword.length + 2) / CHARS_PER_TOKEN);
  }

  /**
   * Estimates the token cost of the entire keyword set (formatted as CSV).
   */
  estimateKeywordSetTokens(keywords: string[]): number {
    const formatted = keywords.join(", ");
    return Math.ceil(formatted.length / CHARS_PER_TOKEN);
  }

  /**
   * Calculates how many tokens are available for keywords given the
   * total context window and the reserved amounts for other components.
   */
  buildBudget(options: {
    totalContextTokens:    number;
    systemPromptTokens:    number;
    memoryContextTokens:   number;
    historyTokens:         number;
    currentMessageTokens?: number;
    generationBudget?:     number;
  }): TokenBudget {
    const {
      totalContextTokens,
      systemPromptTokens,
      memoryContextTokens,
      historyTokens,
      currentMessageTokens = 100,
      generationBudget     = 2000,
    } = options;

    const reserved =
      systemPromptTokens +
      memoryContextTokens +
      historyTokens +
      currentMessageTokens +
      generationBudget;

    const available = Math.max(0, totalContextTokens - reserved);

    return {
      total:     totalContextTokens,
      reserved,
      available,
    };
  }

  /**
   * Estimates token count for an arbitrary string.
   */
  static estimateString(text: string): number {
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
