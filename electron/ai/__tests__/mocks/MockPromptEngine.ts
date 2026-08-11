/**
 * MockPromptEngine.ts
 *
 * Test double for PromptEngine.
 * Returns pre-programmed responses without touching AI backends.
 */

import type { PromptEngineRequest, PromptEngineResponse } from "../../prompt/types";

export class MockPromptEngine {
  private responseMap = new Map<string, string>();
  private defaultResponse = '{"mock": true, "ai_message": "Mock response"}';
  public calls: PromptEngineRequest[] = [];

  /**
   * Map a taskType to a canned JSON response string.
   */
  onTaskType(taskType: string, response: string): void {
    this.responseMap.set(taskType, response);
  }

  setDefault(response: string): void {
    this.defaultResponse = response;
  }

  async run(req: PromptEngineRequest): Promise<PromptEngineResponse> {
    this.calls.push(req);
    const text = req.taskType
      ? (this.responseMap.get(req.taskType) ?? this.defaultResponse)
      : this.defaultResponse;

    return { ok: true, text, tokens: 0, latencyMs: 0 };
  }

  async stream(
    req:     PromptEngineRequest,
    onChunk: (chunk: string) => void,
    onDone:  (full: string, ms: number) => void,
    onError: (err: string) => void,
  ): Promise<void> {
    this.calls.push(req);
    const text = req.taskType
      ? (this.responseMap.get(req.taskType) ?? this.defaultResponse)
      : this.defaultResponse;

    onChunk(text);
    onDone(text, 0);
  }

  reset(): void {
    this.responseMap.clear();
    this.calls = [];
  }
}
