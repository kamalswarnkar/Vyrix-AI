/**
 * types.ts — Core AI infrastructure type definitions
 * Shared by LlamaSidecar, OllamaAdapter, ModelRouter, HardwareDetector
 */

// ─── Message format ───────────────────────────────────────────────────────────

export type ChatRole = "system" | "user" | "assistant";

export interface ChatMessage {
  role:    ChatRole;
  content: string;
  /** Base64-encoded image data for multimodal requests */
  images?: string[];
}

// ─── Request / Response ───────────────────────────────────────────────────────

export interface InferenceRequest {
  messages:      ChatMessage[];
  /** Grammar string (GBNF) to constrain output — undefined = free text */
  grammar?:      string;
  /** Override context window size. Defaults to 8192 */
  num_ctx?:      number;
  /** Model name (used by Ollama adapter; ignored by sidecar which uses one model) */
  model?:        string;
  /** Temperature 0.0–1.0. Default: 0.7 */
  temperature?:  number;
  /** Force routing to the sidecar even if Ollama is active backend */
  forceSidecar?: boolean;
}

export interface InferenceResponse {
  content:    string;
  model:      string;
  latencyMs:  number;
  backend:    "sidecar" | "ollama";
  tokenCount?: number;
}

// ─── Streaming callbacks ──────────────────────────────────────────────────────

export interface StreamCallbacks {
  onChunk: (delta: string, accumulated: string) => void;
  onDone:  (fullText: string, latencyMs: number)  => void;
  onError: (error: string)                         => void;
}

// ─── Health ───────────────────────────────────────────────────────────────────

export interface SidecarHealth {
  ok:              boolean;
  message:         string;
  modelLoaded:     boolean;
  modelName:       string;
  contextSize:     number;
  backendVersion?: string;
}

export interface OllamaHealth {
  ok:              boolean;
  message:         string;
  installedModels: string[];
  preferredModel:  string;
}

export type BackendType   = "sidecar" | "ollama";
export type BackendStatus = "healthy" | "degraded" | "unavailable";

export interface RouterHealth {
  activeBackend:   BackendType;
  sidecar:         SidecarHealth;
  ollama:          OllamaHealth;
  fallbackActive:  boolean;
}

// ─── Hardware ─────────────────────────────────────────────────────────────────

export interface HardwareProfile {
  totalRamMb:    number;
  cpuCount:      number;
  gpuAvailable:  boolean;
  gpuLayers:     number;
  /** Recommended context size based on hardware */
  contextSize:   number;
  /** Recommended number of llama.cpp threads */
  threads:       number;
}
