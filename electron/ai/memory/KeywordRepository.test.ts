/**
 * KeywordRepository.test.ts
 * Unit tests for M04 — KeywordRepository
 */

import fs   from "node:fs/promises";
import os   from "node:os";
import path from "node:path";
import { KeywordRepository } from "./KeywordRepository";

let tmpDir:       string;
let repo:         KeywordRepository;
let kwPath:       string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), "vyrix-kr-test-"));
  repo   = new KeywordRepository();
  kwPath = path.join(tmpDir, "keywords.json");
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ── add ───────────────────────────────────────────────────────────────────────

describe("add()", () => {
  it("adds a keyword and persists it", async () => {
    await repo.add(kwPath, "empathy mapping");
    expect(await repo.has(kwPath, "empathy mapping")).toBe(true);
  });

  it("normalises to lowercase", async () => {
    await repo.add(kwPath, "Proximity Matrix");
    expect(await repo.has(kwPath, "proximity matrix")).toBe(true);
  });

  it("refreshes timestamp on re-add (LRU bump)", async () => {
    await repo.add(kwPath, "user journey");
    const { keywords: first } = await repo.getAll(kwPath);
    const ts1 = first["user journey"];

    await new Promise((r) => setTimeout(r, 5));
    await repo.add(kwPath, "user journey");
    const { keywords: second } = await repo.getAll(kwPath);
    const ts2 = second["user journey"];

    expect(ts2 > ts1).toBe(true);
  });

  it("rejects empty keyword", async () => {
    const result = await repo.add(kwPath, "   ");
    expect(result.ok).toBe(false);
  });

  it("handles concurrent adds without corruption", async () => {
    const writes = Array.from({ length: 20 }, (_, i) =>
      repo.add(kwPath, `keyword-${i}`),
    );
    await Promise.all(writes);
    expect(await repo.count(kwPath)).toBe(20);
  });
});

// ── remove ────────────────────────────────────────────────────────────────────

describe("remove()", () => {
  it("removes an existing keyword", async () => {
    await repo.add(kwPath, "wayfinding");
    await repo.remove(kwPath, "wayfinding");
    expect(await repo.has(kwPath, "wayfinding")).toBe(false);
  });

  it("is idempotent when keyword does not exist", async () => {
    const result = await repo.remove(kwPath, "nonexistent");
    expect(result.ok).toBe(true);
  });
});

// ── getSortedByAge ────────────────────────────────────────────────────────────

describe("getSortedByAge()", () => {
  it("returns keywords sorted oldest-first", async () => {
    await repo.add(kwPath, "first");
    await new Promise((r) => setTimeout(r, 5));
    await repo.add(kwPath, "second");
    await new Promise((r) => setTimeout(r, 5));
    await repo.add(kwPath, "third");

    const sorted = await repo.getSortedByAge(kwPath);
    expect(sorted[0].keyword).toBe("first");
    expect(sorted[2].keyword).toBe("third");
  });
});

// ── refreshTimestamps ─────────────────────────────────────────────────────────

describe("refreshTimestamps()", () => {
  it("updates timestamps for specified keywords", async () => {
    await repo.add(kwPath, "old-keyword");
    const { keywords: before } = await repo.getAll(kwPath);
    const tsBefore = before["old-keyword"];

    await new Promise((r) => setTimeout(r, 5));
    await repo.refreshTimestamps(kwPath, ["old-keyword"]);

    const { keywords: after } = await repo.getAll(kwPath);
    expect(after["old-keyword"] > tsBefore).toBe(true);
  });

  it("ignores keywords not in the map", async () => {
    await repo.add(kwPath, "real-keyword");
    await expect(
      repo.refreshTimestamps(kwPath, ["ghost-keyword", "real-keyword"]),
    ).resolves.not.toThrow();
  });
});
