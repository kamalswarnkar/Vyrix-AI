/**
 * ollama.ts — minimal Ollama HTTP client for calibration scripts.
 *
 * Does NOT use OllamaAdapter from the main codebase — calibration scripts
 * run standalone (no Electron, no compiled modules). Keep it self-contained.
 */

export const OLLAMA_BASE = process.env["OLLAMA_BASE_URL"] ?? "http://localhost:11434";
export const DEFAULT_MODEL = process.env["VYRIX_MODEL"] ?? "qwen2.5vl:7b";

export interface ChatMessage {
  role:    "system" | "user" | "assistant";
  content: string | ContentPart[];
}

export interface ContentPart {
  type:      "text" | "image_url";
  text?:     string;
  image_url?: { url: string };
}

export interface OllamaResponse {
  model:      string;
  message:    { role: string; content: string };
  done:       boolean;
  eval_count?: number;
  prompt_eval_count?: number;
  total_duration?: number;
}

export interface CallResult {
  ok:          boolean;
  text:        string;
  latencyMs:   number;
  promptTokens?: number;
  outputTokens?: number;
  error?:      string;
}

/**
 * Convert a ChatMessage (which may have OpenAI-style content array) to
 * Ollama's expected format: content must be a string; images go in `images[]`.
 *
 * Ollama /api/chat format:
 *   { role, content: string, images?: string[] }
 * NOT OpenAI format:
 *   { role, content: [{type:"image_url", image_url:{url:"data:..."}}, ...] }
 */
function toOllamaMessage(msg: ChatMessage): Record<string, unknown> {
  if (typeof msg.content === "string") return { role: msg.role, content: msg.content };

  const parts  = msg.content as ContentPart[];
  const text   = parts.filter((p) => p.type === "text").map((p) => p.text ?? "").join(" ").trim();
  const images = parts
    .filter((p) => p.type === "image_url")
    .map((p) => (p.image_url?.url ?? "").replace(/^data:[^;]+;base64,/, ""));

  return images.length > 0
    ? { role: msg.role, content: text || ".", images }
    : { role: msg.role, content: text };
}

/** Single non-streaming call. Returns full text + timing. */
export async function call(
  messages: ChatMessage[],
  model    = DEFAULT_MODEL,
  format?: "json",
): Promise<CallResult> {
  const t0  = Date.now();
  // Auto-resolve: if caller passed DEFAULT_MODEL, find the actual installed variant.
  // ponytail: handles qwen2.5vl vs qwen2.5-vl mismatch without touching every phase file.
  const resolvedModel = model === DEFAULT_MODEL ? await resolveActiveModel() : model;
  const body: Record<string, unknown> = {
    model: resolvedModel,
    messages: messages.map(toOllamaMessage),
    stream: false,
    // Deterministic for calibration. repeat_penalty + num_predict stop the
    // greedy-decoding repetition loops Q4 models fall into at temperature 0.
    options: { temperature: 0, repeat_penalty: 1.15, num_predict: 512 },
  };
  if (format) body["format"] = format;

  let res: Response;
  try {
    res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method:  "POST",
      headers: { "Content-Type": "application/json" },
      body:    JSON.stringify(body),
    });
  } catch (e) {
    return { ok: false, text: "", latencyMs: Date.now() - t0, error: String(e) };
  }

  if (!res.ok) {
    const msg = await res.text().catch(() => res.statusText);
    return { ok: false, text: "", latencyMs: Date.now() - t0, error: `HTTP ${res.status}: ${msg}` };
  }

  const data = await res.json() as OllamaResponse;
  return {
    ok:           true,
    text:         data.message.content,
    latencyMs:    Date.now() - t0,
    promptTokens: data.prompt_eval_count,
    outputTokens: data.eval_count,
  };
}

/** List installed models. */
export async function listModels(): Promise<string[]> {
  try {
    const res  = await fetch(`${OLLAMA_BASE}/api/tags`);
    const data = await res.json() as { models: { name: string }[] };
    return data.models.map((m) => m.name);
  } catch {
    return [];
  }
}

/**
 * Resolve the actual installed model that best matches DEFAULT_MODEL.
 * Handles name variants like qwen2.5vl vs qwen2.5-vl (missing hyphen).
 * Cached per-process — calibration scripts are short-lived.
 */
let _activeModel: string | null = null;
export async function resolveActiveModel(): Promise<string> {
  if (_activeModel) return _activeModel;
  const models = await listModels();
  // Exact match first
  if (models.includes(DEFAULT_MODEL)) { _activeModel = DEFAULT_MODEL; return DEFAULT_MODEL; }
  // Fuzzy: strip hyphens and compare prefixes (handles qwen2.5vl vs qwen2.5-vl)
  const base = DEFAULT_MODEL.split(":")[0]!.replace(/-/g, "");
  const found = models.find((m) => m.replace(/-/g, "").startsWith(base));
  _activeModel = found ?? DEFAULT_MODEL; // fall through with original; caller gets 404
  return _activeModel;
}

/** Try to parse JSON — strips markdown fences first. */
export function parseJson<T>(text: string): T | null {
  try {
    const clean = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
    return JSON.parse(clean) as T;
  } catch {
    return null;
  }
}
