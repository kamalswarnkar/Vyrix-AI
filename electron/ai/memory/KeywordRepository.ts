/**
 * KeywordRepository.ts  (M04)
 *
 * Manages the keywords.json file inside each Flow (topic) directory.
 * Stores domain-specific keywords with LRU timestamps for context optimization.
 *
 * File format: { "keyword": "ISO-8601-timestamp" }
 *
 * Uses per-file async mutex to prevent concurrent read-modify-write races.
 */

import fs   from "node:fs/promises";
import path from "node:path";

import type { KeywordMap, KeywordAddResult, KeywordRemoveResult, GetKeywordsResult } from "./types";

// ─── Mutex (shared with MessageStore pattern) ─────────────────────────────────

const fileLocks = new Map<string, Promise<void>>();

async function withFileLock<T>(filePath: string, fn: () => Promise<T>): Promise<T> {
  const prev = fileLocks.get(filePath) ?? Promise.resolve();
  let resolveLock!: () => void;
  const lock = new Promise<void>((res) => { resolveLock = res; });
  fileLocks.set(filePath, prev.then(() => lock));
  await prev;
  try {
    return await fn();
  } finally {
    resolveLock();
    if (fileLocks.get(filePath) === lock) fileLocks.delete(filePath);
  }
}

// ─── KeywordRepository ────────────────────────────────────────────────────────

export class KeywordRepository {
  /**
   * Returns the absolute path to the keywords.json for a given project/flow pair.
   * storageRoot = absolute path to the projects/ directory.
   */
  static keywordsPath(projectDir: string, flowId: string): string {
    return path.join(projectDir, "topics", flowId, "keywords.json");
  }

  // ── CRUD ───────────────────────────────────────────────────────────────────

  /**
   * Adds a keyword to the specified flow.
   * If the keyword already exists, its timestamp is refreshed (LRU bump).
   * Does NOT check for cross-flow duplicates — that responsibility lives
   * in the IPC handler layer where all project flows are accessible.
   */
  async add(keywordsPath: string, keyword: string): Promise<KeywordAddResult> {
    const normalized = keyword.trim().toLowerCase();
    if (!normalized) return { ok: false, error: "Keyword must not be empty" };

    return withFileLock(keywordsPath, async () => {
      const map = await this.read(keywordsPath);
      map[normalized] = new Date().toISOString();
      await this.write(keywordsPath, map);
      return { ok: true };
    });
  }

  /**
   * Removes a keyword from the specified flow.
   * Returns ok:true even if the keyword was not present (idempotent).
   */
  async remove(keywordsPath: string, keyword: string): Promise<KeywordRemoveResult> {
    const normalized = keyword.trim().toLowerCase();

    return withFileLock(keywordsPath, async () => {
      const map = await this.read(keywordsPath);
      if (normalized in map) {
        delete map[normalized];
        await this.write(keywordsPath, map);
      }
      return { ok: true };
    });
  }

  /**
   * Returns all keywords for the given flow, sorted by last_referenced DESC
   * (most recently used first).
   */
  async getAll(keywordsPath: string): Promise<GetKeywordsResult> {
    try {
      const map = await this.read(keywordsPath);
      return { ok: true, keywords: map };
    } catch (err) {
      return { ok: false, keywords: {}, error: String(err) };
    }
  }

  /**
   * Returns keywords sorted by timestamp ascending (oldest first).
   * Used by the LRU Optimizer to determine which keywords to drop.
   */
  async getSortedByAge(keywordsPath: string): Promise<Array<{ keyword: string; timestamp: string }>> {
    const { ok, keywords } = await this.getAll(keywordsPath);
    if (!ok) return [];

    return Object.entries(keywords)
      .map(([keyword, timestamp]) => ({ keyword, timestamp }))
      .sort((a, b) => a.timestamp.localeCompare(b.timestamp)); // oldest first
  }

  /**
   * Refreshes the last_referenced timestamp for a set of keywords.
   * Called by the LRU Optimizer after keywords are injected into a prompt.
   */
  async refreshTimestamps(keywordsPath: string, keywords: string[]): Promise<void> {
    if (keywords.length === 0) return;

    return withFileLock(keywordsPath, async () => {
      const map = await this.read(keywordsPath);
      const now = new Date().toISOString();
      for (const kw of keywords) {
        const normalized = kw.trim().toLowerCase();
        if (normalized in map) {
          map[normalized] = now;
        }
      }
      await this.write(keywordsPath, map);
    });
  }

  /**
   * Returns the total keyword count for the given flow.
   */
  async count(keywordsPath: string): Promise<number> {
    const map = await this.read(keywordsPath);
    return Object.keys(map).length;
  }

  /**
   * Checks if a keyword exists in the given flow.
   */
  async has(keywordsPath: string, keyword: string): Promise<boolean> {
    const map = await this.read(keywordsPath);
    return keyword.trim().toLowerCase() in map;
  }

  // ── Private I/O ───────────────────────────────────────────────────────────

  private async read(keywordsPath: string): Promise<KeywordMap> {
    try {
      const raw = await fs.readFile(keywordsPath, "utf8");
      return JSON.parse(raw) as KeywordMap;
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return {};
      // Corrupted file — return empty map rather than crashing
      return {};
    }
  }

  private async write(keywordsPath: string, map: KeywordMap): Promise<void> {
    await fs.mkdir(path.dirname(keywordsPath), { recursive: true });
    await fs.writeFile(keywordsPath, JSON.stringify(map, null, 2), "utf8");
  }
}
