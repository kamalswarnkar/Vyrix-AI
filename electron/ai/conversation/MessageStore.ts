/**
 * MessageStore.ts  (M02)
 *
 * Manages append-only chat-history.log files.
 * Each conversation has one log stored at:
 *   <projectDir>/topics/<flowId>/chat-history.log   (project-scoped)
 *   <workspaceDir>/conversations/<convId>/chat-history.log  (workspace-scoped)
 *
 * Format: NDJSON — one StoredMessage JSON object per line.
 *
 * The MessageStore only manages the raw log file.
 * ConversationStateManager (M14) handles the higher-level conversation lifecycle.
 */

import fs   from "node:fs/promises";
import path from "node:path";
import { randomUUID as uuidv4 } from "node:crypto";

import type { StoredMessage, MessageRole, AppendMessageOptions, ReadHistoryOptions } from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

/** Rotate log when it exceeds this many bytes (~2 MB) */
const LOG_ROTATION_BYTES = 2 * 1024 * 1024;

/** Default number of turns to return from history */
const DEFAULT_MAX_TURNS = 10;

// ─── Mutex ────────────────────────────────────────────────────────────────────
// Simple per-file async mutex to prevent concurrent write corruption.

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
    // Clean up resolved locks
    if (fileLocks.get(filePath) === lock) {
      fileLocks.delete(filePath);
    }
  }
}

// ─── MessageStore ─────────────────────────────────────────────────────────────

export class MessageStore {
  /**
   * Appends a single message to the specified log file.
   * The log file and its parent directory are created if they do not exist.
   * Uses a per-file mutex to prevent concurrent write corruption.
   */
  async append(
    logPath:       string,
    conversationId: string,
    role:          MessageRole,
    content:       string,
    opts:          AppendMessageOptions = {},
  ): Promise<StoredMessage> {
    const message: StoredMessage = {
      id:             uuidv4(),
      conversationId,
      role,
      content,
      model:          opts.model,
      latencyMs:      opts.latencyMs,
      createdAt:      new Date().toISOString(),
    };

    await withFileLock(logPath, async () => {
      await fs.mkdir(path.dirname(logPath), { recursive: true });

      // Rotate if oversized
      try {
        const stat = await fs.stat(logPath);
        if (stat.size >= LOG_ROTATION_BYTES) {
          await this.rotate(logPath);
        }
      } catch {
        // File doesn't exist yet — no rotation needed
      }

      const line = JSON.stringify(message) + "\n";
      await fs.appendFile(logPath, line, "utf8");
    });

    return message;
  }

  /**
   * Reads all messages from the log file.
   * Silently skips corrupted or partial lines.
   */
  async readAll(logPath: string): Promise<StoredMessage[]> {
    let raw: string;
    try {
      raw = await fs.readFile(logPath, "utf8");
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code === "ENOENT") return [];
      throw err;
    }

    return raw
      .split("\n")
      .filter((line) => line.trim().length > 0)
      .flatMap((line) => {
        try {
          return [JSON.parse(line) as StoredMessage];
        } catch {
          // Skip corrupted lines
          return [];
        }
      });
  }

  /**
   * Reads the last N *turns* from the log.
   * A turn = one user message + one assistant message.
   * Returns messages in chronological order (oldest first).
   */
  async readHistory(logPath: string, opts: ReadHistoryOptions = {}): Promise<StoredMessage[]> {
    const maxTurns = opts.maxTurns ?? DEFAULT_MAX_TURNS;
    const all      = await this.readAll(logPath);

    if (all.length === 0) return [];

    // Take the last maxTurns * 2 messages (each turn = 2 messages)
    const windowSize = maxTurns * 2;
    return all.slice(-windowSize);
  }

  /**
   * Counts the total number of messages in the log.
   */
  async count(logPath: string): Promise<number> {
    const all = await this.readAll(logPath);
    return all.length;
  }

  /**
   * Returns the timestamp of the most recent message, or null if the log is empty.
   */
  async lastMessageAt(logPath: string): Promise<string | null> {
    const all = await this.readAll(logPath);
    return all.length > 0 ? all[all.length - 1].createdAt : null;
  }

  /**
   * Clears all messages from the log (deletes the file).
   * Used for testing and conversation deletion.
   */
  async clear(logPath: string): Promise<void> {
    try {
      await fs.unlink(logPath);
    } catch (err) {
      if ((err as NodeJS.ErrnoException).code !== "ENOENT") throw err;
    }
  }

  // ── Private ──────────────────────────────────────────────────────────────────

  /**
   * Renames the current log to <name>.1.log and starts a fresh one.
   * Rotated logs are kept for potential review but not actively read.
   */
  private async rotate(logPath: string): Promise<void> {
    const rotatedPath = logPath.replace(/\.log$/, ".1.log");
    try {
      await fs.rename(logPath, rotatedPath);
    } catch {
      // If rename fails, proceed anyway — the append will still work
    }
  }
}
