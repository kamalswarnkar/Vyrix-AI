import { nanoid } from "nanoid";

import type { DocumentChunk } from "@/features/ai/contracts/documents";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";
import type { VectorRepository } from "@/server/ai/repositories/vector-repository";

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
    documentId: string;
    chunks: DocumentChunk[];
  }): Promise<{ indexed: number; dimensions?: number }> {
    const vectorRecords = [];

    for (const chunk of input.chunks) {
      const vector = await this.embedText(chunk.content);
      vectorRecords.push({
        id: nanoid(),
        documentId: input.documentId,
        chunkId: chunk.id,
        vectorStore: "sqlite-faiss" as const,
        embeddingModel: this.embeddingModel,
        dimensions: vector.length,
        vector,
      });
    }

    await this.vectorRepository.insertVectors(vectorRecords);

    return {
      indexed: vectorRecords.length,
      dimensions: vectorRecords[0]?.dimensions,
    };
  }
}
