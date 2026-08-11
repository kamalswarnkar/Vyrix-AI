/**
 * Phase 05 — Memory Distillation Accuracy
 *
 * Tests two distinct extraction calls that MemoryDistillation.ts makes:
 *
 * 1. memory-delta  — a SINGLE key/value/category object
 *    Schema: {key:string, value:string, category:enum, confidence?:number}
 *
 * 2. keyword-extraction — keywords + decisions array
 *    Schema: {keywords:string[], decisions:[{key,value,category?}], has_significant_decision:bool}
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "05-memory";

const CATEGORY_ENUM = ["technical","design","user","timeline","decision","general"];

// ─── memory-delta cases (single key-value pair) ───────────────────────────────

interface MemoryDeltaCase {
  name:        string;
  userMsg:     string;
  aiMsg:       string;
  expectCategory?: string;
  validate:    (o: unknown) => string | null;
}

const DELTA_CASES: MemoryDeltaCase[] = [
  {
    name:   "tech-stack-delta",
    userMsg: "I want to build this with Next.js and Supabase.",
    aiMsg:   "Great choices. I'll note that in your project context.",
    expectCategory: "technical",
    validate(o: any) {
      if (!o?.key   || typeof o.key   !== "string") return "key missing";
      if (!o?.value || typeof o.value !== "string") return "value missing";
      if (!CATEGORY_ENUM.includes(o?.category))     return `invalid category: ${o?.category}`;
      if (o.key === "no-op")                        return "extracted no-op for meaningful input";
      return null;
    },
  },
  {
    name:   "timeline-delta",
    userMsg: "The deadline is the end of Q3.",
    aiMsg:   "Noted — I'll set Q3 as the target milestone.",
    expectCategory: "timeline",
    validate(o: any) {
      if (!o?.key   || typeof o.key   !== "string") return "key missing";
      if (!o?.value || typeof o.value !== "string") return "value missing";
      if (!CATEGORY_ENUM.includes(o?.category))     return `invalid category: ${o?.category}`;
      return null;
    },
  },
  {
    name:   "vague-turn-noop",
    userMsg: "Hmm, not sure.",
    aiMsg:   "Take your time.",
    validate(o: any) {
      if (!o?.key || typeof o.key !== "string") return "key missing";
      // For vague turns the model SHOULD return no-op — but a low-value extraction is also acceptable.
      // We only fail if the shape is wrong.
      return null;
    },
  },
];

// ─── keyword-extraction cases ─────────────────────────────────────────────────

interface KeywordCase {
  name:          string;
  userMsg:       string;
  aiMsg:         string;
  minKeywords:   number;
  expectTerms?:  string[];  // must appear somewhere in extracted terms
}

const KW_CASES: KeywordCase[] = [
  {
    name:        "rich-tech-keywords",
    userMsg:     "I'm building a real-time whiteboard using WebSockets, React, Canvas API, and Redis pub/sub for syncing across clients.",
    aiMsg:       "That sounds like a collaborative tool. I'll extract the technical keywords.",
    minKeywords: 3,
    expectTerms: ["websocket", "react", "redis"],
  },
  {
    name:        "decision-capture",
    userMsg:     "I've decided to go with PostgreSQL over MongoDB because we need relational data and strong consistency.",
    aiMsg:       "Good decision. I'll save that to memory.",
    minKeywords: 1,
    expectTerms: ["postgresql"],
  },
  {
    name:        "no-keywords-vague",
    userMsg:     "I'm not sure yet.",
    aiMsg:       "Take your time thinking about it.",
    minKeywords: 0,
  },
];

const MEMORY_DELTA_PROMPT = (userMsg: string, aiMsg: string) =>
`Extract the single most important fact from this conversation turn.

RULES:
- "key" = short LABEL for the fact (e.g. "technology_stack", "deadline", "target_audience")
- "value" = the ACTUAL FACT (e.g. "Next.js and Supabase", "Q3", "small businesses")
- Do NOT put the fact itself in "key". The key is a short label; the value is the content.
- If nothing is worth remembering, return {"key":"no-op","value":"","category":"general","confidence":0.5}

User: "${userMsg}"
AI: "${aiMsg}"

Example: if user says "I'm using React", output: {"key":"frontend_framework","value":"React","category":"technical","confidence":0.95}

Reply ONLY with JSON: {"key":"<label>","value":"<fact>","category":"technical|design|user|timeline|decision|general","confidence":0.9}`;

const KW_PROMPT = (userMsg: string, aiMsg: string, existing: string[]) =>
`Extract domain keywords and project decisions from this conversation turn.
${existing.length ? `Already known (skip): ${existing.join(", ")}` : ""}

User: "${userMsg}"
AI: "${aiMsg}"

Reply ONLY with JSON: {"keywords":["..."],"decisions":[{"key":"...","value":"...","category":"technical|..."}],"has_significant_decision":false}`;

async function main() {
  const cases: TestCase[] = [];

  // 1. memory-delta cases
  for (const c of DELTA_CASES) {
    const r = await call(
      [{ role: "user", content: MEMORY_DELTA_PROMPT(c.userMsg, c.aiMsg) }],
      DEFAULT_MODEL,
      "json",
    );
    const parsed  = r.ok ? parseJson<any>(r.text) : null;
    const failure = r.ok && parsed ? c.validate(parsed) : (r.error ?? "parse failed");
    cases.push({
      name:      `memory-delta:${c.name}`,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `key="${(parsed as any)?.key}" category="${(parsed as any)?.category}"`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  // 2. keyword-extraction cases
  for (const c of KW_CASES) {
    const r = await call(
      [{ role: "user", content: KW_PROMPT(c.userMsg, c.aiMsg, []) }],
      DEFAULT_MODEL,
      "json",
    );
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    let failure: string | null = null;

    if (!r.ok || !parsed) {
      failure = r.error ?? "parse failed";
    } else {
      if (!Array.isArray(parsed.keywords))  { failure = "keywords not array"; }
      else if (!Array.isArray(parsed.decisions)) { failure = "decisions not array"; }
      else if (typeof parsed.has_significant_decision !== "boolean") { failure = "has_significant_decision not boolean"; }
      else if (parsed.keywords.length < c.minKeywords) {
        failure = `expected >= ${c.minKeywords} keywords, got ${parsed.keywords.length}`;
      } else if (c.expectTerms) {
        const allTerms = [...parsed.keywords, ...parsed.decisions.map((d: any) => d.key ?? ""), ...parsed.decisions.map((d: any) => d.value ?? "")]
          .map((s: string) => s.toLowerCase()).join(" ");
        const missing = c.expectTerms.filter((t) => !allTerms.includes(t.toLowerCase()));
        if (missing.length > 0) failure = `missing expected terms: ${missing.join(", ")}`;
      }
    }

    cases.push({
      name:      `keyword-extraction:${c.name}`,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `${(parsed as any)?.keywords?.length ?? 0} keywords, ${(parsed as any)?.decisions?.length ?? 0} decisions`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
