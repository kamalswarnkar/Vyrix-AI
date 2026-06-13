import { nanoid } from "nanoid";

import type { DocumentChunk } from "@/features/ai/contracts/documents";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";
import type { InsertVectorRecordInput, VectorRepository } from "@/server/ai/repositories/vector-repository";

export interface EmbeddingServiceDependencies {
  ollamaClient: OllamaClient;
  vectorRepository: VectorRepository;
  embeddingModel: string;
}

export class EmbeddingService {
  private readonly ollamaClient: OllamaClient;
  private readonly vectorRepository: VectorRepository;
  private readonly embeddingModel: string;

  constructor(dependencies: EmbeddingServiceDependencies) {
    this.ollamaClient = dependencies.ollamaClient;
    this.vectorRepository = dependencies.vectorRepository;
    this.embeddingModel = dependencies.embeddingModel;
  }

  get model(): string {
    return this.embeddingModel;
  }

  async embedText(text: string): Promise<number[]> {
    return this.ollamaClient.embed({
      model: this.embeddingModel,
      prompt: text,
    });
  }

  async indexChunks(input: {
    projectId: string;
    documentId: string;
    chunks: DocumentChunk[];
  }): Promise<{ indexed: number; dimensions?: number }> {
    const CONCURRENCY = 4;
    const vectorRecords: InsertVectorRecordInput[] = [];

    for (let i = 0; i < input.chunks.length; i += CONCURRENCY) {
      const batch = input.chunks.slice(i, i + CONCURRENCY);
      const vectors = await Promise.all(
        batch.map((chunk) => this.embedText(chunk.content)),
      );
      for (let j = 0; j < batch.length; j++) {
        vectorRecords.push({
          id: nanoid(),
          projectId: input.projectId,
          documentId: input.documentId,
          chunkId: batch[j].id,
          vectorStore: "faiss",
          embeddingModel: this.embeddingModel,
          dimensions: vectors[j].length,
          vector: vectors[j],
        });
      }
    }

    await this.vectorRepository.insertVectors(vectorRecords);

    return {
      indexed: vectorRecords.length,
      dimensions: vectorRecords[0]?.dimensions,
    };
  }
}
