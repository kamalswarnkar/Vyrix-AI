/**
 * LlamaSidecar.ts  (M05)
 *
 * Manages the llama.cpp server process as a Node.js child_process.
 * The sidecar runs llama-server (llama.cpp's HTTP server mode) as a
 * background process, exposing an OpenAI-compatible /v1/chat/completions API.
 *
 * Lifecycle:
 *   start()   → spawn the process, wait for the ready signal
 *   complete() → non-streaming inference
 *   stream()  → streaming inference via SSE
 *   stop()    → gracefully terminate the process
 *
 * Automatic restart with exponential backoff on unexpected exit.
 * Circuit-breaker: after 3 consecutive failures, throws and lets ModelRouter
 * fall back to Ollama.
 */

import { ChildProcess, spawn } from "node:child_process";
import path   from "node:path";
import EventEmitter from "node:events";

import type {
  InferenceRequest,
  InferenceResponse,
  StreamCallbacks,
  SidecarHealth,
} from "./types";
import { HardwareDetector } from "./HardwareDetector";

// ─── Constants ────────────────────────────────────────────────────────────────

const SIDECAR_HOST    = "127.0.0.1";
const SIDECAR_PORT    = 8765;
const SIDECAR_BASE    = `http://${SIDECAR_HOST}:${SIDECAR_PORT}`;
const READY_SIGNAL    = "llama server listening";
const READY_TIMEOUT   = 60_000; // 60s
const MAX_FAILURES    = 3;
const BACKOFF_BASE_MS = 2_000;

// ─── LlamaSidecar ─────────────────────────────────────────────────────────────

export class LlamaSidecar extends EventEmitter {
  private process:        ChildProcess | null = null;
  private ready:          boolean             = false;
  private failureCount:   number              = 0;
  private restarting:     boolean             = false;
  private startPromise:   Promise<void> | null = null;
  private readonly detector: HardwareDetector;
  private readonly modelPath: string;
  private readonly binaryPath: string;

  constructor(options: {
    modelPath:  string;
    binaryPath: string;
  }) {
    super();
    this.modelPath  = options.modelPath;
    this.binaryPath = options.binaryPath;
    this.detector   = new HardwareDetector();
  }

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  /**
   * Starts the llama-server process and waits for it to be ready.
   * Idempotent — safe to call multiple times.
   */
  async start(): Promise<void> {
    if (this.ready) return;
    if (this.startPromise) return this.startPromise;

    this.startPromise = this._doStart();
    await this.startPromise;
    this.startPromise = null;
  }

  private async _doStart(): Promise<void> {
    const profile = this.detector.detect();
    const flags   = this.detector.toLlamaFlags(profile, this.modelPath);

    return new Promise<void>((resolve, reject) => {
      const proc = spawn(this.binaryPath, flags, {
        stdio: ["ignore", "pipe", "pipe"],
      });

      this.process = proc;
      let stdoutBuf = "";

      const timeout = setTimeout(() => {
        reject(new Error(`llama.cpp sidecar did not become ready within ${READY_TIMEOUT / 1000}s`));
        proc.kill();
      }, READY_TIMEOUT);

      proc.stdout?.on("data", (data: Buffer) => {
        stdoutBuf += data.toString();
        if (stdoutBuf.toLowerCase().includes(READY_SIGNAL)) {
          clearTimeout(timeout);
          this.ready = true;
          this.failureCount = 0;
          resolve();
        }
      });

      proc.stderr?.on("data", (_data: Buffer) => {
        // Swallow stderr — llama.cpp writes verbose diagnostics here
      });

      proc.on("exit", (code) => {
        this.ready   = false;
        this.process = null;
        this.emit("exit", code);

        if (!this.restarting) {
          this._scheduleRestart();
        }
      });

      proc.on("error", (err) => {
        clearTimeout(timeout);
        reject(new Error(`Failed to spawn llama.cpp sidecar: ${err.message}`));
      });
    });
  }

  /**
   * Gracefully stops the sidecar process.
   */
  async stop(): Promise<void> {
    this.restarting = true; // prevent auto-restart
    if (this.process) {
      this.process.kill("SIGTERM");
      await new Promise<void>((res) => {
        const timeout = setTimeout(() => {
          this.process?.kill("SIGKILL");
          res();
        }, 5_000);
        this.process?.on("exit", () => { clearTimeout(timeout); res(); });
      });
      this.process = null;
    }
    this.ready      = false;
    this.restarting = false;
  }

  // ── Inference ─────────────────────────────────────────────────────────────

  /**
   * Non-streaming inference. Returns the full response after completion.
   */
  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    await this.ensureReady();
    const start    = Date.now();
    const body     = this.buildRequestBody(req);

    const response = await fetch(`${SIDECAR_BASE}/v1/chat/completions`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });

    if (!response.ok) {
      const text = await response.text();
      throw new Error(`llama.cpp error ${response.status}: ${text}`);
    }

    const json    = await response.json() as { choices: Array<{ message: { content: string } }>; model: string };
    const content = json.choices[0]?.message?.content ?? "";
    const latencyMs = Date.now() - start;

    return { content, model: json.model ?? "llama.cpp", latencyMs, backend: "sidecar" };
  }

  /**
   * Streaming inference. Fires callbacks as tokens arrive.
   */
  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void> {
    await this.ensureReady();
    const start = Date.now();
    const body  = this.buildRequestBody(req, true);

    let response: Response;
    try {
      response = await fetch(`${SIDECAR_BASE}/v1/chat/completions`, {
        method:  "POST",
        headers: { "Content-Type": "application/json" },
        body:    JSON.stringify(body),
      });
    } catch (err) {
      callbacks.onError(String(err));
      return;
    }

    if (!response.ok || !response.body) {
      callbacks.onError(`llama.cpp returned ${response.status}`);
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
          const trimmed = line.trim();
          if (!trimmed || trimmed === "data: [DONE]") continue;
          if (!trimmed.startsWith("data: ")) continue;

          try {
            const json  = JSON.parse(trimmed.slice(6)) as { choices: Array<{ delta: { content?: string } }> };
            const delta = json.choices[0]?.delta?.content ?? "";
            if (delta) {
              full += delta;
              callbacks.onChunk(delta, full);
            }
          } catch {
            // Skip malformed SSE chunk
          }
        }
      }

      callbacks.onDone(full, Date.now() - start);
    } catch (err) {
      callbacks.onError(String(err));
    }
  }

  // ── Health ────────────────────────────────────────────────────────────────

  async health(): Promise<SidecarHealth> {
    if (!this.ready) {
      return {
        ok:          false,
        message:     "Sidecar not running",
        modelLoaded: false,
        modelName:   path.basename(this.modelPath),
        contextSize: 0,
      };
    }

    try {
      const response = await fetch(`${SIDECAR_BASE}/health`, { signal: AbortSignal.timeout(5_000) });
      const json     = await response.json() as { status?: string };
      return {
        ok:          json.status === "ok",
        message:     json.status ?? "unknown",
        modelLoaded: true,
        modelName:   path.basename(this.modelPath),
        contextSize: this.detector.detect().contextSize,
      };
    } catch (err) {
      return {
        ok:          false,
        message:     String(err),
        modelLoaded: false,
        modelName:   path.basename(this.modelPath),
        contextSize: 0,
      };
    }
  }

  get isReady(): boolean { return this.ready; }

  // ── Private ───────────────────────────────────────────────────────────────

  private async ensureReady(): Promise<void> {
    if (!this.ready) throw new Error("llama.cpp sidecar is not running");
  }

  private buildRequestBody(req: InferenceRequest, stream = false): Record<string, unknown> {
    const body: Record<string, unknown> = {
      model:       "local",
      messages:    req.messages,
      stream,
      temperature: req.temperature ?? 0.7,
      n:           1,
    };

    if (req.grammar)  body["grammar"]   = req.grammar;
    if (req.num_ctx)  body["num_ctx"]   = req.num_ctx;

    return body;
  }

  private _scheduleRestart(): void {
    this.failureCount++;
    if (this.failureCount > MAX_FAILURES) {
      this.emit("circuit-open");
      return;
    }

    const delay = BACKOFF_BASE_MS * Math.pow(2, this.failureCount - 1);
    setTimeout(() => {
      if (!this.restarting) {
        this._doStart().catch(() => this._scheduleRestart());
      }
    }, delay);
  }
}
