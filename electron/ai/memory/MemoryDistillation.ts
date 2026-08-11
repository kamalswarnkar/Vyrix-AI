/**
 * MemoryDistillation.ts  (M15)
 *
 * Background pipeline that extracts structured memory deltas and keywords
 * from conversation turns using the PromptEngine.
 *
 * Called after each assistant response to:
 *   1. Extract a MemoryDelta (key/value + category) → append to MemoryEngine
 *   2. Extract Keywords + Decisions → add to KeywordRepository
 *
 * Runs asynchronously — failures are logged but never crash the main turn.
 *
 * Usage:
 *   const distiller = new MemoryDistillation(engine, prompt, keywords, validator);
 *   // Fire-and-forget after each turn
 *   distiller.distill(projectDir, flowId, userMessage, aiMessage).catch(console.error);
 */

import { MemoryEngine }       from "./MemoryEngine";
import { KeywordRepository }  from "./KeywordRepository";
import { PromptEngine }       from "../prompt/PromptEngine";
import { SchemaValidator }    from "../validation/SchemaValidator";
import {
  memoryDistillationSystemPrompt,
  memoryExtractionPrompt,
  keywordExtractionSystemPrompt,
  keywordExtractionPrompt,
} from "../prompt/templates/memory";
import type { MemoryDelta, KeywordExtraction } from "../types/ai-schemas";

// ─── MemoryDistillation ───────────────────────────────────────────────────────

export class MemoryDistillation {
  constructor(
    private readonly memory:     MemoryEngine,
    private readonly promptEngine: PromptEngine,
    private readonly keywords:   KeywordRepository,
    private readonly validator:  SchemaValidator,
  ) {}

  /**
   * Distil a single conversation turn into memory deltas and keywords.
   * Fire-and-forget safe: wraps both operations in try/catch.
   */
  async distill(
    projectDir:  string,
    flowId:      string,
    userMessage: string,
    aiMessage:   string,
  ): Promise<void> {
    await Promise.allSettled([
      this.extractMemory(userMessage, aiMessage),
      this.extractKeywords(projectDir, flowId, userMessage, aiMessage),
    ]);
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async extractMemory(userMessage: string, aiMessage: string): Promise<void> {
    // Get existing keys to avoid duplicates
    const existingState = await this.memory.compileState();
    const existingKeys  = Object.keys(existingState);

    const result = await this.promptEngine.run({
      systemPrompt: memoryDistillationSystemPrompt(),
      userMessage:  memoryExtractionPrompt({ userMessage, aiMessage, existingKeys }),
      taskType:     "memory-delta",
    });

    if (!result.ok || !result.text) return;

    const delta = this.validator.parseAndValidate<MemoryDelta>("memory-delta", result.text);
    if (!delta || delta.key === "no-op" || !delta.value) return;

    this.memory.append(delta);
  }

  private async extractKeywords(
    projectDir:  string,
    flowId:      string,
    userMessage: string,
    aiMessage:   string,
  ): Promise<void> {
    const keywordsPath = KeywordRepository.keywordsPath(projectDir, flowId);

    // Get current keywords to avoid duplicates
    const current     = await this.keywords.getAll(keywordsPath);
    const existing    = current.ok ? Object.keys(current.keywords) : [];

    const result = await this.promptEngine.run({
      systemPrompt: keywordExtractionSystemPrompt(),
      userMessage:  keywordExtractionPrompt({ userMessage, aiMessage, existingKeywords: existing }),
      taskType:     "keyword-extraction",
    });

    if (!result.ok || !result.text) return;

    const extraction = this.validator.parseAndValidate<KeywordExtraction>(
      "keyword-extraction",
      result.text,
    );
    if (!extraction) return;

    // Add new keywords
    for (const kw of extraction.keywords ?? []) {
      if (kw && !existing.includes(kw.toLowerCase())) {
        await this.keywords.add(keywordsPath, kw).catch(() => {/* non-fatal */});
      }
    }

    // Append decisions to memory
    for (const decision of extraction.decisions ?? []) {
      if (decision.key && decision.value) {
        this.memory.append({
          key:      decision.key,
          value:    decision.value,
          category: decision.category ?? "decision",
        });
      }
    }
  }
}
