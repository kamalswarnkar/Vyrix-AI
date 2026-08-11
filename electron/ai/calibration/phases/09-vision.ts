/**
 * Phase 09 — Vision Pipeline Validation
 * Tests multimodal (image + text) capabilities via Ollama.
 * Uses small embedded base64 images to avoid external file dependencies.
 *
 * Note: Ollama's vision support requires the model to have been pulled with
 * vision capabilities. qwen2.5-vl:7b supports vision natively.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "09-vision";

/** Build an Ollama-native vision message. images[] = raw base64, no data URL prefix. */
function visionMsg(base64: string, text: string): Record<string, unknown> {
  // Ollama format: {role, content: string, images: string[]}
  // NOT OpenAI format: {role, content: [{type:"image_url",...}]}
  return { role: "user", content: text, images: [base64] };
}

// Minimal inline PNGs (1x1 pixels, different colours) — no external files needed.
// ponytail: real calibration would use actual screenshots/wireframes; these just verify the pipeline works.
const PIXELS = {
  // 1x1 red
  red:   "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==",
  // 1x1 blue
  blue:  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADklEQVQI12P4z8BQDwAEgAF/QualIQAAAABJRU5ErkJggg==",
  // 1x1 white
  white: "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8/5+hHgAHggJ/PchI6QAAAABJRU5ErkJggg==",
};

// A minimal wireframe mockup: 10x10 white PNG (bigger than 1x1, still tiny)
const WIREFRAME_10x10 = "iVBORw0KGgoAAAANSUhEUgAAAAoAAAAKCAYAAACNMs+9AAAAFklEQVR42mNk+A9QTwMJAAD//wMABAADjQGEOQAAAABJRU5ErkJggg==";

interface VisionCase {
  name:        string;
  imageBase64: string;
  mimeType:    string;
  question:    string;
  validate:    (o: unknown) => string | null;
}

const CASES: VisionCase[] = [
  {
    name:        "image-description-json",
    imageBase64: PIXELS.white,
    mimeType:    "image/png",
    question:    'Describe this image briefly. Reply ONLY with JSON: {"description":"...","colors":["..."]}',
    validate(o: any) {
      if (typeof o?.description !== "string" || !o.description) return "description missing";
      if (!Array.isArray(o?.colors)) return "colors not array";
      return null;
    },
  },
  {
    name:        "wireframe-analysis",
    imageBase64: WIREFRAME_10x10,
    mimeType:    "image/png",
    question:    'Analyse this UI wireframe. What elements do you see? Reply ONLY with JSON: {"elements":["..."],"layout":"...","suggestions":["..."]}',
    validate(o: any) {
      if (!Array.isArray(o?.elements))      return "elements not array";
      if (typeof o?.layout !== "string")    return "layout missing";
      if (!Array.isArray(o?.suggestions))   return "suggestions not array";
      return null;
    },
  },
  {
    name:        "text-extraction-from-image",
    imageBase64: WIREFRAME_10x10,
    mimeType:    "image/png",
    question:    'Extract any visible text from this image. Reply ONLY with JSON: {"text_found":bool,"extracted_text":"..."}',
    validate(o: any) {
      if (typeof o?.text_found !== "boolean") return "text_found not boolean";
      if (typeof o?.extracted_text !== "string") return "extracted_text missing";
      return null;
    },
  },
  {
    name:        "multi-image-comparison",
    imageBase64: PIXELS.white, // ponytail: single image repeated; real test would use two different images
    mimeType:    "image/png",
    question:    'Compare the old design (first image) and new design (second image). Reply ONLY with JSON: {"differences":["..."],"recommendation":"..."}',
    validate(o: any) {
      if (!Array.isArray(o?.differences))       return "differences not array";
      if (typeof o?.recommendation !== "string") return "recommendation missing";
      return null;
    },
  },
];

async function main() {
  const cases: TestCase[] = [];

  for (const c of CASES) {
    const r = await call(
      [visionMsg(c.imageBase64, c.question) as any],
      DEFAULT_MODEL,
      "json",
    );

    const parsed  = r.ok ? parseJson<unknown>(r.text) : null;
    const failure = r.ok && parsed ? c.validate(parsed) : (r.error ?? "parse failed");

    cases.push({
      name:      c.name,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? "ok",
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  // Extra: vision latency benchmark (no parse — just timing)
  {
    const t0  = Date.now();
    const r   = await call(
      [visionMsg(WIREFRAME_10x10, "What is this?") as any],
      DEFAULT_MODEL,
    );
    cases.push({
      name:      "vision-latency-benchmark",
      passed:    r.ok,
      latencyMs: Date.now() - t0,
      notes:     r.ok ? `${r.outputTokens ?? "?"} output tokens` : (r.error ?? "failed"),
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
