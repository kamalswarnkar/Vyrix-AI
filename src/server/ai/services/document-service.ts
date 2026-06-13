import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { nanoid } from "nanoid";

import type {
  DocumentKind,
  UploadDocumentRequest,
  UploadDocumentResponse,
} from "@/features/ai/contracts/documents";
import type { DocumentRepository } from "@/server/ai/repositories/document-repository";
import type { VectorRepository } from "@/server/ai/repositories/vector-repository";
import { AiError } from "@/server/ai/errors/ai-errors";
import type { EmbeddingService } from "@/server/ai/services/embedding-service";

const TEXT_KINDS = new Set<DocumentKind>(["txt", "md", "html"]);
const CHUNK_SIZE = 4_000;
const CHUNK_OVERLAP_PARAGRAPHS = 1;

export interface DocumentServiceDependencies {
  documentRepository: DocumentRepository;
  vectorRepository?: VectorRepository;
  embeddingService?: EmbeddingService;
  storageRoot?: string;
}

export class DocumentService {
  private readonly documentRepository: DocumentRepository;
  private readonly vectorRepository?: VectorRepository;
  private readonly embeddingService?: EmbeddingService;
  private readonly storageRoot: string;

  constructor(dependencies: DocumentServiceDependencies) {
    this.documentRepository = dependencies.documentRepository;
    this.vectorRepository = dependencies.vectorRepository;
    this.embeddingService = dependencies.embeddingService;
    this.storageRoot =
      dependencies.storageRoot ?? path.join(process.cwd(), "data", "uploads");
  }

  async uploadDocument(input: UploadDocumentRequest): Promise<UploadDocumentResponse> {
    const bytes = Buffer.from(input.contentBase64, "base64");
    const sha256 = createHash("sha256").update(bytes).digest("hex");
    const kind = inferDocumentKind(input.fileName, input.mimeType);
    const safeName = sanitizeFileName(input.fileName);
    const projectStorageDir = resolveProjectStorageDir(this.storageRoot, input.projectId);
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
      chunkerVersion: extracted.text ? "local-para-chunker-v1" : undefined,
      parseError: extracted.warning,
    });

    const chunks = extracted.text
      ? await this.documentRepository.insertChunks(
          chunkText(extracted.text, extracted.numPages).map((chunk, index) => ({
            id: nanoid(),
            documentId: document.id,
            chunkIndex: index,
            content: chunk.content,
            tokenCount: estimateTokens(chunk.content),
            charStart: chunk.charStart,
            charEnd: chunk.charEnd,
            pageStart: chunk.pageStart,
            pageEnd: chunk.pageEnd,
            contentHash: createHash("sha256").update(chunk.content).digest("hex"),
          })),
        )
      : [];

    if (chunks.length > 0 && this.embeddingService) {
      try {
        const indexResult = await this.embeddingService.indexChunks({
          projectId: input.projectId,
          documentId: document.id,
          chunks,
        });
        await this.documentRepository.updateDocumentIndexMetadata({
          documentId: document.id,
          status: "indexed",
          embeddingModel: this.embeddingService.model,
          parseError: extracted.warning,
        });

        return {
          document: (await this.documentRepository.getDocument(document.id)) ?? document,
          chunksCreated: chunks.length,
          extractedText: extracted.text,
          warning: indexResult.indexed
            ? extracted.warning
            : "Document text was chunked, but no vectors were indexed.",
        };
      } catch (error) {
        await this.documentRepository.updateDocumentStatus(
          document.id,
          "chunking",
          error instanceof Error
            ? `Chunked text, but local embedding generation failed: ${error.message}`
            : "Chunked text, but local embedding generation failed.",
        );
      }
    }

    if (chunks.length > 0) {
      await this.documentRepository.updateDocumentStatus(
        document.id,
        "chunking",
        extracted.warning,
      );
    }

    return {
      document: (await this.documentRepository.getDocument(document.id)) ?? document,
      chunksCreated: chunks.length,
      extractedText: extracted.text,
      warning: extracted.warning,
    };
  }

  async deleteDocument(documentId: string): Promise<void> {
    const document = await this.documentRepository.deleteDocument(documentId);
    if (!document) {
      throw new AiError(`Document ${documentId} was not found.`, {
        code: "DOCUMENT_NOT_FOUND",
        statusCode: 404,
      });
    }

    await rm(document.storagePath, { force: true });

    // Rebuild FAISS index for the project, excluding the deleted document's vectors.
    if (this.vectorRepository && this.embeddingService) {
      await this.vectorRepository.rebuildProjectIndex(
        document.projectId,
        this.embeddingService.model,
      );
    }
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
): Promise<{ text?: string; numPages?: number; parserVersion?: string; warning?: string }> {
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
          numPages: parsed.numPages,
          parserVersion: parsed.parserVersion,
          warning: parsed.warning,
        }
      : {
          numPages: parsed.numPages,
          parserVersion: parsed.parserVersion,
          warning:
            parsed.warning ??
            "PDF stored, but no extractable text was found by the parser.",
        };
  }

  if (kind === "png" || kind === "jpeg") {
    return extractImageText(bytes);
  }

  if (kind === "docx") {
    return extractDocxText(bytes);
  }

  return {
    warning: "Document stored, but this file type does not have a parser yet.",
  };
}

async function extractPdfText(
  bytes: Buffer,
): Promise<{ text?: string; numPages?: number; parserVersion: string; warning?: string }> {
  try {
    const { PDFParse } = await import("pdf-parse");
    const parser = new PDFParse({ data: bytes });
    try {
      const result = await parser.getText();
      const text = result.text?.trim();
      const resultAny = result as unknown as Record<string, unknown>;
      const numPages: number | undefined =
        (resultAny.numPages as number | undefined) ??
        (resultAny.numpages as number | undefined);

      return {
        text: text && text.length >= 20 ? text : undefined,
        numPages,
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

async function extractDocxText(
  bytes: Buffer,
): Promise<{ text?: string; parserVersion: string; warning?: string }> {
  try {
    const mammoth = await import("mammoth");
    const result = await mammoth.extractRawText({ buffer: bytes });
    const text = result.value.trim();
    const warnings = result.messages
      .filter((m) => m.type === "warning")
      .map((m) => m.message)
      .join("; ");

    return {
      text: text.length >= 20 ? text : undefined,
      parserVersion: "mammoth-docx-v1",
      warning: warnings || undefined,
    };
  } catch (error) {
    return {
      parserVersion: "mammoth-docx-v1",
      warning:
        error instanceof Error
          ? `DOCX parser failed: ${error.message}`
          : "DOCX parser failed.",
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

  return text.length >= 40 && isLikelyReadableText(text) ? text : undefined;
}

function chunkText(
  text: string,
  numPages?: number,
): Array<{ content: string; charStart: number; charEnd: number; pageStart?: number; pageEnd?: number }> {
  const totalChars = text.length;

  const estimatePage = numPages
    ? (pos: number) => Math.max(1, Math.ceil((pos / totalChars) * numPages))
    : undefined;

  const paragraphs = text.split(/\n{2,}/);
  const chunks: Array<{ content: string; charStart: number; charEnd: number; pageStart?: number; pageEnd?: number }> = [];

  let currentParagraphs: string[] = [];
  let currentLength = 0;
  let chunkCharStart = 0;
  let cursor = 0;

  for (const paragraph of paragraphs) {
    const paraStart = text.indexOf(paragraph, cursor);
    cursor = paraStart + paragraph.length;
    const paraContent = paragraph.trim();
    if (!paraContent) {
      continue;
    }

    const wouldExceed = currentLength + paraContent.length > CHUNK_SIZE;
    const canFlush = currentParagraphs.length > 0;

    if (wouldExceed && canFlush) {
      const content = currentParagraphs.join("\n\n");
      const charEnd = paraStart;
      chunks.push({
        content,
        charStart: chunkCharStart,
        charEnd,
        pageStart: estimatePage ? estimatePage(chunkCharStart) : undefined,
        pageEnd: estimatePage ? estimatePage(charEnd) : undefined,
      });

      const overlap = currentParagraphs.slice(-CHUNK_OVERLAP_PARAGRAPHS);
      currentParagraphs = [...overlap, paraContent];
      currentLength = currentParagraphs.reduce((sum, p) => sum + p.length, 0);
      chunkCharStart = paraStart;
    } else {
      if (currentParagraphs.length === 0) {
        chunkCharStart = paraStart;
      }
      currentParagraphs.push(paraContent);
      currentLength += paraContent.length;
    }
  }

  if (currentParagraphs.length > 0) {
    const content = currentParagraphs.join("\n\n");
    chunks.push({
      content,
      charStart: chunkCharStart,
      charEnd: totalChars,
      pageStart: estimatePage ? estimatePage(chunkCharStart) : undefined,
      pageEnd: estimatePage ? estimatePage(totalChars) : undefined,
    });
  }

  return chunks;
}

function estimateTokens(text: string): number {
  return Math.ceil(text.length / 4);
}

function sanitizeFileName(fileName: string): string {
  return fileName.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "upload";
}

function isLikelyReadableText(text: string): boolean {
  const normalized = text.replace(/\s+/g, " ").trim();
  const alphaNumericMatches = normalized.match(/[A-Za-z0-9]/g) ?? [];
  const wordMatches = normalized.match(/[A-Za-z]{3,}/g) ?? [];
  const ratio = alphaNumericMatches.length / Math.max(normalized.length, 1);

  return ratio >= 0.45 && wordMatches.length >= 12;
}

function resolveProjectStorageDir(storageRoot: string, projectId: string): string {
  const safeProjectSegment =
    projectId.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "project";
  const absoluteRoot = path.resolve(storageRoot);
  const absoluteProjectDir = path.resolve(absoluteRoot, safeProjectSegment);

  if (
    absoluteProjectDir !== absoluteRoot &&
    !absoluteProjectDir.startsWith(`${absoluteRoot}${path.sep}`)
  ) {
    throw new Error("Resolved upload directory must stay inside the configured storage root.");
  }

  return absoluteProjectDir;
}
