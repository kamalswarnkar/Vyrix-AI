import { describe, expect, it } from "vitest";

import {
  AiModelUnavailableError,
  AiProviderUnavailableError,
} from "@/server/ai/errors/ai-errors";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";

describe("OllamaClient", () => {
  it("surfaces provider-unavailable errors when Ollama cannot be reached", async () => {
    const client = new OllamaClient({
      baseUrl: "http://127.0.0.1:11434",
      fetchImpl: async () => {
        throw new TypeError("fetch failed");
      },
      requestTimeoutMs: 500,
    });

    await expect(client.listModels()).rejects.toBeInstanceOf(
      AiProviderUnavailableError,
    );
  });

  it("surfaces model-unavailable errors when Ollama rejects the requested model", async () => {
    const client = new OllamaClient({
      fetchImpl: async () =>
        new Response("model not found", {
          status: 404,
        }),
    });

    await expect(
      client.chat({
        model: "llama3.1:8b-instruct",
        messages: [{ role: "user", content: "hello" }],
      }),
    ).rejects.toBeInstanceOf(AiModelUnavailableError);
  });
});
