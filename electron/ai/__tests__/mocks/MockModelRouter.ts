/**
 * MockModelRouter.ts
 *
 * Test double for ModelRouter.
 * Allows tests to define response sequences without a real AI backend.
 */

import type { InferenceRequest, InferenceResponse, StreamCallbacks, RouterHealth } from "../../core/types";

export class MockModelRouter {
  private responses: string[] = [];
  private callCount = 0;
  public lastRequest: InferenceRequest | null = null;

  /**
   * Queue responses to be returned in order.
   * If the queue is exhausted, subsequent calls return the last response.
   */
  setResponses(responses: string[]): void {
    this.responses = [...responses];
    this.callCount = 0;
  }

  setResponse(response: string): void {
    this.setResponses([response]);
  }

  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    this.lastRequest = req;
    const content = this.dequeueResponse();
    return { content, model: "mock", latencyMs: 0, backend: "sidecar" };
  }

  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void> {
    this.lastRequest = req;
    const text  = this.dequeueResponse();
    const words = text.split(" ");

    let accumulated = "";
    for (const word of words) {
      accumulated += word + " ";
      callbacks.onChunk(word + " ", accumulated);
      await new Promise((r) => setTimeout(r, 0)); // yield
    }
    callbacks.onDone(text, 0);
  }

  async health(): Promise<RouterHealth> {
    return {
      activeBackend:  "sidecar",
      fallbackActive: false,
      sidecar:        { ok: true, message: "mock", modelLoaded: true, modelName: "mock", contextSize: 8192 },
      ollama:         { ok: false, message: "mock", installedModels: [], preferredModel: "" },
    };
  }

  get activeBackend(): "sidecar" | "ollama" { return "sidecar"; }

  private dequeueResponse(): string {
    if (this.responses.length === 0) return '{"mock": true}';
    const idx = Math.min(this.callCount, this.responses.length - 1);
    this.callCount++;
    return this.responses[idx]!;
  }

  reset(): void {
    this.responses = [];
    this.callCount = 0;
    this.lastRequest = null;
  }
}
