/**
 * GrammarRegistry.ts  (M11)
 *
 * Loads and caches GBNF grammar files from the ../grammars/ directory.
 * Grammars are used by LlamaSidecar to constrain LLM output to valid JSON
 * matching a defined structure.
 *
 * Each grammar file must be named exactly as its TaskType:
 *   interview-step.gbnf
 *   interview-plan.gbnf
 *   memory-delta.gbnf
 *   keyword-extraction.gbnf
 *   evaluation-result.gbnf
 *   context-resolve.gbnf
 *   generative-ui.gbnf
 *
 * Usage:
 *   const registry = new GrammarRegistry();
 *   const grammar  = await registry.get("interview-step");
 *   // Pass grammar string to LlamaSidecar complete() options
 */

import * as fs   from "node:fs/promises";
import * as path from "node:path";
import type { TaskType } from "../types/ai-schemas";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface GrammarRegistryOptions {
  /** Override the default grammars directory (used in tests) */
  grammarsDir?: string;
}

export class GrammarNotFoundError extends Error {
  constructor(taskType: string) {
    super(`Grammar not found for task type: "${taskType}". Ensure the .gbnf file exists in the grammars directory.`);
    this.name = "GrammarNotFoundError";
  }
}

// ─── GrammarRegistry ─────────────────────────────────────────────────────────

export class GrammarRegistry {
  private readonly grammarsDir: string;
  private readonly cache = new Map<string, string>();

  constructor(opts: GrammarRegistryOptions = {}) {
    this.grammarsDir = opts.grammarsDir
      ?? path.resolve(__dirname, "../grammars");
  }

  /**
   * Returns the GBNF grammar string for the given task type.
   * Results are cached in-memory after the first load.
   *
   * @throws {GrammarNotFoundError} if the .gbnf file does not exist
   */
  async get(taskType: TaskType | string): Promise<string> {
    const cached = this.cache.get(taskType);
    if (cached !== undefined) return cached;

    const filePath = path.join(this.grammarsDir, `${taskType}.gbnf`);

    let content: string;
    try {
      content = await fs.readFile(filePath, "utf-8");
    } catch {
      throw new GrammarNotFoundError(taskType);
    }

    this.cache.set(taskType, content);
    return content;
  }

  /**
   * Pre-loads all known grammars into the cache.
   * Call during application startup to avoid cold-load latency.
   */
  async preload(): Promise<void> {
    const taskTypes: TaskType[] = [
      "interview-step",
      "interview-plan",
      "memory-delta",
      "keyword-extraction",
      "evaluation-result",
      "context-resolve",
      "generative-ui",
    ];

    await Promise.allSettled(
      taskTypes.map((t) => this.get(t).catch(() => {/* non-fatal: file may not exist yet */})),
    );
  }

  /**
   * Returns true if the grammar for the given task type is loaded (or cached).
   */
  async has(taskType: TaskType | string): Promise<boolean> {
    if (this.cache.has(taskType)) return true;
    const filePath = path.join(this.grammarsDir, `${taskType}.gbnf`);
    try {
      await fs.access(filePath);
      return true;
    } catch {
      return false;
    }
  }

  /**
   * Returns all currently cached task types.
   */
  cached(): string[] {
    return Array.from(this.cache.keys());
  }

  /**
   * Clears the in-memory cache (useful in tests or after hot-reload).
   */
  clear(): void {
    this.cache.clear();
  }
}
