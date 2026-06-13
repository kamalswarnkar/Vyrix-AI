import type Database from "better-sqlite3";

import type {
  InsertVectorRecordInput,
  VectorRepository,
  VectorSearchHit,
  VectorSearchInput,
  VectorStoreKind,
} from "@/server/ai/repositories/vector-repository";

interface VectorRow {
  id: string;
  document_id: string;
  chunk_id: string;
  vector_store: VectorStoreKind;
  embedding_model: string;
  dimensions: number;
  vector_json: string | null;
  document_name: string;
  chunk_index: number;
  content: string;
  token_count: number;
  char_start: number;
  char_end: number;
  page_start: number | null;
  page_end: number | null;
  section_title: string | null;
  content_hash: string;
}

export class SqliteVectorRepository implements VectorRepository {
  constructor(private readonly db: Database.Database) {}

  async insertVectors(vectors: InsertVectorRecordInput[]): Promise<void> {
    if (vectors.length === 0) {
      return;
    }

    const insert = this.db.prepare(
      `
        INSERT OR REPLACE INTO vector_indexes (
          id, document_id, chunk_id, vector_store, embedding_model, dimensions,
          vector_json, created_at
        ) VALUES (
          @id, @document_id, @chunk_id, @vector_store, @embedding_model,
          @dimensions, @vector_json, @created_at
        )
      `,
    );
    const now = new Date().toISOString();
    const transaction = this.db.transaction((items: InsertVectorRecordInput[]) => {
      for (const item of items) {
        insert.run({
          id: item.id,
          document_id: item.documentId,
          chunk_id: item.chunkId,
          vector_store: item.vectorStore,
          embedding_model: item.embeddingModel,
          dimensions: item.dimensions,
          vector_json: JSON.stringify(item.vector),
          created_at: now,
        });
      }
    });

    transaction(vectors);
  }

  async searchSimilar(input: VectorSearchInput): Promise<VectorSearchHit[]> {
    const rows = this.db
      .prepare(
        `
          SELECT
            vi.*,
            d.name AS document_name,
            dc.chunk_index,
            dc.content,
            dc.token_count,
            dc.char_start,
            dc.char_end,
            dc.page_start,
            dc.page_end,
            dc.section_title,
            dc.content_hash
          FROM vector_indexes vi
          INNER JOIN documents d ON d.id = vi.document_id
          INNER JOIN document_chunks dc ON dc.id = vi.chunk_id
          WHERE d.project_id = ?
            AND vi.embedding_model = ?
            AND vi.vector_json IS NOT NULL
            AND (? IS NULL OR d.id = ?)
            AND (? IS NULL OR vi.vector_store = ?)
        `,
      )
      .all(
        input.projectId,
        input.embeddingModel,
        input.documentId ?? null,
        input.documentId ?? null,
        input.vectorStore ?? null,
        input.vectorStore ?? null,
      ) as VectorRow[];

    return rows
      .map((row) => {
        const vector = parseVector(row.vector_json);
        return {
          id: row.chunk_id,
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
          documentName: row.document_name,
          score: vector ? cosineSimilarity(input.queryVector, vector) : -1,
          vectorStore: row.vector_store,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK);
  }
}

function parseVector(value: string | null): number[] | null {
  if (!value) {
    return null;
  }

  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "number")
    ? parsed
    : null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  if (length === 0) {
    return 0;
  }

  let dot = 0;
  let aNorm = 0;
  let bNorm = 0;

  for (let index = 0; index < length; index += 1) {
    dot += a[index] * b[index];
    aNorm += a[index] * a[index];
    bNorm += b[index] * b[index];
  }

  if (aNorm === 0 || bNorm === 0) {
    return 0;
  }

  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}
