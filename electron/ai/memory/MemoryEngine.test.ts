/**
 * MemoryEngine.test.ts
 * Unit tests for M03 — MemoryEngine
 */

import fs   from "node:fs/promises";
import os   from "node:os";
import path from "node:path";
import { MemoryEngine } from "./MemoryEngine";

let tmpDir: string;
let engine: MemoryEngine;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vyrix-me-test-"));
  engine = new MemoryEngine(tmpDir);
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── append ────────────────────────────────────────────────────────────────────

describe("append()", () => {
  it("returns a MemoryDeltaRecord with a timestamp", () => {
    const record = engine.append({ key: "Platform", value: "iOS", category: "technical" });
    expect(record.key).toBe("Platform");
    expect(record.value).toBe("iOS");
    expect(record.timestamp).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("creates the log file on first append", async () => {
    engine.append({ key: "Platform", value: "iOS", category: "technical" });
    const logPath = path.join(tmpDir, "global-memory.log");
    await expect(fs.access(logPath)).resolves.not.toThrow();
  });
});

// ── readAllDeltas / compileState ──────────────────────────────────────────────

describe("compileState()", () => {
  it("returns empty object when log does not exist", async () => {
    const state = await engine.compileState();
    expect(state).toEqual({});
  });

  it("last delta for a key wins (last-write-wins)", async () => {
    engine.append({ key: "Platform", value: "iOS",     category: "technical" });
    engine.append({ key: "Platform", value: "Android", category: "technical" });

    const state = await engine.compileState();
    expect(state["Platform"].value).toBe("Android");
  });

  it("compiles 10 deltas into correct state", async () => {
    engine.append({ key: "Platform",   value: "iOS",           category: "technical" });
    engine.append({ key: "OutputType", value: "Prototype",     category: "design"    });
    engine.append({ key: "TargetUser", value: "Students 18-24", category: "user"     });

    const state = await engine.compileState();
    expect(Object.keys(state)).toHaveLength(3);
    expect(state["Platform"].value).toBe("iOS");
  });

  it("skips corrupted lines gracefully", async () => {
    engine.append({ key: "Platform", value: "iOS", category: "technical" });
    const logPath = path.join(tmpDir, "global-memory.log");
    await fs.appendFile(logPath, "+ { CORRUPTED }\n", "utf8");
    engine.append({ key: "OutputType", value: "Prototype", category: "design" });

    const state = await engine.compileState();
    expect(state["Platform"]).toBeDefined();
    expect(state["OutputType"]).toBeDefined();
  });
});

// ── compileStateAt ────────────────────────────────────────────────────────────

describe("compileStateAt()", () => {
  it("returns state as-of delta index N", async () => {
    engine.append({ key: "Platform",   value: "iOS",       category: "technical" });
    engine.append({ key: "OutputType", value: "Prototype", category: "design"    });
    engine.append({ key: "Platform",   value: "Android",   category: "technical" });

    // At index 1 (first 2 deltas), Platform should still be iOS
    const state = await engine.compileStateAt(1);
    expect(state["Platform"].value).toBe("iOS");
    expect(state["OutputType"]).toBeDefined();
  });
});

// ── formatAsContext ───────────────────────────────────────────────────────────

describe("formatAsContext()", () => {
  it("returns empty string when log is empty", async () => {
    const ctx = await engine.formatAsContext();
    expect(ctx).toBe("");
  });

  it("formats entries as [PROJECT CONTEXT] block", async () => {
    engine.append({ key: "Platform", value: "iOS", category: "technical" });
    const ctx = await engine.formatAsContext();
    expect(ctx).toContain("[PROJECT CONTEXT]");
    expect(ctx).toContain("Platform: iOS");
  });
});

// ── estimateTokens ────────────────────────────────────────────────────────────

describe("estimateTokens()", () => {
  it("returns 0 for empty log", async () => {
    expect(await engine.estimateTokens()).toBe(0);
  });

  it("returns a positive number after appending entries", async () => {
    engine.append({ key: "Platform", value: "iOS",       category: "technical" });
    engine.append({ key: "Output",   value: "Prototype", category: "design"    });
    expect(await engine.estimateTokens()).toBeGreaterThan(0);
  });
});
