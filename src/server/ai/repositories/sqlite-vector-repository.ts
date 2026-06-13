import type Database from "better-sqlite3";

import type {
  InsertVectorRecordInput,
  VectorRepository,
  VectorSearchHit,
  VectorSearchInput,
  VectorStoreKind,
} from "@/server/ai/repositories/vector-repository";
import type { FaissIndexService } from "@/server/ai/services/faiss-index-service";

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

interface ChunkMetaRow {
  chunk_id: string;
  document_id: string;
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

interface RebuildRow {
  chunk_id: string;
  vector_json: string | null;
}

export class SqliteVectorRepository implements VectorRepository {
  constructor(
    private readonly db: Database.Database,
    private readonly faiss: FaissIndexService,
  ) {}

  async insertVectors(vectors: InsertVectorRecordInput[]): Promise<void> {
    if (vectors.length === 0) return;

    // Persist to SQLite (source of truth for metadata + rebuild)
    const insert = this.db.prepare(
      `INSERT OR REPLACE INTO vector_indexes (
         id, document_id, chunk_id, vector_store, embedding_model, dimensions,
         vector_json, created_at
       ) VALUES (
         @id, @document_id, @chunk_id, @vector_store, @embedding_model,
         @dimensions, @vector_json, @created_at
       )`,
    );
    const now = new Date().toISOString();
    this.db.transaction((items: InsertVectorRecordInput[]) => {
      for (const item of items) {
        insert.run({
          id: item.id,
          document_id: item.documentId,
          chunk_id: item.chunkId,
          vector_store: "faiss",
          embedding_model: item.embeddingModel,
          dimensions: item.dimensions,
          vector_json: JSON.stringify(item.vector),
          created_at: now,
        });
      }
    })(vectors);

    // Add to FAISS index for fast ANN search
    const byProject = groupByProject(vectors);
    for (const [projectId, group] of byProject) {
      const model = group[0].embeddingModel;
      await this.faiss.addVectors(
        projectId,
        model,
        group.map((v) => ({ chunkId: v.chunkId, vector: v.vector })),
      );
    }
  }

  async searchSimilar(input: VectorSearchInput): Promise<VectorSearchHit[]> {
    // Primary path: FAISS ANN search → fetch metadata from SQLite
    const faissHits = await this.faiss.search(
      input.projectId,
      input.embeddingModel,
      input.queryVector,
      input.topK,
    );

    if (faissHits.length > 0) {
      return this.fetchMetadata(faissHits, input);
    }

    // Fallback: brute-force in JS (first query after cold start, before FAISS index exists)
    return this.bruteForceSearch(input);
  }

  async rebuildProjectIndex(projectId: string, embeddingModel: string): Promise<void> {
    const rows = this.db
      .prepare(
        `SELECT vi.chunk_id, vi.vector_json
         FROM vector_indexes vi
         INNER JOIN documents d ON d.id = vi.document_id
         WHERE d.project_id = ?
           AND vi.embedding_model = ?
           AND vi.vector_json IS NOT NULL`,
      )
      .all(projectId, embeddingModel) as RebuildRow[];

    const vectors = rows
      .map((row) => {
        const vector = parseVector(row.vector_json);
        return vector ? { chunkId: row.chunk_id, vector } : null;
      })
      .filter((v): v is { chunkId: string; vector: number[] } => v !== null);

    await this.faiss.rebuild(projectId, embeddingModel, vectors);
  }

  // ── Private helpers ─────────────────────────────────────────

  private fetchMetadata(
    hits: Array<{ chunkId: string; score: number }>,
    input: VectorSearchInput,
  ): VectorSearchHit[] {
    if (hits.length === 0) return [];

    const placeholders = hits.map(() => "?").join(", ");
    const chunkIds = hits.map((h) => h.chunkId);

    const rows = this.db
      .prepare(
        `SELECT
           dc.id AS chunk_id,
           d.id  AS document_id,
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
         FROM document_chunks dc
         INNER JOIN documents d ON d.id = dc.document_id
         WHERE dc.id IN (${placeholders})
           AND d.project_id = ?
           AND (? IS NULL OR d.id = ?)`,
      )
      .all(
        ...chunkIds,
        input.projectId,
        input.documentId ?? null,
        input.documentId ?? null,
      ) as ChunkMetaRow[];

    const scoreByChunkId = new Map(hits.map((h) => [h.chunkId, h.score]));

    return rows
      .map((row) => ({
        id: row.chunk_id,
        documentId: row.document_id,
        documentName: row.document_name,
        chunkIndex: row.chunk_index,
        content: row.content,
        tokenCount: row.token_count,
        charStart: row.char_start,
        charEnd: row.char_end,
        pageStart: row.page_start ?? undefined,
        pageEnd: row.page_end ?? undefined,
        sectionTitle: row.section_title ?? undefined,
        contentHash: row.content_hash,
        score: scoreByChunkId.get(row.chunk_id) ?? 0,
        vectorStore: "faiss" as const,
      }))
      .sort((a, b) => b.score - a.score);
  }

  private bruteForceSearch(input: VectorSearchInput): VectorSearchHit[] {
    const rows = this.db
      .prepare(
        `SELECT
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
           AND (? IS NULL OR d.id = ?)`,
      )
      .all(
        input.projectId,
        input.embeddingModel,
        input.documentId ?? null,
        input.documentId ?? null,
      ) as VectorRow[];

    return rows
      .map((row) => {
        const vector = parseVector(row.vector_json);
        return {
          id: row.chunk_id,
          documentId: row.document_id,
          documentName: row.document_name,
          chunkIndex: row.chunk_index,
          content: row.content,
          tokenCount: row.token_count,
          charStart: row.char_start,
          charEnd: row.char_end,
          pageStart: row.page_start ?? undefined,
          pageEnd: row.page_end ?? undefined,
          sectionTitle: row.section_title ?? undefined,
          contentHash: row.content_hash,
          score: vector ? cosineSimilarity(input.queryVector, vector) : -1,
          vectorStore: row.vector_store,
        };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, input.topK);
  }
}

function groupByProject(
  vectors: InsertVectorRecordInput[],
): Map<string, InsertVectorRecordInput[]> {
  const map = new Map<string, InsertVectorRecordInput[]>();
  for (const v of vectors) {
    const group = map.get(v.projectId) ?? [];
    group.push(v);
    map.set(v.projectId, group);
  }
  return map;
}

function parseVector(value: string | null): number[] | null {
  if (!value) return null;
  const parsed = JSON.parse(value) as unknown;
  return Array.isArray(parsed) && parsed.every((item) => typeof item === "number")
    ? (parsed as number[])
    : null;
}

function cosineSimilarity(a: number[], b: number[]): number {
  const len = Math.min(a.length, b.length);
  if (len === 0) return 0;
  let dot = 0, aNorm = 0, bNorm = 0;
  for (let i = 0; i < len; i++) {
    dot   += a[i] * b[i];
    aNorm += a[i] * a[i];
    bNorm += b[i] * b[i];
  }
  if (aNorm === 0 || bNorm === 0) return 0;
  return dot / (Math.sqrt(aNorm) * Math.sqrt(bNorm));
}
