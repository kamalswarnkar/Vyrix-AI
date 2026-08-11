/**
 * Phase 01 — Model Installation
 * Verifies Ollama is reachable and qwen2.5-vl:7b-q4_K_M is installed and responsive.
 */

import { call, listModels, resolveActiveModel, DEFAULT_MODEL, OLLAMA_BASE } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "01-setup";

// ponytail: resolveActiveModel() is now shared in ollama.ts; wrap to expose isTarget flag
async function resolveModel(): Promise<{ model: string; isTarget: boolean }> {
  const model = await resolveActiveModel();
  // isTarget = resolved to the qwen2.5-vl family (exact or fuzzy match)
  const isTarget = model.replace(/-/g, "").startsWith("qwen2.5vl");
  return { model, isTarget };
}

async function main() {
  const cases: TestCase[] = [];
  const { model: activeModel, isTarget } = await resolveModel();

  // 1. Health check
  {
    const t0 = Date.now();
    let ok = false;
    let notes = "";
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/tags`);
      ok = res.ok;
      notes = ok ? `HTTP ${res.status}` : `HTTP ${res.status}`;
    } catch (e) {
      notes = String(e);
    }
    cases.push({ name: "ollama-health", passed: ok, latencyMs: Date.now() - t0, notes });
  }

  // 2. Model present
  {
    const t0 = Date.now();
    const models = await listModels();
    // ponytail: fuzzy match — handles qwen2.5vl vs qwen2.5-vl (missing hyphen)
    const found = models.find((m) => m.replace(/-/g, "").startsWith("qwen2.5vl"));
    cases.push({
      name: "model-installed",
      passed: !!found,
      latencyMs: Date.now() - t0,
      notes: found
        ? `found: ${found}${found !== DEFAULT_MODEL ? ` (alias for ${DEFAULT_MODEL})` : ""}`
        : `TARGET NOT FOUND — run: ollama pull ${DEFAULT_MODEL} | available: ${models.join(", ") || "none"}`,
    });
  }

  // 3. Basic inference (uses fallback model if target not installed)
  {
    const r = await call(
      [{ role: "user", content: 'Reply with exactly: {"ok":true}' }],
      activeModel,
      "json",
    );
    const parsed = r.ok ? (() => { try { return JSON.parse(r.text); } catch { return null; } })() : null;
    cases.push({
      name: "basic-inference",
      passed: r.ok && parsed !== null,
      latencyMs: r.latencyMs,
      notes: `model=${activeModel}${isTarget ? "" : " (FALLBACK — target not installed)"}` + (r.error ? ` | ${r.error}` : parsed ? " | parsed ok" : " | bad json"),
      raw: r.text.slice(0, 200),
      parsed,
    });
  }

  // 4. Streaming (uses fallback model if target not installed)
  {
    const t0 = Date.now();
    let ok = false;
    let notes = "";
    let chunks = 0;
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: activeModel,
          messages: [{ role: "user", content: "Say hi." }],
          stream: true,
          options: { temperature: 0 },
        }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const reader = res.body!.getReader();
      const dec = new TextDecoder();
      let done = false;
      while (!done) {
        const { value, done: d } = await reader.read();
        done = d;
        if (value) {
          const lines = dec.decode(value).split("\n").filter(Boolean);
          chunks += lines.length;
          const last = lines.at(-1);
          if (last) {
            const j = JSON.parse(last);
            if (j.done) { ok = true; break; }
          }
        }
      }
      notes = `${chunks} chunks`;
    } catch (e) {
      notes = String(e);
    }
    cases.push({ name: "streaming", passed: ok, latencyMs: Date.now() - t0, notes });
  }

  // 5. Vision capability — Ollama format: content=string, images=[base64]
  {
    const TINY_PNG_B64 = "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwADhQGAWjR9awAAAABJRU5ErkJggg==";
    // Vision requires the target model (llama3.2 has no vision)
    const r = isTarget
      ? await call(
          [{ role: "user", content: 'Describe this image in one word. Reply JSON: {"description":"..."}', images: [TINY_PNG_B64] } as any],
          activeModel,
          "json",
        )
      : { ok: false, text: "", latencyMs: 0, error: `vision skipped — target model not installed (using ${activeModel})` };
    const parsed = r.ok ? (() => { try { return JSON.parse(r.text); } catch { return null; } })() : null;
    cases.push({
      name: "vision-capability",
      passed: r.ok && parsed !== null && typeof (parsed as any).description === "string",
      latencyMs: r.latencyMs,
      notes: r.error ?? (parsed ? `description: ${(parsed as any).description}` : "no json"),
      raw: r.text.slice(0, 200),
    });
  }

  // 6. Context window (model info)
  {
    const t0 = Date.now();
    let ok = false;
    let notes = "";
    try {
      const res = await fetch(`${OLLAMA_BASE}/api/show`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: activeModel }),
      });
      if (res.ok) {
        const data = await res.json() as any;
        const ctx = data?.model_info?.["llama.context_length"]
          ?? data?.parameters?.num_ctx
          ?? data?.details?.parameter_size;
        ok = true;
        notes = ctx ? `context_length=${ctx}` : "model info ok (no ctx key found)";
      } else {
        notes = `HTTP ${res.status}`;
      }
    } catch (e) {
      notes = String(e);
    }
    cases.push({ name: "context-window-info", passed: ok, latencyMs: Date.now() - t0, notes });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
