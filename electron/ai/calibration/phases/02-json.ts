/**
 * Phase 02 — JSON Schema Outputs
 * Asks the model to produce each TaskType's output without grammar constraints.
 * Validates the raw JSON against expected shape. Failures here mean prompts need work.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "02-json";

interface Case {
  name: string;
  prompt: string;
  validate: (obj: unknown) => string | null; // null = ok, string = failure reason
}

const CASES: Case[] = [
  {
    name: "interview-step",
    prompt: `You are conducting step 1 of a 6-step project onboarding interview.
Ask the user for their project name and high-level goal.
Reply ONLY with valid JSON matching exactly:
{
  "step_number": 1,
  "ai_message": "<your question>",
  "skip_next_step": false,
  "extracted": {}
}`,
    validate(o: any) {
      if (typeof o !== "object" || o === null) return "not an object";
      if (o.step_number !== 1) return `step_number=${o.step_number}`;
      if (typeof o.ai_message !== "string" || !o.ai_message) return "ai_message missing";
      if (typeof o.skip_next_step !== "boolean") return "skip_next_step not boolean";
      if (typeof o.extracted !== "object") return "extracted not object";
      return null;
    },
  },
  {
    name: "interview-plan",
    prompt: `Generate a 3-step project roadmap for: "Build a personal finance tracker".
Reply ONLY with valid JSON:
{
  "steps": [{"step":1,"title":"...","description":"...","methodology":"..."}],
  "total_steps": 3,
  "summary": "..."
}`,
    validate(o: any) {
      if (!Array.isArray(o?.steps)) return "steps not array";
      if (o.steps.length < 1) return "empty steps";
      if (typeof o.total_steps !== "number") return "total_steps not number";
      if (typeof o.summary !== "string") return "summary missing";
      const s = o.steps[0];
      if (typeof s.step !== "number") return "step.step not number";
      if (!s.title || !s.description || !s.methodology) return "step fields missing";
      return null;
    },
  },
  {
    name: "memory-delta",
    prompt: `Extract memory from this conversation turn.
User said: "I want to build a React dashboard for tracking my crypto portfolio."
Reply ONLY with valid JSON:
{
  "decisions": [{"key":"...","value":"...","confidence":0.9}],
  "topics": ["..."],
  "summary": "..."
}`,
    validate(o: any) {
      if (!Array.isArray(o?.decisions)) return "decisions not array";
      if (!Array.isArray(o?.topics)) return "topics not array";
      if (typeof o.summary !== "string") return "summary missing";
      return null;
    },
  },
  {
    name: "keyword-extraction",
    prompt: `Extract technical keywords from: "I need a REST API using FastAPI with PostgreSQL and JWT auth."
Reply ONLY with valid JSON:
{
  "keywords": [{"term":"FastAPI","category":"framework","weight":0.9}],
  "domain": "backend"
}`,
    validate(o: any) {
      if (!Array.isArray(o?.keywords)) return "keywords not array";
      if (o.keywords.length === 0) return "no keywords extracted";
      const k = o.keywords[0];
      if (!k.term) return "keyword.term missing";
      return null;
    },
  },
  {
    name: "evaluation-result",
    prompt: `Evaluate if step 1 of onboarding is complete. The user provided their project name "BudgetPal" and goal "track monthly household expenses".
Reply ONLY with valid JSON:
{
  "is_valid": true,
  "feedback": "...",
  "suggestions": [],
  "ready_to_advance": true,
  "score": 85
}`,
    validate(o: any) {
      if (typeof o?.is_valid !== "boolean")       return "is_valid not boolean";
      if (typeof o?.feedback !== "string")         return "feedback missing";
      if (!Array.isArray(o?.suggestions))          return "suggestions not array";
      if (typeof o?.ready_to_advance !== "boolean") return "ready_to_advance not boolean";
      return null;
    },
  },
  {
    name: "context-resolve",
    prompt: `The user mentioned "@MyApp" in their message. Given project list: [{"id":"p1","title":"MyApp"}].
Resolve the context reference.
Reply ONLY with valid JSON:
{
  "has_context": true,
  "project_id": "p1",
  "project_title": "MyApp",
  "context_summary": "..."
}`,
    validate(o: any) {
      if (typeof o?.has_context !== "boolean") return "has_context not boolean";
      if (typeof o?.project_id !== "string") return "project_id missing";
      return null;
    },
  },
];

async function main() {
  const cases: TestCase[] = [];

  for (const c of CASES) {
    const r = await call(
      [{ role: "user", content: c.prompt }],
      DEFAULT_MODEL,
      "json",
    );
    const parsed = r.ok ? parseJson(r.text) : null;
    const failure = r.ok && parsed ? c.validate(parsed) : (r.error ?? "parse failed");
    cases.push({
      name: c.name,
      passed: failure === null,
      latencyMs: r.latencyMs,
      notes: failure ?? "ok",
      raw: r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
