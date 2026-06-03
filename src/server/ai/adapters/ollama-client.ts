import type {
  ProviderChatMessage,
  ProviderChatResult,
  StreamedProviderChunk,
} from "@/features/ai/contracts/chat";

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
}

interface OllamaTagListResponse {
  models?: Array<{
    name: string;
    size?: number;
    modified_at?: string;
  }>;
}

export class OllamaClient {
  private readonly baseUrl: string;
  private readonly fetchImpl: typeof fetch;

  constructor(options: OllamaClientOptions = {}) {
    this.baseUrl = options.baseUrl ?? "http://127.0.0.1:11434";
    this.fetchImpl = options.fetchImpl ?? fetch;
  }

  async chat(input: OllamaChatRequest): Promise<ProviderChatResult> {
    const startedAt = Date.now();
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        stream: false,
      }),
    });

    if (!response.ok) {
      throw new Error(`Ollama chat request failed with ${response.status}`);
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
    const response = await this.fetchImpl(`${this.baseUrl}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        ...input,
        stream: true,
      }),
    });

    if (!response.ok || !response.body) {
      throw new Error(`Ollama stream request failed with ${response.status}`);
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
    const response = await this.fetchImpl(`${this.baseUrl}/api/tags`, {
      method: "GET",
    });

    if (!response.ok) {
      throw new Error(`Ollama model list request failed with ${response.status}`);
    }

    const json = (await response.json()) as OllamaTagListResponse;

    return (json.models ?? []).map((model) => ({
      name: model.name,
      size:
        typeof model.size === "number" ? `${Math.round(model.size / 1024 / 1024)} MB` : undefined,
      modifiedAt: model.modified_at,
    }));
  }
}
