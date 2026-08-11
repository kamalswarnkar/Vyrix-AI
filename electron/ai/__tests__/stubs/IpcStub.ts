/**
 * IpcStub.ts
 *
 * Stub implementation of the IPC ai.* contract for integration tests
 * that need to verify IPC handler behaviour without a real Electron context.
 *
 * Mirrors the VyrixBridge.ai interface from src/lib/electron.d.ts.
 */

export interface IpcAiStubOptions {
  /** Pre-programmed responses for streamMessage. Cycles through responses. */
  streamResponses?: string[];
  /** Delay between chunks in ms. Default: 0 */
  chunkDelayMs?: number;
}

export class IpcAiStub {
  private readonly responses:    string[];
  private readonly chunkDelayMs: number;
  private callIndex = 0;

  public streamMessageCalls: Array<{ message: string; conversationId?: string }> = [];

  constructor(opts: IpcAiStubOptions = {}) {
    this.responses    = opts.streamResponses ?? ["Mock AI response from IPC stub."];
    this.chunkDelayMs = opts.chunkDelayMs ?? 0;
  }

  /**
   * Simulates ipc.ai.streamMessage().
   * Emits 'ai:stream:chunk' events then 'ai:stream:done'.
   */
  async streamMessage(
    message:        string,
    conversationId?: string,
    onChunk?:       (chunk: string) => void,
    onDone?:        (full: string) => void,
    onError?:       (err: string) => void,
  ): Promise<void> {
    this.streamMessageCalls.push({ message, conversationId });

    const text   = this.dequeue();
    const words  = text.split(" ");

    for (const word of words) {
      if (this.chunkDelayMs > 0) {
        await new Promise((r) => setTimeout(r, this.chunkDelayMs));
      }
      onChunk?.(word + " ");
    }

    onDone?.(text);
  }

  reset(): void {
    this.callIndex            = 0;
    this.streamMessageCalls   = [];
  }

  private dequeue(): string {
    const idx = Math.min(this.callIndex, this.responses.length - 1);
    this.callIndex++;
    return this.responses[idx] ?? "";
  }
}

// ─── IPC Event Bus stub (for ipc.on / ipc.off pattern) ───────────────────────

export class IpcEventBusStub {
  private handlers = new Map<string, Set<(...args: unknown[]) => void>>();

  on(event: string, handler: (...args: unknown[]) => void): void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
  }

  off(event: string, handler: (...args: unknown[]) => void): void {
    this.handlers.get(event)?.delete(handler);
  }

  emit(event: string, ...args: unknown[]): void {
    this.handlers.get(event)?.forEach((h) => h(...args));
  }

  listenerCount(event: string): number {
    return this.handlers.get(event)?.size ?? 0;
  }

  reset(): void {
    this.handlers.clear();
  }
}
