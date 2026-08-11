/**
 * FileExtractor.ts  (M20)
 *
 * Extracts text and metadata from user-attached files.
 * Supports: PDF (via pdf-parse), DOCX (via mammoth), plain text, Markdown,
 * CSV, JSON, and image files (PNG, JPEG, WebP, GIF).
 *
 * Text files are capped at 24000 characters to prevent context overflow.
 * Images are read as base64 data URLs for multimodal vision requests.
 *
 * Dependencies:
 *   npm install pdf-parse mammoth
 *   Types: @types/pdf-parse (community), mammoth (bundled)
 */

import * as fs   from "node:fs/promises";
import * as path from "node:path";
import type {
  ExtractedFile,
  ExtractResult,
  FileExtractorOptions,
  SupportedFileType,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

const DEFAULT_CHAR_CAP = 24_000;

const IMAGE_EXTS = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);
const TEXT_EXTS  = new Set([".txt", ".md", ".csv", ".json", ".ts", ".js", ".py", ".html", ".css"]);

const MIME_MAP: Record<string, string> = {
  ".png":  "image/png",
  ".jpg":  "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif":  "image/gif",
};

// ─── FileExtractor ────────────────────────────────────────────────────────────

export class FileExtractor {
  private readonly charCap: number;

  constructor(opts: FileExtractorOptions = {}) {
    this.charCap = opts.charCap ?? DEFAULT_CHAR_CAP;
  }

  /**
   * Extract content from a file at the given path.
   * Returns an ExtractResult — never throws.
   */
  async extract(filePath: string): Promise<ExtractResult> {
    try {
      await fs.access(filePath);
    } catch {
      return { ok: false, error: `File not found: ${filePath}` };
    }

    const ext      = path.extname(filePath).toLowerCase();
    const fileType = this.detectType(ext);

    try {
      if (IMAGE_EXTS.has(ext)) {
        return await this.extractImage(filePath, ext, fileType);
      }

      if (ext === ".pdf") {
        return await this.extractPdf(filePath);
      }

      if (ext === ".docx") {
        return await this.extractDocx(filePath);
      }

      if (TEXT_EXTS.has(ext)) {
        return await this.extractText(filePath, fileType);
      }

      // Unknown: try as text
      return await this.extractText(filePath, "unknown");
    } catch (err) {
      return { ok: false, error: `Extraction failed: ${String(err)}` };
    }
  }

  // ── Private extractors ────────────────────────────────────────────────────

  private async extractImage(filePath: string, ext: string, fileType: SupportedFileType): Promise<ExtractResult> {
    const buffer  = await fs.readFile(filePath);
    const mimeType = MIME_MAP[ext] ?? "image/png";
    const base64   = buffer.toString("base64");
    const dataUrl  = `data:${mimeType};base64,${base64}`;

    return {
      ok: true,
      file: {
        filePath,
        fileType,
        text:           "",
        truncated:      false,
        originalLength: 0,
        isImage:        true,
        dataUrl,
        mimeType,
      },
    };
  }

  private async extractPdf(filePath: string): Promise<ExtractResult> {
    // Lazy-load pdf-parse to avoid startup cost when not needed
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const pdfParse = require("pdf-parse") as (
      buffer: Buffer,
      opts?: { max?: number },
    ) => Promise<{ text: string; numpages: number }>;

    const buffer = await fs.readFile(filePath);
    const result = await pdfParse(buffer);

    const raw             = result.text ?? "";
    const originalLength  = raw.length;
    const truncated       = raw.length > this.charCap;
    const text            = truncated ? raw.slice(0, this.charCap) : raw;

    return {
      ok: true,
      file: {
        filePath,
        fileType:   "pdf",
        text,
        truncated,
        originalLength,
        pageCount:  result.numpages,
        isImage:    false,
      },
    };
  }

  private async extractDocx(filePath: string): Promise<ExtractResult> {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const mammoth = require("mammoth") as {
      extractRawText: (opts: { path: string }) => Promise<{ value: string }>;
    };

    const result          = await mammoth.extractRawText({ path: filePath });
    const raw             = result.value ?? "";
    const originalLength  = raw.length;
    const truncated       = raw.length > this.charCap;
    const text            = truncated ? raw.slice(0, this.charCap) : raw;

    return {
      ok: true,
      file: {
        filePath,
        fileType:      "docx",
        text,
        truncated,
        originalLength,
        isImage:       false,
      },
    };
  }

  private async extractText(filePath: string, fileType: SupportedFileType): Promise<ExtractResult> {
    const raw             = await fs.readFile(filePath, "utf-8");
    const originalLength  = raw.length;
    const truncated       = raw.length > this.charCap;
    const text            = truncated ? raw.slice(0, this.charCap) : raw;

    return {
      ok: true,
      file: {
        filePath,
        fileType,
        text,
        truncated,
        originalLength,
        isImage:       false,
      },
    };
  }

  // ── Type detection ────────────────────────────────────────────────────────

  private detectType(ext: string): SupportedFileType {
    const map: Record<string, SupportedFileType> = {
      ".pdf":  "pdf",
      ".docx": "docx",
      ".txt":  "txt",
      ".md":   "md",
      ".csv":  "csv",
      ".json": "json",
      ".png":  "png",
      ".jpg":  "jpg",
      ".jpeg": "jpeg",
      ".webp": "webp",
      ".gif":  "gif",
    };
    return map[ext] ?? "unknown";
  }
}
