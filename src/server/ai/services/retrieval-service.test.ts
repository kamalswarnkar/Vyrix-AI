import { describe, expect, it } from "vitest";

import type { DocumentChunk } from "@/features/ai/contracts/documents";
import type { DocumentRepository } from "@/server/ai/repositories/document-repository";
import { RetrievalService } from "@/server/ai/services/retrieval-service";

describe("RetrievalService", () => {
  it("builds chat attachment context from retrieved chunks", async () => {
    const chunk: DocumentChunk & { documentName: string; score: number } = {
      id: "chunk-1",
      documentId: "doc-1",
      documentName: "paper.pdf",
      chunkIndex: 0,
      content: "This paper evaluates retrieval augmented generation for research assistants.",
      tokenCount: 16,
      charStart: 0,
      charEnd: 78,
      contentHash: "hash",
      score: 3,
    };
    const service = new RetrievalService({
      documentRepository: {
        searchChunks: async () => [chunk],
      } as Partial<DocumentRepository> as DocumentRepository,
    });

    const context = await service.buildChatContext({
      projectId: "project-1",
      query: "retrieval research assistant",
    });

    expect(context.retrievalQuery).toBe("retrieval research assistant");
    expect(context.attachmentRefs).toHaveLength(1);
    expect(context.attachmentRefs?.[0]).toMatchObject({
      documentId: "doc-1",
      chunkIds: ["chunk-1"],
      label: "paper.pdf",
      kind: "text",
    });
    expect(context.attachmentRefs?.[0]?.summary).toContain(
      "retrieval augmented generation",
    );
  });
});
