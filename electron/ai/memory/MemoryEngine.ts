/**
 * MemoryEngine.ts  (M03)
 *
 * Manages the project's global-memory.log — an append-only, human-readable
 * log of project decisions and facts.
 *
 * Format: one JSON delta per line, prefixed with "+ "
 *   + {"key":"Platform","value":"iOS","category":"technical","timestamp":"..."}
 *
 * The current state is derived by replaying all deltas in order.
 * Rollback is performed by replaying up to a given delta index.
 *
 * This module uses fs.appendFileSync for the append operation because it
 * must be atomic from the Node.js process perspective. All other operations
 * use async fs.
 */

import fs   from "node:fs";
import fsp  from "node:fs/promises";
import path from "node:path";

import type { MemoryDeltaRecord, MemoryState, MemoryEngineStats } from "./types";
import type { MemoryDelta, MemoryCategory } from "../types/ai-schemas.d";

// ─── Constants ────────────────────────────────────────────────────────────────

const LOG_PREFIX = "+ ";
/** Rough chars-per-token estimate for token budget calculations */
const CHARS_PER_TOKEN = 4;

// ─── MemoryEngine ─────────────────────────────────────────────────────────────

export class MemoryEngine {
  private readonly logPath: string;

  constructor(projectDir: string) {
    this.logPath = path.join(projectDir, "global-memory.log");
  }

  // ── Append ─────────────────────────────────────────────────────────────────

  /**
   * Appends a single memory delta to the log.
   * Uses synchronous appendFileSync for atomicity.
   * Returns the full MemoryDeltaRecord (with timestamp) that was written.
   */
  append(delta: MemoryDelta): MemoryDeltaRecord {
    // Ensure directory exists
    fsp.mkdir(path.dirname(this.logPath), { recursive: true }).catch(() => {});

    const record: MemoryDeltaRecord = {
      key:       delta.key,
      value:     delta.value,
      category:  delta.category,
      timestamp: new Date().toISOString(),
    };

    const line = LOG_PREFIX + JSON.stringify(record) + "\n";
    fs.appendFileSync(this.logPath, line, "utf8");

    return record;
  }

  // ── Compile state ──────────────────────────────────────────────────────────

  /**
   * Reads the entire log and compiles it into a current-state object.
   * Later deltas for the same key overwrite earlier ones (last-write-wins).
   * Silently skips corrupted lines.
   */
  async compileState(): Promise<MemoryState> {
    const deltas = await this.readAllDeltas();
    const state: MemoryState = {};
    for (const delta of deltas) {
      state[delta.key] = delta;
    }
    return state;
  }

  /**
   * Compiles state up to and including the delta at the given 0-based index.
   * Used for rollback — pass the index you want to roll back TO.
   */
  async compileStateAt(upToIndex: number): Promise<MemoryState> {
    const deltas = await this.readAllDeltas();
    const sliced = deltas.slice(0, upToIndex + 1);
    const state: MemoryState = {};
    for (const delta of sliced) {
      state[delta.key] = delta;
    }
    return state;
  }

  // ── Read ───────────────────────────────────────────────────────────────────

  /**
   * Returns all delta records in chronological order.
   */
  async readAllDeltas(): Promise<MemoryDeltaRecord[]> {
    let raw: string;
    try {
      raw = await fsp.readFile(this.logPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    return raw
      .split("\n")
      .filter((line) => line.startsWith(LOG_PREFIX))
      .flatMap((line) => {
        try {
          return [JSON.parse(line.slice(LOG_PREFIX.length)) as MemoryDeltaRecord];
        } catch {
          return [];
        }
      });
  }

  // ── Stats ──────────────────────────────────────────────────────────────────

  /**
   * Returns diagnostic statistics about the memory log.
   */
  async getStats(): Promise<MemoryEngineStats> {
    const deltas = await this.readAllDeltas();
    const state  = await this.compileState();

    const timestamps = deltas.map((d) => d.timestamp).sort();

    return {
      totalDeltas:     deltas.length,
      uniqueKeys:      Object.keys(state).length,
      estimatedTokens: this.tokensFor(state),
      oldestEntry:     timestamps[0]              ?? null,
      newestEntry:     timestamps[timestamps.length - 1] ?? null,
    };
  }

  /**
   * Returns an estimated token count for the compiled state.
   * Uses a character-based approximation (4 chars ≈ 1 token).
   * Used by the LRU Optimizer to enforce the context window budget.
   */
  async estimateTokens(): Promise<number> {
    const state = await this.compileState();
    return this.tokensFor(state);
  }

  // ── Format for context injection ───────────────────────────────────────────

  /**
   * Formats the compiled state as a human-readable context block
   * suitable for injection into a system prompt.
   */
  async formatAsContext(): Promise<string> {
    const state = await this.compileState();
    const entries = Object.values(state);
    if (entries.length === 0) return "";

    const lines = entries.map(
      (e) => `${e.key}: ${e.value}`,
    );

    return `[PROJECT CONTEXT]\n${lines.join("\n")}`;
  }

  // ── Existence check ────────────────────────────────────────────────────────

  async exists(): Promise<boolean> {
    try {
      await fsp.access(this.logPath);
      return true;
    } catch {
      return false;
    }
  }

  // ── Private helpers ────────────────────────────────────────────────────────

  private tokensFor(state: MemoryState): number {
    const text = Object.values(state)
      .map((e) => `${e.key}: ${e.value}`)
      .join("\n");
    return Math.ceil(text.length / CHARS_PER_TOKEN);
  }
}
