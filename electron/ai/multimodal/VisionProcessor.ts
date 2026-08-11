/**
 * VisionProcessor.ts  (M21)
 *
 * Prepares image attachments for multimodal inference with Qwen2.5-VL.
 * Converts image files to base64 data URLs and wraps them in the
 * OpenAI-compatible vision message format.
 *
 * Responsibilities:
 *   - Validate image dimensions and MIME type
 *   - Encode images as base64 data URLs
 *   - Build vision-compatible message content arrays
 *   - Provide a text+image message builder for the chat interface
 *
 * Qwen2.5-VL supports: PNG, JPEG, WebP, GIF
 * Maximum recommended image size: 1024px per side (resized if larger)
 *
 * Note: Image resizing requires the 'sharp' package as an optional dependency.
 * If sharp is not installed, oversized images are sent as-is with a warning.
 */

import * as fs   from "node:fs/promises";
import * as path from "node:path";
import { FileExtractor }    from "./FileExtractor";
import type { VisionProcessorOptions } from "./types";
import type { ChatMessage } from "../core/types";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface VisionPrepareResult {
  ok:        boolean;
  /**
   * Ollama-native chat message: content = text string, images = raw base64 array.
   * Compatible with core/types.ts ChatMessage and OllamaAdapter directly.
   */
  message?:  ChatMessage;
  warnings?: string[];
  error?:    string;
}

// ─── VisionProcessor ─────────────────────────────────────────────────────────

export class VisionProcessor {
  private readonly extractor:     FileExtractor;
  private readonly maxDimension:  number;

  constructor(opts: VisionProcessorOptions = {}) {
    this.extractor    = new FileExtractor();
    // VYRIX_MAX_IMAGE_DIM: per-developer cap on vision input (fewer vision tokens on low-RAM machines)
    this.maxDimension = opts.maxDimension ?? (Number(process.env["VYRIX_MAX_IMAGE_DIM"]) || 1024);
  }

  /**
   * Prepare a vision message from a text prompt and one or more image file paths.
   * Returns a content array ready for the messages array in an inference request.
   */
  async prepare(
    textPrompt: string,
    imagePaths: string[],
  ): Promise<VisionPrepareResult> {
    const warnings: string[] = [];
    const images:   string[] = [];

    // ── Process each image ────────────────────────────────────────────────
    for (const imgPath of imagePaths) {
      const ext = path.extname(imgPath).toLowerCase();
      const supportedExts = new Set([".png", ".jpg", ".jpeg", ".webp", ".gif"]);

      if (!supportedExts.has(ext)) {
        warnings.push(`Skipping unsupported image format: ${ext} (${path.basename(imgPath)})`);
        continue;
      }

      const extractResult = await this.extractor.extract(imgPath);
      if (!extractResult.ok || !extractResult.file?.dataUrl) {
        warnings.push(`Could not extract image: ${path.basename(imgPath)}`);
        continue;
      }

      // ── Attempt resize if sharp is available ──────────────────────────
      let dataUrl = extractResult.file.dataUrl;
      const resizeResult = await this.tryResize(imgPath, extractResult.file.mimeType ?? "image/png");
      if (resizeResult) {
        dataUrl = resizeResult;
      } else {
        warnings.push(
          `Image ${path.basename(imgPath)} was not resized (sharp not installed). ` +
          `If it exceeds ${this.maxDimension}px, inference quality may degrade.`,
        );
      }

      // Strip "data:mime;base64," prefix — Ollama wants raw base64
      images.push(dataUrl.replace(/^data:[^;]+;base64,/, ""));
    }

    if (!textPrompt.trim() && images.length === 0) {
      return { ok: false, error: "No valid content was built", warnings };
    }

    // Return Ollama-native ChatMessage format: content=string, images=base64[]
    const message: ChatMessage = {
      role:    "user",
      content: textPrompt.trim() || ".",
      images:  images.length > 0 ? images : undefined,
    };

    return {
      ok:       true,
      message,
      warnings: warnings.length > 0 ? warnings : undefined,
    };
  }

  /**
   * Build a flat content string for backends that don't support vision.
   * Returns the text prompt with image file names appended as notes.
   */
  buildFallbackText(textPrompt: string, imagePaths: string[]): string {
    if (imagePaths.length === 0) return textPrompt;
    const names = imagePaths.map((p) => path.basename(p)).join(", ");
    return `${textPrompt}\n\n[Attached images: ${names}]`;
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async tryResize(imagePath: string, mimeType: string): Promise<string | null> {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      // sharp >=0.35 types the CJS export as a namespace with callable default
      const mod   = require("sharp") as { default?: typeof import("sharp").default };
      const sharp = (mod.default ?? mod) as typeof import("sharp").default;
      const buffer = await sharp(imagePath)
        .resize(this.maxDimension, this.maxDimension, {
          fit:        "inside",
          withoutEnlargement: true,
        })
        .toBuffer();

      const base64 = buffer.toString("base64");
      return `data:${mimeType};base64,${base64}`;
    } catch {
      // sharp not installed or resize failed — return null to use original
      return null;
    }
  }

  /**
   * Returns true if the given file path is a supported image format.
   */
  static isSupportedImage(filePath: string): boolean {
    const ext = path.extname(filePath).toLowerCase();
    return [".png", ".jpg", ".jpeg", ".webp", ".gif"].includes(ext);
  }

  /**
   * Estimate the token cost of including an image.
   * Qwen2.5-VL uses approximately 1280 tokens per image at 1024x1024.
   */
  static estimateImageTokens(imagePath: string): number {
    // Conservative estimate — actual cost depends on image content
    return 1280;
  }
}
