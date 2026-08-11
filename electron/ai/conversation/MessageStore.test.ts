/**
 * MessageStore.test.ts
 * Unit tests for M02 — MessageStore
 */

import fs   from "node:fs/promises";
import os   from "node:os";
import path from "node:path";
import { MessageStore } from "./MessageStore";

let tmpDir:  string;
let store:   MessageStore;
let logPath: string;
const convId = "conv-test-001";

beforeEach(async () => {
  tmpDir  = await fs.mkdtemp(path.join(os.tmpdir(), "vyrix-ms-test-"));
  store   = new MessageStore();
  logPath = path.join(tmpDir, "chat-history.log");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── append ────────────────────────────────────────────────────────────────────

describe("append()", () => {
  it("creates the log file and returns a StoredMessage", async () => {
    const msg = await store.append(logPath, convId, "user", "Hello AI");
    expect(msg.id).toBeTruthy();
    expect(msg.role).toBe("user");
    expect(msg.content).toBe("Hello AI");
    await expect(fs.access(logPath)).resolves.not.toThrow();
  });

  it("appends multiple messages without overwriting", async () => {
    await store.append(logPath, convId, "user",      "first");
    await store.append(logPath, convId, "assistant", "second");
    const all = await store.readAll(logPath);
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe("first");
    expect(all[1].content).toBe("second");
  });

  it("appends concurrently without corruption", async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      store.append(logPath, convId, "user", `message-${i}`),
    );
    await Promise.all(writes);
    const all = await store.readAll(logPath);
    expect(all).toHaveLength(20);
  });
});

// ── readAll ───────────────────────────────────────────────────────────────────

describe("readAll()", () => {
  it("returns empty array for non-existent log", async () => {
    const msgs = await store.readAll("/tmp/does-not-exist.log");
    expect(msgs).toEqual([]);
  });

  it("skips corrupted lines gracefully", async () => {
    await store.append(logPath, convId, "user", "good message");
    await fs.appendFile(logPath, "{ CORRUPTED LINE\n", "utf8");
    await store.append(logPath, convId, "assistant", "also good");

    const all = await store.readAll(logPath);
    expect(all).toHaveLength(2);
    expect(all[0].content).toBe("good message");
    expect(all[1].content).toBe("also good");
  });
});

// ── readHistory ───────────────────────────────────────────────────────────────

describe("readHistory()", () => {
  it("returns the last N turns (maxTurns * 2 messages)", async () => {
    for (let i = 0; i < 10; i++) {
      await store.append(logPath, convId, "user",      `user-${i}`);
      await store.append(logPath, convId, "assistant", `ai-${i}`);
    }
    const history = await store.readHistory(logPath, { maxTurns: 3 });
    expect(history).toHaveLength(6); // 3 turns = 6 messages
    expect(history[0].content).toBe("user-7");
  });

  it("returns all messages when count is less than window", async () => {
    await store.append(logPath, convId, "user",      "only one");
    await store.append(logPath, convId, "assistant", "only two");
    const history = await store.readHistory(logPath, { maxTurns: 10 });
    expect(history).toHaveLength(2);
  });
});

// ── count / lastMessageAt ─────────────────────────────────────────────────────

describe("count() / lastMessageAt()", () => {
  it("returns 0 and null for empty log", async () => {
    expect(await store.count(logPath)).toBe(0);
    expect(await store.lastMessageAt(logPath)).toBeNull();
  });

  it("returns correct count and timestamp after appends", async () => {
    await store.append(logPath, convId, "user",      "hi");
    await store.append(logPath, convId, "assistant", "hello");
    expect(await store.count(logPath)).toBe(2);
    const ts = await store.lastMessageAt(logPath);
    expect(ts).toBeTruthy();
  });
});

// ── clear ─────────────────────────────────────────────────────────────────────

describe("clear()", () => {
  it("deletes the log file", async () => {
    await store.append(logPath, convId, "user", "to be cleared");
    await store.clear(logPath);
    expect(await store.count(logPath)).toBe(0);
  });

  it("does not throw when log does not exist", async () => {
    await expect(store.clear("/tmp/no-such-log.log")).resolves.not.toThrow();
  });
});
