/**
 * ContextBuilder.test.ts
 * Unit tests for M08 — ContextBuilder
 *
 * Uses lightweight fakes for MemoryEngine and KeywordRepository to
 * isolate ContextBuilder logic from disk I/O.
 */

import { ContextBuilder }     from "./ContextBuilder";
import { LruOptimizer }       from "./LruOptimizer";

// ── Minimal fakes ─────────────────────────────────────────────────────────────

function makeMemoryEngine(state: Record<string, string> = {}) {
  return {
    compileState: async () => state,
  } as any;
}

function makeKeywordRepository(keywords: Record<string, string> = {}) {
  return {
    getAll: async () => ({ ok: true, keywords }),
    refreshTimestamps: async () => {},
  } as any;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("ContextBuilder.build()", () => {
  const optimizer = new LruOptimizer();

  it("returns empty string when both memory and keywords are empty", async () => {
    const builder = new ContextBuilder(
      makeMemoryEngine(),
      makeKeywordRepository(),
      optimizer,
    );
    const result = await builder.build({ projectDir: "/p", flowId: "f1" });
    expect(result.context).toBe("");
    expect(result.hasMemory).toBe(false);
    expect(result.includedKeywords).toHaveLength(0);
  });

  it("formats memory section with [PROJECT CONTEXT] header", async () => {
    const builder = new ContextBuilder(
      makeMemoryEngine({ "Tech Stack": "React", "Database": "PostgreSQL" }),
      makeKeywordRepository(),
      optimizer,
    );
    const result = await builder.build({ projectDir: "/p", flowId: "f1" });
    expect(result.context).toContain("[PROJECT CONTEXT]");
    expect(result.context).toContain("Tech Stack: React");
    expect(result.context).toContain("Database: PostgreSQL");
    expect(result.hasMemory).toBe(true);
  });

  it("formats keyword section with [KEYWORDS] header", async () => {
    const builder = new ContextBuilder(
      makeMemoryEngine(),
      makeKeywordRepository({ "authentication": "2026-01-01T00:00:00.000Z", "oauth": "2026-01-02T00:00:00.000Z" }),
      optimizer,
    );
    const result = await builder.build({ projectDir: "/p", flowId: "f1" });
    expect(result.context).toContain("[KEYWORDS]");
    expect(result.includedKeywords.length).toBeGreaterThan(0);
  });

  it("combines both memory and keyword blocks with double newline", async () => {
    const builder = new ContextBuilder(
      makeMemoryEngine({ "Goal": "Build a dashboard" }),
      makeKeywordRepository({ "ui": "2026-01-01T00:00:00.000Z" }),
      optimizer,
    );
    const result = await builder.build({ projectDir: "/p", flowId: "f1" });
    expect(result.context).toContain("[PROJECT CONTEXT]");
    expect(result.context).toContain("[KEYWORDS]");
    // Sections separated by double newline
    expect(result.context).toMatch(/\n\n/);
  });

  it("respects token budget — drops overflow keywords", async () => {
    const manyKeywords: Record<string, string> = {};
    for (let i = 0; i < 100; i++) {
      manyKeywords[`keyword-with-a-long-name-${i}`] = new Date(Date.now() + i * 1000).toISOString();
    }
    const builder = new ContextBuilder(
      makeMemoryEngine(),
      makeKeywordRepository(manyKeywords),
      optimizer,
    );
    // Very tight budget
    const result = await builder.build({ projectDir: "/p", flowId: "f1", tokenBudget: 10 });
    expect(result.includedKeywords.length).toBeLessThan(100);
    expect(result.droppedKeywords.length).toBeGreaterThan(0);
  });

  it("estimatedTokens is > 0 when context is non-empty", async () => {
    const builder = new ContextBuilder(
      makeMemoryEngine({ "Key": "Value" }),
      makeKeywordRepository({ "react": "2026-01-01T00:00:00.000Z" }),
      optimizer,
    );
    const result = await builder.build({ projectDir: "/p", flowId: "f1" });
    expect(result.estimatedTokens).toBeGreaterThan(0);
  });

  it("buildString() returns the same context as build().context", async () => {
    const builder = new ContextBuilder(
      makeMemoryEngine({ "Arch": "Microservices" }),
      makeKeywordRepository(),
      optimizer,
    );
    const result = await builder.build({ projectDir: "/p", flowId: "f1" });
    const str    = await builder.buildString({ projectDir: "/p", flowId: "f1" });
    expect(str).toBe(result.context);
  });
});
