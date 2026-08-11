/**
 * PromptCompiler.ts  (M12)
 *
 * Assembles the final message array for an inference call.
 * Responsibilities:
 *   - Prepend the system prompt (with optional context block appended)
 *   - Trim conversation history to maxHistoryTurns
 *   - Append the current user message
 *   - Estimate total token count
 *   - Attach optional grammar constraint
 *
 * Does NOT call any AI backend — it is a pure transformation step.
 */

import { LruOptimizer } from "../context/LruOptimizer";
import type { CompileOptions, CompiledPrompt } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_MAX_HISTORY_TURNS = 10;

// ─── PromptCompiler ───────────────────────────────────────────────────────────

export class PromptCompiler {
  /**
   * Compiles a CompileOptions object into a CompiledPrompt ready for inference.
   */
  compile(opts: CompileOptions): CompiledPrompt {
    const {
      systemPrompt,
      history           = [],
      userMessage,
      contextBlock,
      grammar,
      maxHistoryTurns   = DEFAULT_MAX_HISTORY_TURNS,
    } = opts;

    // ── 1. Build system prompt ─────────────────────────────────────────────
    const fullSystemPrompt = contextBlock
      ? `${systemPrompt}\n\n${contextBlock}`
      : systemPrompt;

    // ── 2. Trim history to maxHistoryTurns ────────────────────────────────
    // History is stored oldest-first; we take the last N turns
    const trimmedHistory = history.slice(-maxHistoryTurns);

    // ── 3. Assemble message array ─────────────────────────────────────────
    const messages: CompiledPrompt["messages"] = [
      { role: "system", content: fullSystemPrompt },
      ...trimmedHistory.map((m) => ({
        role:    m.role as "user" | "assistant",
        content: m.content,
      })),
      { role: "user", content: userMessage },
    ];

    // ── 4. Estimate tokens ────────────────────────────────────────────────
    const allText       = messages.map((m) => m.content).join(" ");
    const estimatedTokens = LruOptimizer.estimateString(allText);

    return {
      messages,
      estimatedTokens,
      historyTurns: trimmedHistory.length,
      grammar,
    };
  }

  /**
   * Returns the estimated token count for a raw string.
   */
  static estimateTokens(text: string): number {
    return LruOptimizer.estimateString(text);
  }
}
