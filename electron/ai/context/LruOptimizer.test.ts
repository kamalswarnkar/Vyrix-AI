/**
 * LruOptimizer.test.ts
 * Unit tests for M07 — LruOptimizer
 */

import { LruOptimizer } from "./LruOptimizer";

const optimizer = new LruOptimizer();

function makeKeywords(count: number, baseDate = new Date("2026-01-01")): Record<string, string> {
  const map: Record<string, string> = {};
  for (let i = 0; i < count; i++) {
    const ts = new Date(baseDate.getTime() + i * 60_000).toISOString();
    map[`keyword-${i.toString().padStart(3, "0")}`] = ts;
  }
  return map;
}

// ── optimize ──────────────────────────────────────────────────────────────────

describe("optimize()", () => {
  it("includes all keywords when under budget", () => {
    const kws = makeKeywords(5);
    const result = optimizer.optimize(kws, 500);
    expect(result.included).toHaveLength(5);
    expect(result.dropped).toHaveLength(0);
  });

  it("drops oldest keywords when over budget", () => {
    const kws = makeKeywords(50);
    const budget = 20; // very tight
    const result = optimizer.optimize(kws, budget);
    expect(result.included.length).toBeLessThan(50);
    expect(result.dropped.length).toBeGreaterThan(0);
    expect(result.usedTokens).toBeLessThanOrEqual(budget + optimizer.estimateTokens("keyword-049"));
  });

  it("always includes at least 1 keyword", () => {
    const kws = { "very-long-keyword-that-exceeds-budget": "2026-01-01T00:00:00.000Z" };
    const result = optimizer.optimize(kws, 1); // budget = 1 token
    expect(result.included).toHaveLength(1);
  });

  it("prioritises newer keywords over older ones", () => {
    const kws = {
      "old-kw":    "2026-01-01T00:00:00.000Z",
      "new-kw":    "2026-08-01T00:00:00.000Z",
      "medium-kw": "2026-04-01T00:00:00.000Z",
    };
    // Budget for only 1 keyword
    const result = optimizer.optimize(kws, optimizer.estimateTokens("new-kw") + 1);
    expect(result.included).toContain("new-kw");
    expect(result.dropped).toContain("old-kw");
  });

  it("returns usedTokens > 0 when keywords are included", () => {
    const kws = makeKeywords(3);
    const result = optimizer.optimize(kws, 200);
    expect(result.usedTokens).toBeGreaterThan(0);
  });
});

// ── buildBudget ───────────────────────────────────────────────────────────────

describe("buildBudget()", () => {
  it("calculates available tokens correctly", () => {
    const budget = optimizer.buildBudget({
      totalContextTokens:    8192,
      systemPromptTokens:    300,
      memoryContextTokens:   150,
      historyTokens:         800,
      currentMessageTokens:  50,
      generationBudget:      2000,
    });
    expect(budget.total).toBe(8192);
    expect(budget.available).toBe(8192 - 300 - 150 - 800 - 50 - 2000);
  });

  it("returns available = 0 when reserved exceeds total", () => {
    const budget = optimizer.buildBudget({
      totalContextTokens:  100,
      systemPromptTokens:  200,
      memoryContextTokens: 0,
      historyTokens:       0,
    });
    expect(budget.available).toBe(0);
  });
});

// ── estimateString ────────────────────────────────────────────────────────────

describe("LruOptimizer.estimateString()", () => {
  it("returns 0 for empty string", () => {
    expect(LruOptimizer.estimateString("")).toBe(0);
  });

  it("returns a positive number for non-empty string", () => {
    expect(LruOptimizer.estimateString("empathy mapping")).toBeGreaterThan(0);
  });
});
