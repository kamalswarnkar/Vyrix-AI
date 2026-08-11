/**
 * types.ts — Multimodal module type definitions
 */

// ─── File Extractor ───────────────────────────────────────────────────────────

export type SupportedFileType =
  | "pdf"
  | "docx"
  | "txt"
  | "md"
  | "csv"
  | "json"
  | "png"
  | "jpg"
  | "jpeg"
  | "webp"
  | "gif"
  | "unknown";

export interface ExtractedFile {
  /** Original file path */
  filePath:     string;
  /** Detected file type */
  fileType:     SupportedFileType;
  /** Extracted text content (empty for image-only files) */
  text:         string;
  /** True if the text was truncated to the char cap */
  truncated:    boolean;
  /** Original character count before truncation */
  originalLength: number;
  /** Page count (PDF only) */
  pageCount?:   number;
  /** Whether the file is an image to be sent as a base64 data URL */
  isImage:      boolean;
  /** Base64 data URL for images (data:image/png;base64,...) */
  dataUrl?:     string;
  /** MIME type (for images) */
  mimeType?:    string;
}

export interface ExtractResult {
  ok:     boolean;
  file?:  ExtractedFile;
  error?: string;
}

export interface FileExtractorOptions {
  /** Maximum characters to extract before truncation. Default: 24000 */
  charCap?: number;
}

// ─── Vision Processor ────────────────────────────────────────────────────────

export interface VisionProcessorOptions {
  /** Maximum image dimension in pixels (images are resized if larger). Default: 1024 */
  maxDimension?: number;
}
