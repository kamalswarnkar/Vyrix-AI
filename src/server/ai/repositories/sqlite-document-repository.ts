import type Database from "better-sqlite3";

import type {
  DocumentChunk,
  UploadedDocument,
} from "@/features/ai/contracts/documents";
import type {
  CreateDocumentRecordInput,
  DocumentRepository,
  InsertDocumentChunkInput,
} from "@/server/ai/repositories/document-repository";

interface DocumentRow {
  id: string;
  project_id: string;
  name: string;
  kind: UploadedDocument["kind"];
  mime_type: string;
  size_bytes: number;
  storage_path: string;
  sha256: string;
  status: UploadedDocument["status"];
  parser_version: string | null;
  chunker_version: string | null;
  embedding_model: string | null;
  parse_error: string | null;
  created_at: string;
  updated_at: string;
}

interface ChunkRow {
  id: string;
  document_id: string;
  document_name?: string;
  chunk_index: number;
  content: string;
  token_count: number;
  char_start: number;
  char_end: number;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  content_hash: string;
  created_at: string;
}

export class SqliteDocumentRepository implements DocumentRepository {
  constructor(private readonly db: Database.Database) {}

  async createDocument(input: CreateDocumentRecordInput): Promise<UploadedDocument> {
    const now = new Date().toISOString();
    this.db
      .prepare(
        `
          INSERT OR IGNORE INTO projects (
            id, workspace_id, name, created_at, updated_at
          ) VALUES (
            @id, @workspace_id, @name, @created_at, @updated_at
          )
        `,
      )
      .run({
        id: input.projectId,
        workspace_id: null,
        name: input.projectId,
        created_at: now,
        updated_at: now,
      });

    this.db
      .prepare(
        `
          INSERT INTO documents (
            id, project_id, name, kind, mime_type, size_bytes, storage_path,
            sha256, status, parser_version, chunker_version, embedding_model,
            parse_error, created_at, updated_at
          ) VALUES (
            @id, @project_id, @name, @kind, @mime_type, @size_bytes, @storage_path,
            @sha256, @status, @parser_version, @chunker_version, @embedding_model,
            @parse_error, @created_at, @updated_at
          )
        `,
      )
      .run({
        id: input.id,
        project_id: input.projectId,
        name: input.name,
        kind: input.kind,
        mime_type: input.mimeType,
        size_bytes: input.sizeBytes,
        storage_path: input.storagePath,
        sha256: input.sha256,
        status: input.status,
        parser_version: input.parserVersion ?? null,
        chunker_version: input.chunkerVersion ?? null,
        embedding_model: input.embeddingModel ?? null,
        parse_error: input.parseError ?? null,
        created_at: now,
        updated_at: now,
      });

    const document = await this.getDocument(input.id);
    if (!document) {
      throw new Error("Document creation failed");
    }

    return document;
  }

  async updateDocumentStatus(
    documentId: string,
    status: UploadedDocument["status"],
    parseError?: string,
  ): Promise<void> {
    this.db
      .prepare(
        `
          UPDATE documents
          SET status = ?, parse_error = ?, updated_at = ?
          WHERE id = ?
        `,
      )
      .run(status, parseError ?? null, new Date().toISOString(), documentId);
  }

  async listDocumentsByProject(projectId: string): Promise<UploadedDocument[]> {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM documents
          WHERE project_id = ?
          ORDER BY updated_at DESC
        `,
      )
      .all(projectId) as DocumentRow[];

    return rows.map((row) => this.mapDocument(row));
  }

  async getDocument(documentId: string): Promise<UploadedDocument | null> {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE id = ?")
      .get(documentId) as DocumentRow | undefined;

    return row ? this.mapDocument(row) : null;
  }

  async getDocumentByProjectHash(
    projectId: string,
    sha256: string,
  ): Promise<UploadedDocument | null> {
    const row = this.db
      .prepare("SELECT * FROM documents WHERE project_id = ? AND sha256 = ?")
      .get(projectId, sha256) as DocumentRow | undefined;

    return row ? this.mapDocument(row) : null;
  }

  async insertChunks(chunks: InsertDocumentChunkInput[]): Promise<DocumentChunk[]> {
    if (chunks.length === 0) {
      return [];
    }

    const insert = this.db.prepare(
      `
        INSERT INTO document_chunks (
          id, document_id, chunk_index, content, token_count, char_start, char_end,
          page_start, page_end, section_title, content_hash, created_at
        ) VALUES (
          @id, @document_id, @chunk_index, @content, @token_count, @char_start, @char_end,
          @page_start, @page_end, @section_title, @content_hash, @created_at
        )
      `,
    );
    const now = new Date().toISOString();
    const transaction = this.db.transaction((items: InsertDocumentChunkInput[]) => {
      for (const chunk of items) {
        insert.run({
          id: chunk.id,
          document_id: chunk.documentId,
          chunk_index: chunk.chunkIndex,
          content: chunk.content,
          token_count: chunk.tokenCount,
          char_start: chunk.charStart,
          char_end: chunk.charEnd,
          page_start: chunk.pageStart ?? null,
          page_end: chunk.pageEnd ?? null,
          section_title: chunk.sectionTitle ?? null,
          content_hash: chunk.contentHash,
          created_at: now,
        });
      }
    });

    transaction(chunks);
    return this.listChunksByDocument(chunks[0].documentId);
  }

  async listChunksByDocument(documentId: string): Promise<DocumentChunk[]> {
    const rows = this.db
      .prepare(
        `
          SELECT *
          FROM document_chunks
          WHERE document_id = ?
          ORDER BY chunk_index ASC
        `,
      )
      .all(documentId) as ChunkRow[];

    return rows.map((row) => this.mapChunk(row));
  }

  async searchChunks(input: {
    projectId: string;
    documentId?: string;
    query: string;
    topK: number;
  }): Promise<Array<DocumentChunk & { documentName: string; score: number }>> {
    const rows = this.db
      .prepare(
        `
          SELECT dc.*, d.name AS document_name
          FROM document_chunks dc
          INNER JOIN documents d ON d.id = dc.document_id
          WHERE d.project_id = ?
            AND (? IS NULL OR d.id = ?)
          ORDER BY dc.created_at DESC
        `,
      )
      .all(input.projectId, input.documentId ?? null, input.documentId ?? null) as ChunkRow[];

    const queryTerms = tokenize(input.query);
    return rows
      .map((row) => ({
        ...this.mapChunk(row),
        documentName: row.document_name ?? "Unknown document",
        score: scoreText(row.content, queryTerms),
      }))
      .filter((chunk) => chunk.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK);
  }

  private mapDocument(row: DocumentRow): UploadedDocument {
    return {
      id: row.id,
      projectId: row.project_id,
      name: row.name,
      kind: row.kind,
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      storagePath: row.storage_path,
      sha256: row.sha256,
      status: row.status,
      parserVersion: row.parser_version ?? undefined,
      chunkerVersion: row.chunker_version ?? undefined,
      embeddingModel: row.embedding_model ?? undefined,
      createdAt: row.created_at,
      updatedAt: row.updated_at,
    };
  }

  private mapChunk(row: ChunkRow): DocumentChunk {
    return {
      id: row.id,
      documentId: row.document_id,
      chunkIndex: row.chunk_index,
      content: row.content,
      tokenCount: row.token_count,
      charStart: row.char_start,
      charEnd: row.char_end,
      pageStart: row.page_start ?? undefined,
      pageEnd: row.page_end ?? undefined,
      sectionTitle: row.section_title ?? undefined,
      contentHash: row.content_hash,
    };
  }
}

function tokenize(input: string): string[] {
  return Array.from(
    new Set(
      input
        .toLowerCase()
        .split(/[^a-z0-9]+/i)
        .filter((term) => term.length >= 3),
    ),
  );
}

function scoreText(content: string, queryTerms: string[]): number {
  if (queryTerms.length === 0) {
    return 0;
  }

  const lower = content.toLowerCase();
  return queryTerms.reduce((score, term) => {
    const matches = lower.match(new RegExp(`\\b${escapeRegExp(term)}\\b`, "g"));
    return score + (matches?.length ?? 0);
  }, 0);
}

function escapeRegExp(input: string): string {
  return input.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}
