import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import path from "node:path";

import { aiLogger } from "@/lib/observability/ai-logger";

interface ProjectIndex {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  index: any;
  chunkIds: string[];
}

export interface FaissSearchHit {
  chunkId: string;
  score: number;
}

export class FaissIndexService {
  private readonly cache = new Map<string, ProjectIndex>();
  private readonly indexDir: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private faissModule: any = null;

  constructor(indexDir: string) {
    this.indexDir = path.resolve(indexDir);
    mkdirSync(this.indexDir, { recursive: true });
  }

  async addVectors(
    projectId: string,
    embeddingModel: string,
    vectors: Array<{ chunkId: string; vector: number[] }>,
  ): Promise<void> {
    if (vectors.length === 0) return;

    const faiss = await this.requireFaiss();
    if (!faiss) return;

    const dimensions = vectors[0].vector.length;
    const key = this.cacheKey(projectId, embeddingModel);
    const entry = await this.load(key, faiss, dimensions);

    for (const { chunkId, vector } of vectors) {
      entry.index.add(normalizeL2(vector));
      entry.chunkIds.push(chunkId);
    }

    this.persist(key, entry);
    aiLogger.info({
      event: "faiss.vectors.added",
      details: { projectId, embeddingModel, count: vectors.length, total: entry.chunkIds.length },
    });
  }

  async search(
    projectId: string,
    embeddingModel: string,
    queryVector: number[],
    topK: number,
  ): Promise<FaissSearchHit[]> {
    const faiss = await this.requireFaiss();
    if (!faiss) return [];

    const key = this.cacheKey(projectId, embeddingModel);
    const entry = this.loadFromCache(key) ?? (await this.loadFromDisk(key, faiss));
    if (!entry || entry.chunkIds.length === 0) return [];

    const k = Math.min(topK, entry.chunkIds.length);
    const result = entry.index.search(normalizeL2(queryVector), k) as {
      labels: number[];
      distances: number[];
    };

    return result.labels
      .map((label, i) => ({
        chunkId: entry.chunkIds[label] ?? "",
        score: result.distances[i] ?? 0,
      }))
      .filter((hit) => hit.chunkId && hit.score > 0);
  }

  async rebuild(
    projectId: string,
    embeddingModel: string,
    vectors: Array<{ chunkId: string; vector: number[] }>,
  ): Promise<void> {
    const faiss = await this.requireFaiss();
    if (!faiss) return;

    const key = this.cacheKey(projectId, embeddingModel);
    this.cache.delete(key);

    const { idxPath, mapPath } = this.paths(key);
    if (existsSync(idxPath)) rmSync(idxPath);
    if (existsSync(mapPath)) rmSync(mapPath);

    if (vectors.length === 0) return;

    const dimensions = vectors[0].vector.length;
    const entry: ProjectIndex = {
      index: new faiss.IndexFlatIP(dimensions),
      chunkIds: [],
    };

    for (const { chunkId, vector } of vectors) {
      entry.index.add(normalizeL2(vector));
      entry.chunkIds.push(chunkId);
    }

    this.cache.set(key, entry);
    this.persist(key, entry);

    aiLogger.info({
      event: "faiss.index.rebuilt",
      details: { projectId, embeddingModel, total: entry.chunkIds.length },
    });
  }

  private async load(
    key: string,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    faiss: any,
    dimensions: number,
  ): Promise<ProjectIndex> {
    const fromDisk = await this.loadFromDisk(key, faiss);
    if (fromDisk) return fromDisk;

    const entry: ProjectIndex = {
      index: new faiss.IndexFlatIP(dimensions),
      chunkIds: [],
    };
    this.cache.set(key, entry);
    return entry;
  }

  private loadFromCache(key: string): ProjectIndex | null {
    return this.cache.get(key) ?? null;
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async loadFromDisk(key: string, faiss: any): Promise<ProjectIndex | null> {
    const { idxPath, mapPath } = this.paths(key);
    if (!existsSync(idxPath) || !existsSync(mapPath)) return null;

    try {
      const index = faiss.IndexFlatIP.read(idxPath);
      const chunkIds: string[] = JSON.parse(readFileSync(mapPath, "utf8"));
      const entry: ProjectIndex = { index, chunkIds };
      this.cache.set(key, entry);
      return entry;
    } catch (error) {
      aiLogger.warn({
        event: "faiss.index.load.failed",
        details: { key, error: error instanceof Error ? error.message : String(error) },
      });
      return null;
    }
  }

  private persist(key: string, entry: ProjectIndex): void {
    const { idxPath, mapPath } = this.paths(key);
    try {
      entry.index.write(idxPath);
      writeFileSync(mapPath, JSON.stringify(entry.chunkIds));
    } catch (error) {
      aiLogger.warn({
        event: "faiss.index.persist.failed",
        details: { key, error: error instanceof Error ? error.message : String(error) },
      });
    }
  }

  private cacheKey(projectId: string, embeddingModel: string): string {
    const safeProject = sanitizeSegment(projectId);
    const safeModel = sanitizeSegment(embeddingModel.replace(/[/:]/g, "-"));
    return `${safeProject}__${safeModel}`;
  }

  private paths(key: string): { idxPath: string; mapPath: string } {
    return {
      idxPath: path.join(this.indexDir, `${key}.faiss`),
      mapPath: path.join(this.indexDir, `${key}.map.json`),
    };
  }

  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private async requireFaiss(): Promise<any> {
    if (this.faissModule) return this.faissModule;

    try {
      const mod = await import("faiss-node");
      this.faissModule = mod;
      return mod;
    } catch (error) {
      aiLogger.warn({
        event: "faiss.unavailable",
        details: { error: error instanceof Error ? error.message : String(error) },
      });
      return null;
    }
  }
}

function normalizeL2(vector: number[]): number[] {
  let norm = 0;
  for (const v of vector) norm += v * v;
  norm = Math.sqrt(norm);
  if (norm === 0) return vector;
  return vector.map((v) => v / norm);
}

function sanitizeSegment(input: string): string {
  return input.replace(/[^a-z0-9._-]+/gi, "-").replace(/^-+|-+$/g, "") || "default";
}
