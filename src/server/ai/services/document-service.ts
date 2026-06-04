import { createHash } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import type {
  DocumentKind,
  UploadDocumentRequest,
  UploadDocumentResponse,
} from "@/features/ai/contracts/documents";
import type { DocumentRepository } from "@/server/ai/repositories/document-repository";

const TEXT_KINDS = new Set<DocumentKind>(["txt", "md", "html"]);
const CHUNK_SIZE = 4_000;
const CHUNK_OVERLAP = 400;

export interface DocumentServiceDependencies {
  documentRepository: DocumentRepository;
  storageRoot?: string;
}

export class DocumentService {
  private readonly documentRepository: DocumentRepository;
  private readonly storageRoot: string;

  constructor(dependencies: DocumentServiceDependencies) {
    this.documentRepository = dependencies.documentRepository;
    this.storageRoot =
      dependencies.storageRoot ?? path.join(process.cwd(), "data", "uploads");
  }

  async uploadDocument(input: UploadDocumentRequest): Promise<UploadDocumentResponse> {
    const bytes = Buffer.from(input.contentBase64, "base64");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const kind = inferDocumentKind(input.fileName, input.mimeType);
    const safeName = sanitizeFileName(input.fileName);
    const projectStorageDir = path.join(this.storageRoot, input.projectId);
    const storagePath = path.join(projectStorageDir, `${sha256}-${safeName}`);
    const existingDocument = await this.documentRepository.getDocumentByProjectHash(
      input.projectId,
      sha256,
    );

    if (existingDocument) {
      const existingChunks = await this.documentRepository.listChunksByDocument(
        existingDocument.id,
      );

      return {
        document: existingDocument,
        chunksCreated: existingChunks.length,
        warning: "Document already exists for this project; reused existing record.",
      };
    }

    await mkdir(projectStorageDir, { recursive: true });
    await writeFile(storagePath, bytes);

    const extracted = await extractDocumentText(bytes, kind);
    const document = await this.documentRepository.createDocument({
      id: nanoid(),
      projectId: input.projectId,
      name: input.fileName,
      kind,
      mimeType: input.mimeType,
      sizeBytes: bytes.byteLength,
      storagePath,
      sha256,
      status: extracted.text ? "parsed" : "uploaded",
      parserVersion: extracted.parserVersion,
      chunkerVersion: extracted.text ? "local-char-chunker-v1" : undefined,
      parseError: extracted.warning,
    });

    const chunks = extracted.text
      ? await this.documentRepository.insertChunks(
          chunkText(extracted.text).map((chunk, index) => ({
            id: nanoid(),
            documentId: document.id,
            chunkIndex: index,
            content: chunk.content,
            tokenCount: estimateTokens(chunk.content),
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
            contentHash: createHash("sha256").update(chunk.content).digest("hex"),
          })),
        )
      : [];

    if (chunks.length > 0) {
      await this.documentRepository.updateDocumentStatus(document.id, "indexed");
    }

    return {
      document: (await this.documentRepository.getDocument(document.id)) ?? document,
      chunksCreated: chunks.length,
      extractedText: extracted.text,
      warning: extracted.warning,
    };
  }
}

function inferDocumentKind(fileName: string, mimeType: string): DocumentKind {
  const extension = path.extname(fileName).toLowerCase();
  const normalizedMime = mimeType.toLowerCase();

  if (extension === ".pdf" || normalizedMime.includes("pdf")) {
    return "pdf";
  }

  if (extension === ".png" || normalizedMime.includes("png")) {
    return "png";
  }

  if (
    [".jpg", ".jpeg"].includes(extension) ||
    normalizedMime.includes("jpeg") ||
    normalizedMime.includes("jpg")
  ) {
    return "jpeg";
  }

  if (extension === ".md" || normalizedMime.includes("markdown")) {
    return "md";
  }

  if (extension === ".html" || normalizedMime.includes("html")) {
    return "html";
  }

  if (extension === ".docx") {
    return "docx";
  }

  return "txt";
}

async function extractDocumentText(
  bytes: Buffer,
  kind: DocumentKind,
): Promise<{ text?: string; parserVersion?: string; warning?: string }> {
  if (TEXT_KINDS.has(kind)) {
    return {
      text: bytes.toString("utf8"),
      parserVersion: "local-text-parser-v1",
    };
  }

  if (kind === "pdf") {
    const parsed = await extractPdfText(bytes);
    const text = parsed.text ?? extractPrintablePdfText(bytes);
    return text
      ? {
          text,
          parserVersion: parsed.parserVersion,
          warning: parsed.warning,
        }
      : {
          parserVersion: parsed.parserVersion,
          warning:
            parsed.warning ??
            "PDF stored, but no extractable text was found by the parser.",
        };
  }

  if (kind === "png" || kind === "jpeg") {
    return extractImageText(bytes);
  }

  return {
    warning: "Document stored, but this file type does not have a parser yet.",
  };
}

async function extractPdfText(
  bytes: Buffer,
): Promise<{ text?: string; parserVersion: string; warning?: string }> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      const text = result.text?.trim();

      return {
        text: text && text.length >= 20 ? text : undefined,
        parserVersion: "pdf-parse-v1",
      };
    } finally {
      await parser.destroy();
    }
  } catch (error) {
    return {
      parserVersion: "local-pdf-printable-text-v1",
      warning:
        error instanceof Error
          ? `PDF parser failed, used fallback extraction when possible: ${error.message}`
          : "PDF parser failed, used fallback extraction when possible.",
    };
  }
}

async function extractImageText(
  bytes: Buffer,
): Promise<{ text?: string; parserVersion: string; warning?: string }> {
  try {
    const tesseractModule = await import("tesseract.js");
    const worker = await tesseractModule.createWorker("eng");
    const result = await worker.recognize(bytes);
    await worker.terminate();
    const text = result.data.text.trim();

    return {
      text: text.length >= 10 ? text : undefined,
      parserVersion: "tesseract-js-eng-v1",
      warning: text.length >= 10 ? undefined : "Image OCR completed but found little or no text.",
    };
  } catch (error) {
    return {
      parserVersion: "tesseract-js-eng-v1",
      warning:
        error instanceof Error
          ? `Image OCR failed: ${error.message}`
          : "Image OCR failed.",
    };
  }
}

function extractPrintablePdfText(bytes: Buffer): string | undefined {
  const raw = bytes.toString("latin1");
  const matches = raw.match(/\(([^()]{8,})\)/g) ?? [];
  const text = matches
    .map((match) => match.slice(1, -1).replace(/\\([()\\])/g, "$1"))
    .join("\n")
    .replace(/[^\t\n\r -~]+/g, " ")
    .replace(/[ \t]{2,}/g, " ")
    .trim();

  return text.length >= 40 ? text : undefined;
}

function chunkText(text: string): Array<{ content: string; charStart: number; charEnd: number }> {
  const chunks: Array<{ content: string; charStart: number; charEnd: number }> = [];
  let cursor = 0;

  while (cursor < text.length) {
    const end = Math.min(cursor + CHUNK_SIZE, text.length);
    const content = text.slice(cursor, end).trim();
    if (content) {
      chunks.push({ content, charStart: cursor, charEnd: end });
    }

    if (end === text.length) {
      break;
    }

    cursor = Math.max(end - CHUNK_OVERLAP, cursor + 1);
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "upload";
}
