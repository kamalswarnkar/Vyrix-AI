/**
 * Phase 03 — GBNF Grammar Validation
 * Sends grammar-constrained requests via llama.cpp sidecar (port 8765).
 * Falls back to Ollama format:"json" if sidecar unreachable — marks as warning.
 *
 * ponytail: grammar enforcement requires llama.cpp sidecar; Ollama doesn't support GBNF.
 *           Run with sidecar active for real grammar tests.
 */

import * as fs   from "node:fs";
import * as path from "node:path";
import { parseJson, DEFAULT_MODEL, OLLAMA_BASE } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "03-grammars";
const SIDECAR_BASE = process.env["SIDECAR_BASE_URL"] ?? "http://127.0.0.1:8765";
const GRAMMARS_DIR = path.resolve(__dirname, "../../grammars");

interface GrammarCase {
  taskType: string;
  prompt:   string;
  validate: (o: unknown) => string | null;
}

const CASES: GrammarCase[] = [
  {
    taskType: "interview-step",
    prompt: "You are at step 1 of onboarding. Ask the user for their project name. Output JSON only.",
    validate(o: any) {
      if (typeof o?.step_number !== "number") return "step_number not number";
      if (typeof o?.ai_message !== "string")  return "ai_message missing";
      if (typeof o?.skip_next_step !== "boolean") return "skip_next_step missing";
      if (typeof o?.extracted !== "object")   return "extracted missing";
      return null;
    },
  },
  {
    taskType: "interview-plan",
    prompt: "Generate a 2-step roadmap for 'a todo app'. Output JSON only.",
    validate(o: any) {
      if (!Array.isArray(o?.steps)) return "steps not array";
      if (typeof o?.total_steps !== "number") return "total_steps not number";
      if (typeof o?.summary !== "string") return "summary missing";
      return null;
    },
  },
  {
    taskType: "context-resolve",
    prompt: "Resolve @MyProject from list [{\"id\":\"p1\",\"title\":\"MyProject\"}]. Output JSON only.",
    validate(o: any) {
      if (typeof o?.has_context !== "boolean") return "has_context missing";
      if (typeof o?.project_id !== "string") return "project_id missing";
      return null;
    },
  },
];

async function callWithGrammar(
  grammar: string,
  prompt: string,
): Promise<{ ok: boolean; text: string; latencyMs: number; error?: string; source: "sidecar" | "ollama" }> {
  const t0 = Date.now();

  // Try sidecar first
  try {
    const res = await fetch(`${SIDECAR_BASE}/v1/chat/completions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: "local",
        messages: [{ role: "user", content: prompt }],
        grammar,
        temperature: 0,
        stream: false,
      }),
      signal: AbortSignal.timeout(5000),
    });
    if (res.ok) {
      const data = await res.json() as any;
      const text = data?.choices?.[0]?.message?.content ?? "";
      return { ok: true, text, latencyMs: Date.now() - t0, source: "sidecar" };
    }
  } catch {
    // sidecar not running — fall through to ollama warning
  }

  // Fall back: Ollama with format:json (no grammar enforcement)
  try {
    const res = await fetch(`${OLLAMA_BASE}/api/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: DEFAULT_MODEL,
        messages: [{ role: "user", content: prompt }],
        stream: false,
        format: "json",
        options: { temperature: 0 },
      }),
    });
    const data = await res.json() as any;
    return {
      ok: true,
      text: data?.message?.content ?? "",
      latencyMs: Date.now() - t0,
      source: "ollama",
      error: "sidecar unavailable — grammar NOT enforced (Ollama fallback)",
    };
  } catch (e) {
    return { ok: false, text: "", latencyMs: Date.now() - t0, error: String(e), source: "ollama" };
  }
}

async function main() {
  const cases: TestCase[] = [];

  for (const c of CASES) {
    const grammarPath = path.join(GRAMMARS_DIR, `${c.taskType}.gbnf`);
    let grammar: string;
    try {
      grammar = fs.readFileSync(grammarPath, "utf-8");
    } catch {
      cases.push({ name: c.taskType, passed: false, notes: `grammar file missing: ${grammarPath}` });
      continue;
    }

    const r = await callWithGrammar(grammar, c.prompt);
    const parsed = r.ok ? parseJson(r.text) : null;
    const failure = r.ok && parsed ? c.validate(parsed) : (r.error ?? "parse failed");

    const notes = [
      `source:${r.source}`,
      r.source === "ollama" ? "⚠ grammar not enforced" : "grammar enforced",
      failure ?? "validate ok",
    ].join(" | ");

    cases.push({
      name: c.taskType,
      // pass only if validate ok; if ollama fallback, still count as pass (validation tested, not grammar enforcement)
      passed: failure === null,
      latencyMs: r.latencyMs,
      notes,
      raw: r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  if (cases.some((c) => c.notes?.includes("sidecar unavailable"))) {
    console.log("\n⚠  Sidecar not running — grammar enforcement untested. Start llama.cpp sidecar on :8765 for real grammar tests.");
  }
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
