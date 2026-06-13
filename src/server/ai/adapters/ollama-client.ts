import type {
  ProviderChatMessage,
  ProviderChatResult,
  StreamedProviderChunk,
} from "@/features/ai/contracts/chat";
import {
  AiModelUnavailableError,
  AiProviderUnavailableError,
} from "@/server/ai/errors/ai-errors";

interface OllamaChatRequest {
  model: string;
  messages: ProviderChatMessage[];
  stream?: boolean;
  options?: {
    temperature?: number;
    num_predict?: number;
  };
}

interface OllamaClientOptions {
  baseUrl?: string;
  fetchImpl?: typeof fetch;
  requestTimeoutMs?: number;
  healthCheckTimeoutMs?: number;
}

interface OllamaTagListResponse {
  models?: Array<{
    name: string;
    size?: number;
    modified_at?: string;
  }>;
}

interface OllamaEmbeddingResponse {
  embedding?: number[];
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;
  private readonly requestTimeoutMs: number;
  private readonly healthCheckTimeoutMs: number;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.fetchImpl = options.fetchImpl ?? fetch;
    this.requestTimeoutMs = options.requestTimeoutMs ?? 120_000;
    this.healthCheckTimeoutMs = options.healthCheckTimeoutMs ?? 5_000;
  }

  async chat(input: OllamaChatRequest): Promise<ProviderChatResult> {
    const startedAt = Date.now();
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw await this.toHttpError(response, input.model);
    }

    const json = (await response.json()) as {
      model: string;
      message: { content: string };
      prompt_eval_count?: number;
      eval_count?: number;
      done_reason?: string;
    };

    const promptTokens = json.prompt_eval_count ?? 0;
    const completionTokens = json.eval_count ?? 0;

    return {
      content: json.message.content,
      model: json.model,
      latencyMs: Date.now() - startedAt,
      stopReason: json.done_reason,
      usage: {
        promptTokens,
        completionTokens,
        totalTokens: promptTokens + completionTokens,
      },
    };
  }

  async *streamChat(input: OllamaChatRequest): AsyncGenerator<StreamedProviderChunk> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw response.ok
        ? new AiProviderUnavailableError(
            `Ollama returned an empty streaming response from ${this.baseUrl}.`,
          )
        : await this.toHttpError(response, input.model);
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    while (true) {
      const { done, value } = await reader.read();
      if (done) {
        break;
      }

      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed) {
          continue;
        }

        const json = JSON.parse(trimmed) as {
          model?: string;
          message?: { content?: string };
          done?: boolean;
          done_reason?: string;
          prompt_eval_count?: number;
          eval_count?: number;
        };

        const promptTokens = json.prompt_eval_count ?? 0;
        const completionTokens = json.eval_count ?? 0;

        yield {
          delta: json.message?.content ?? "",
          done: Boolean(json.done),
          model: json.model,
          stopReason: json.done_reason,
          usage: json.done
            ? {
                promptTokens,
                completionTokens,
                totalTokens: promptTokens + completionTokens,
              }
            : undefined,
        };
      }
    }
  }

  async listModels(): Promise<Array<{ name: string; size?: string; modifiedAt?: string }>> {
    const response = await this.fetchWithTimeout(
      `${this.baseUrl}/api/tags`,
      {
        method: "GET",
      },
      this.healthCheckTimeoutMs,
    );

    if (!response.ok) {
      throw await this.toHttpError(response);
    }

    const json = (await response.json()) as OllamaTagListResponse;

    return (json.models ?? []).map((model) => ({
      name: model.name,
      size:
        typeof model.size === "number" ? `${Math.round(model.size / 1024 / 1024)} MB` : undefined,
      modifiedAt: model.modified_at,
    }));
  }

  async embed(input: { model: string; prompt: string }): Promise<number[]> {
    const response = await this.fetchWithTimeout(`${this.baseUrl}/api/embeddings`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    });

    if (!response.ok) {
      throw await this.toHttpError(response, input.model);
    }

    const json = (await response.json()) as OllamaEmbeddingResponse;
    if (!Array.isArray(json.embedding) || json.embedding.length === 0) {
      throw new AiProviderUnavailableError(
        `Ollama returned an empty embedding for model "${input.model}".`,
      );
    }

    return json.embedding;
  }


  private async fetchWithTimeout(
    input: string,
    init: RequestInit,
    timeoutMs = this.requestTimeoutMs,
  ): Promise<Response> {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);

    try {
      return await this.fetchImpl(input, {
        ...init,
        signal: controller.signal,
      });
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        throw new AiProviderUnavailableError(
          `Ollama did not respond within ${timeoutMs} ms at ${this.baseUrl}.`,
        );
      }

      throw new AiProviderUnavailableError(
        `Vyrix could not reach Ollama at ${this.baseUrl}. Install or start Ollama and try again.`,
      );
    } finally {
      clearTimeout(timeout);
    }
  }

  private async toHttpError(
    response: Response,
    model?: string,
  ): Promise<AiProviderUnavailableError | AiModelUnavailableError> {
    const details = await safeReadErrorText(response);

    if (response.status === 404 && model) {
      return new AiModelUnavailableError(
        `The model "${model}" is not available in Ollama. Pull it locally and try again.`,
      );
    }

    if (response.status === 400 && model && details.toLowerCase().includes("model")) {
      return new AiModelUnavailableError(
        `Ollama rejected the model "${model}". Pull it locally and try again.`,
      );
    }

    return new AiProviderUnavailableError(
      details
        ? `Ollama request failed with ${response.status}: ${details}`
        : `Ollama request failed with ${response.status} at ${this.baseUrl}.`,
    );
  }
}

async function safeReadErrorText(response: Response): Promise<string> {
  try {
    return (await response.text()).trim();
  } catch {
    return "";
  }
}
