/**
 * OllamaAdapter.ts  (M06)
 *
 * HTTP adapter to the locally-running Ollama server.
 * Implements the same complete() / stream() / health() interface as LlamaSidecar
 * so that ModelRouter can swap between them transparently.
 *
 * Used as:
 *   1. Development/setup mode when llama.cpp sidecar is not configured
 *   2. Fallback when the sidecar circuit-breaker is open
 *
 * Default base URL: http://localhost:11434
 */

import type {
  InferenceRequest,
  InferenceResponse,
  StreamCallbacks,
  OllamaHealth,
} from "./types";

// ─── Constants ────────────────────────────────────────────────────────────────

// Registry name is "qwen2.5vl" (no hyphen); the 7b tag ships Q4_K_M quantized.
// VYRIX_MODEL / VYRIX_NUM_CTX are per-developer overrides (e.g. qwen2.5vl:3b on 8GB machines).
const DEFAULT_MODEL    = process.env["VYRIX_MODEL"] ?? "qwen2.5vl:7b";
const DEFAULT_NUM_CTX  = Number(process.env["VYRIX_NUM_CTX"]) || 8192;
const HEALTH_TIMEOUT   = 5_000;

// ─── OllamaAdapter ────────────────────────────────────────────────────────────

export class OllamaAdapter {
  private readonly baseUrl: string;
  private readonly defaultModel: string;

  constructor(options: {
    baseUrl?:      string;
    defaultModel?: string;
  } = {}) {
    this.baseUrl      = options.baseUrl?.replace(/\/$/, "") ?? "http://localhost:11434";
    this.defaultModel = options.defaultModel ?? DEFAULT_MODEL;
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  /**
   * Non-streaming inference. Returns the full response after completion.
   */
  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const start = Date.now();
    const model = req.model ?? this.defaultModel;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          model,
          messages: req.messages,
          stream:   false,
          options: {
            temperature: req.temperature ?? 0.7,
            num_ctx:     req.num_ctx     ?? DEFAULT_NUM_CTX,
          },
        }),
      });
    } catch (err) {
      throw new Error(`Ollama unreachable — is it running? (${String(err)})`);
    }

    if (!response.ok) {
      const text = await response.text();
      throw new OllamaError(response.status, text);
    }

    const json = await response.json() as { message: { content: string }; model: string };
    return {
      content:    json.message?.content ?? "",
      model:      json.model ?? model,
      latencyMs:  Date.now() - start,
      backend:    "ollama",
    };
  }

  /**
   * Streaming inference. Fires callbacks as tokens arrive.
   */
  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void> {
    const start = Date.now();
    const model = req.model ?? this.defaultModel;

    let response: Response;
    try {
      response = await fetch(`${this.baseUrl}/api/chat`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify({
          model,
          messages: req.messages,
          stream:   true,
          options: {
            temperature: req.temperature ?? 0.7,
            num_ctx:     req.num_ctx     ?? DEFAULT_NUM_CTX,
          },
        }),
      });
    } catch (err) {
      callbacks.onError(`Ollama unreachable — is it running? (${String(err)})`);
      return;
    }

    if (!response.ok || !response.body) {
      callbacks.onError(`Ollama returned HTTP ${response.status}`);
      return;
    }

    const reader  = response.body.getReader();
    const decoder = new TextDecoder();
    let   buf     = "";
    let   full    = "";

    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buf += decoder.decode(value, { stream: true });
        const lines = buf.split("\n");
        buf = lines.pop() ?? "";

        for (const line of lines) {
          if (!line.trim()) continue;
          try {
            const obj   = JSON.parse(line) as { message?: { content?: string }; done?: boolean };
            const chunk = obj.message?.content ?? "";
            if (chunk) {
              full += chunk;
              callbacks.onChunk(chunk, full);
            }
            if (obj.done) {
              callbacks.onDone(full, Date.now() - start);
              return;
            }
          } catch {
            // Skip malformed NDJSON line
          }
        }
      }

      // Stream ended without a done:true frame
      callbacks.onDone(full, Date.now() - start);
    } catch (err) {
      callbacks.onError(String(err));
    }
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async health(): Promise<OllamaHealth> {
    try {
      const response = await fetch(`${this.baseUrl}/api/tags`, {
        signal: AbortSignal.timeout(HEALTH_TIMEOUT),
      });

      if (!response.ok) {
        return { ok: false, message: `HTTP ${response.status}`, installedModels: [], preferredModel: this.defaultModel };
      }

      const json = await response.json() as { models: Array<{ name: string }> };
      const models = json.models?.map((m) => m.name) ?? [];

      return {
        ok:              true,
        message:         "Ollama is running",
        installedModels: models,
        preferredModel:  this.findPreferredModel(models),
      };
    } catch (err) {
      return {
        ok:              false,
        message:         `Ollama unreachable: ${String(err)}`,
        installedModels: [],
        preferredModel:  this.defaultModel,
      };
    }
  }

  // ── Private ───────────────────────────────────────────────────────────────

  /**
   * Returns the first installed model that matches the preferred model name,
   * falling back to the first installed model, then the configured default.
   */
  private findPreferredModel(models: string[]): string {
    const preferred = models.find((m) => m.includes(this.defaultModel));
    return preferred ?? models[0] ?? this.defaultModel;
  }
}

// ─── OllamaError ──────────────────────────────────────────────────────────────

export class OllamaError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly body: string,
  ) {
    super(`Ollama error ${statusCode}: ${body}`);
    this.name = "OllamaError";
  }

  get isModelNotFound(): boolean {
    return this.statusCode === 404 || this.body.includes("model not found");
  }
}
