/**
 * GrammarRegistry.test.ts
 * Unit tests for M11 — GrammarRegistry
 */

import * as fs   from "node:fs/promises";
import * as os   from "node:os";
import * as path from "node:path";
import { GrammarRegistry, GrammarNotFoundError } from "./GrammarRegistry";

// ── Fixture helpers ───────────────────────────────────────────────────────────

async function makeTempGrammarsDir(): Promise<string> {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "vyrix-grammars-"));
  return dir;
}

async function writeGrammar(dir: string, name: string, content: string): Promise<void> {
  await fs.writeFile(path.join(dir, `${name}.gbnf`), content, "utf-8");
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("GrammarRegistry", () => {
  let tempDir: string;

  beforeEach(async () => {
    tempDir = await makeTempGrammarsDir();
  });

  afterEach(async () => {
    await fs.rm(tempDir, { recursive: true, force: true });
  });

  it("get() returns grammar content for a known task type", async () => {
    await writeGrammar(tempDir, "interview-step", 'root ::= "{ }"');
    const registry = new GrammarRegistry({ grammarsDir: tempDir });
    const grammar  = await registry.get("interview-step");
    expect(grammar).toBe('root ::= "{ }"');
  });

  it("get() caches grammar after first load", async () => {
    await writeGrammar(tempDir, "memory-delta", 'root ::= string');
    const registry = new GrammarRegistry({ grammarsDir: tempDir });

    await registry.get("memory-delta");
    // Delete file — second call must hit cache
    await fs.rm(path.join(tempDir, "memory-delta.gbnf"));
    const cached = await registry.get("memory-delta");
    expect(cached).toBe('root ::= string');
  });

  it("get() throws GrammarNotFoundError for unknown task type", async () => {
    const registry = new GrammarRegistry({ grammarsDir: tempDir });
    await expect(registry.get("unknown-type")).rejects.toThrow(GrammarNotFoundError);
  });

  it("has() returns true when grammar file exists", async () => {
    await writeGrammar(tempDir, "evaluation-result", 'root ::= object');
    const registry = new GrammarRegistry({ grammarsDir: tempDir });
    expect(await registry.has("evaluation-result")).toBe(true);
  });

  it("has() returns false when grammar file does not exist", async () => {
    const registry = new GrammarRegistry({ grammarsDir: tempDir });
    expect(await registry.has("nonexistent")).toBe(false);
  });

  it("preload() populates cache for available files", async () => {
    await writeGrammar(tempDir, "interview-step", 'root ::= object');
    await writeGrammar(tempDir, "keyword-extraction", 'root ::= object');
    const registry = new GrammarRegistry({ grammarsDir: tempDir });
    await registry.preload();
    const cached = registry.cached();
    expect(cached).toContain("interview-step");
    expect(cached).toContain("keyword-extraction");
  });

  it("clear() empties the cache", async () => {
    await writeGrammar(tempDir, "context-resolve", 'root ::= object');
    const registry = new GrammarRegistry({ grammarsDir: tempDir });
    await registry.get("context-resolve");
    expect(registry.cached()).toHaveLength(1);
    registry.clear();
    expect(registry.cached()).toHaveLength(0);
  });
});
