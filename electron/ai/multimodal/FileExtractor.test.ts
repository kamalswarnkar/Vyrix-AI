/**
 * FileExtractor.test.ts
 * Unit tests for M20 — FileExtractor
 *
 * PDF and DOCX extraction tests require pdf-parse and mammoth to be installed.
 * They are marked @integration and skipped in CI unless ENABLE_INTEGRATION_TESTS=1.
 */

import * as fs   from "node:fs/promises";
import * as os   from "node:os";
import * as path from "node:path";
import { FileExtractor } from "./FileExtractor";

const INTEGRATION = process.env["ENABLE_INTEGRATION_TESTS"] === "1";

// ── Fixtures ──────────────────────────────────────────────────────────────────

async function makeTempDir(): Promise<string> {
  return fs.mkdtemp(path.join(os.tmpdir(), "vyrix-fe-"));
}

async function writeTempFile(dir: string, name: string, content: string | Buffer): Promise<string> {
  const p = path.join(dir, name);
  await fs.writeFile(p, content);
  return p;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe("FileExtractor", () => {
  let tempDir: string;

  beforeEach(async () => { tempDir = await makeTempDir(); });
  afterEach(async  () => { await fs.rm(tempDir, { recursive: true, force: true }); });

  // ── Text files ─────────────────────────────────────────────────────────────

  it("extracts .txt files without truncation", async () => {
    const p = await writeTempFile(tempDir, "readme.txt", "Hello, world!");
    const extractor = new FileExtractor();
    const result    = await extractor.extract(p);

    expect(result.ok).toBe(true);
    expect(result.file?.text).toBe("Hello, world!");
    expect(result.file?.truncated).toBe(false);
    expect(result.file?.isImage).toBe(false);
  });

  it("truncates text files exceeding charCap", async () => {
    const longText = "x".repeat(5000);
    const p        = await writeTempFile(tempDir, "long.txt", longText);
    const extractor = new FileExtractor({ charCap: 100 });
    const result    = await extractor.extract(p);

    expect(result.ok).toBe(true);
    expect(result.file?.text).toHaveLength(100);
    expect(result.file?.truncated).toBe(true);
    expect(result.file?.originalLength).toBe(5000);
  });

  it("extracts .md files", async () => {
    const p = await writeTempFile(tempDir, "notes.md", "# Title\nContent here");
    const result = await new FileExtractor().extract(p);
    expect(result.ok).toBe(true);
    expect(result.file?.fileType).toBe("md");
  });

  it("extracts .json files", async () => {
    const p = await writeTempFile(tempDir, "data.json", '{"key": "value"}');
    const result = await new FileExtractor().extract(p);
    expect(result.ok).toBe(true);
    expect(result.file?.text).toContain('"key"');
  });

  // ── Images ─────────────────────────────────────────────────────────────────

  it("reads PNG images as base64 data URLs", async () => {
    // Minimal 1x1 PNG (89 bytes)
    const PNG_1x1 = Buffer.from(
      "89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4" +
      "890000000a49444154789c6260000000020001e221bc330000000049454e44ae" +
      "426082",
      "hex",
    );
    const p      = await writeTempFile(tempDir, "icon.png", PNG_1x1);
    const result = await new FileExtractor().extract(p);

    expect(result.ok).toBe(true);
    expect(result.file?.isImage).toBe(true);
    expect(result.file?.dataUrl).toMatch(/^data:image\/png;base64,/);
    expect(result.file?.mimeType).toBe("image/png");
    expect(result.file?.text).toBe("");
  });

  it("returns ok:false for non-existent file", async () => {
    const result = await new FileExtractor().extract("/tmp/does-not-exist-12345.txt");
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/not found/i);
  });

  // ── Integration: PDF ───────────────────────────────────────────────────────

  (INTEGRATION ? it : it.skip)("extracts text from a real PDF", async () => {
    // Requires a sample PDF at test fixtures directory
    const pdfPath = path.resolve(__dirname, "../../test-fixtures/sample.pdf");
    const result  = await new FileExtractor().extract(pdfPath);
    expect(result.ok).toBe(true);
    expect(result.file?.text.length).toBeGreaterThan(0);
    expect(result.file?.pageCount).toBeGreaterThanOrEqual(1);
  });

  // ── Integration: DOCX ──────────────────────────────────────────────────────

  (INTEGRATION ? it : it.skip)("extracts text from a real DOCX", async () => {
    const docxPath = path.resolve(__dirname, "../../test-fixtures/sample.docx");
    const result   = await new FileExtractor().extract(docxPath);
    expect(result.ok).toBe(true);
    expect(result.file?.text.length).toBeGreaterThan(0);
  });
});
