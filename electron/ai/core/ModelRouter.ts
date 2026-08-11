/**
 * ModelRouter.ts  (M09 — placed in core alongside its dependencies)
 *
 * Single entry point for ALL inference calls.
 * Selects the active backend (sidecar vs. Ollama) and dispatches requests.
 *
 * Selection logic:
 *   1. If sidecar is healthy → use sidecar
 *   2. If sidecar fails 3+ times consecutively → circuit-breaker opens, use Ollama
 *   3. If request has forceSidecar:true → always use sidecar (throws if unavailable)
 *   4. If both unavailable → throw RouterUnavailableError
 *
 * The circuit-breaker resets after RESET_INTERVAL_MS if the sidecar becomes healthy.
 */

import type {
  InferenceRequest,
  InferenceResponse,
  StreamCallbacks,
  RouterHealth,
  BackendType,
} from "./types";
import { LlamaSidecar } from "./LlamaSidecar";
import { OllamaAdapter } from "./OllamaAdapter";

// ─── Constants ────────────────────────────────────────────────────────────────

const MAX_SIDECAR_FAILURES = 3;
const RESET_INTERVAL_MS    = 60_000; // try sidecar again after 60s

// ─── ModelRouter ─────────────────────────────────────────────────────────────

export class ModelRouter {
  private readonly sidecar: LlamaSidecar;
  private readonly ollama:  OllamaAdapter;

  private sidecarFailures:  number  = 0;
  private circuitOpen:      boolean = false;
  private lastResetAttempt: number  = 0;

  constructor(sidecar: LlamaSidecar, ollama: OllamaAdapter) {
    this.sidecar = sidecar;
    this.ollama  = ollama;

    // Listen for circuit-open event from the sidecar
    sidecar.on("circuit-open", () => {
      this.circuitOpen = true;
    });
  }

  // ── Public interface ──────────────────────────────────────────────────────

  /**
   * Non-streaming inference. Selects backend and dispatches.
   */
  async complete(req: InferenceRequest): Promise<InferenceResponse> {
    const backend = await this.selectBackend(req);

    try {
      if (backend === "sidecar") {
        const result = await this.sidecar.complete(req);
        this.onSidecarSuccess();
        return result;
      } else {
        return await this.ollama.complete(req);
      }
    } catch (err) {
      if (backend === "sidecar") {
        this.onSidecarFailure();
        // Retry with Ollama if available
        if (!req.forceSidecar) {
          return await this.ollama.complete(req);
        }
      }
      throw err;
    }
  }

  /**
   * Streaming inference. Selects backend and dispatches.
   */
  async stream(req: InferenceRequest, callbacks: StreamCallbacks): Promise<void> {
    const backend = await this.selectBackend(req);

    if (backend === "sidecar") {
      try {
        await this.sidecar.stream(req, {
          ...callbacks,
          onError: (err) => {
            this.onSidecarFailure();
            if (!req.forceSidecar) {
              // Transparent fallback to Ollama on stream error
              this.ollama.stream(req, callbacks).catch((e) =>
                callbacks.onError(String(e)),
              );
            } else {
              callbacks.onError(err);
            }
          },
          onDone: (full, latencyMs) => {
            this.onSidecarSuccess();
            callbacks.onDone(full, latencyMs);
          },
        });
      } catch (err) {
        this.onSidecarFailure();
        if (!req.forceSidecar) {
          await this.ollama.stream(req, callbacks);
        } else {
          callbacks.onError(String(err));
        }
      }
    } else {
      await this.ollama.stream(req, callbacks);
    }
  }

  /**
   * Returns the health status of both backends and the active one.
   */
  async health(): Promise<RouterHealth> {
    const [sidecarHealth, ollamaHealth] = await Promise.all([
      this.sidecar.health(),
      this.ollama.health(),
    ]);

    const activeBackend: BackendType = this.circuitOpen ? "ollama" : "sidecar";

    return {
      activeBackend,
      sidecar:        sidecarHealth,
      ollama:         ollamaHealth,
      fallbackActive: this.circuitOpen,
    };
  }

  get activeBackend(): BackendType {
    return this.circuitOpen ? "ollama" : "sidecar";
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private async selectBackend(req: InferenceRequest): Promise<BackendType> {
    if (req.forceSidecar) {
      if (!this.sidecar.isReady) throw new Error("Sidecar is not ready (forceSidecar=true)");
      return "sidecar";
    }

    // Attempt circuit-breaker reset
    if (this.circuitOpen) {
      const now = Date.now();
      if (now - this.lastResetAttempt > RESET_INTERVAL_MS) {
        this.lastResetAttempt = now;
        const h = await this.sidecar.health();
        if (h.ok) {
          this.circuitOpen     = false;
          this.sidecarFailures = 0;
        }
      }
    }

    if (!this.circuitOpen && this.sidecar.isReady) {
      return "sidecar";
    }

    const ollamaHealth = await this.ollama.health();
    if (ollamaHealth.ok) return "ollama";

    throw new RouterUnavailableError();
  }

  private onSidecarSuccess(): void {
    this.sidecarFailures = 0;
    this.circuitOpen     = false;
  }

  private onSidecarFailure(): void {
    this.sidecarFailures++;
    if (this.sidecarFailures >= MAX_SIDECAR_FAILURES) {
      this.circuitOpen     = true;
      this.lastResetAttempt = Date.now();
    }
  }
}

// ─── RouterUnavailableError ───────────────────────────────────────────────────

export class RouterUnavailableError extends Error {
  constructor() {
    super("No AI backend is available. Ensure Ollama is running or the llama.cpp sidecar is configured.");
    this.name = "RouterUnavailableError";
  }
}
