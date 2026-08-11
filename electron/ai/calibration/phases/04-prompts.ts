/**
 * Phase 04 — Prompt Template Calibration
 * Tests each prompt template by rendering it with known inputs and verifying
 * the model produces correct-shaped output. Catches template variable bugs
 * and instruction drift before they hit production.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "04-prompts";

// Minimal inline template renderer — same logic as PromptCompiler but standalone.
// ponytail: no import from main codebase; calibration scripts run standalone.
function render(template: string, vars: Record<string, string>): string {
  return template.replace(/\{\{(\w+)\}\}/g, (_, k) => vars[k] ?? `{{${k}}}`);
}

interface PromptCase {
  name:     string;
  system:   string;
  user:     string;
  vars:     Record<string, string>;
  validate: (o: unknown) => string | null;
}

const CASES: PromptCase[] = [
  {
    name: "interview-step-1",
    system: `You are an AI project assistant conducting a structured onboarding interview.
Current step: {{step_number}} of {{total_steps}}.
Step goal: {{step_goal}}
Previously collected: {{extracted_so_far}}
Output ONLY valid JSON with keys: step_number, ai_message, skip_next_step, extracted.`,
    user: "Hi, I'd like to start.",
    vars: {
      step_number:      "1",
      total_steps:      "6",
      step_goal:        "Learn the project name and high-level description",
      extracted_so_far: "{}",
    },
    validate(o: any) {
      if (o?.step_number !== 1) return `step_number=${o?.step_number}, want 1`;
      if (!o?.ai_message)       return "ai_message empty";
      return null;
    },
  },
  {
    name: "interview-step-extract",
    system: `You are an AI project assistant. Extract structured data from the user's response.
Step: {{step_number}} | Goal: {{step_goal}}
Output ONLY valid JSON with keys: step_number, ai_message, skip_next_step, extracted.
Put any extracted values in the "extracted" object.`,
    user: "My project is called BudgetPal and it helps users track their monthly expenses.",
    vars: {
      step_number: "1",
      step_goal:   "Collect project name and description",
    },
    validate(o: any) {
      if (!o?.ai_message)    return "ai_message missing";
      if (!o?.extracted)     return "extracted missing";
      const hasData = Object.keys(o.extracted).length > 0;
      if (!hasData)          return "extracted is empty — model did not extract data";
      return null;
    },
  },
  {
    name: "memory-distillation",
    // memory-delta schema: single {key, value, category, confidence?}
    system: `Extract the single most important fact from this conversation turn.
Project: {{project_name}}
Category must be one of: technical, design, user, timeline, decision, general.
If nothing is worth remembering, return key: "no-op" and value: "".
Output ONLY valid JSON: {"key":"...","value":"...","category":"technical","confidence":0.9}`,
    user: "I want to use React for the frontend and Node.js for the API.",
    vars: { project_name: "BudgetPal" },
    validate(o: any) {
      if (!o?.key   || typeof o.key   !== "string") return "key missing";
      if (!o?.value || typeof o.value !== "string") return "value missing";
      const categories = ["technical","design","user","timeline","decision","general"];
      if (!categories.includes(o?.category)) return `invalid category: ${o?.category}`;
      if (o.key === "no-op")  return "no-op for meaningful tech-stack input";
      return null;
    },
  },
  {
    name: "context-resolve",
    system: `The user mentioned a project reference in their message.
Available projects: {{projects_json}}
Determine which project they're referring to and output ONLY valid JSON:
{has_context:bool, project_id:string, project_title?:string, context_summary?:string}`,
    user: "Can you help me with @BudgetPal?",
    vars: { projects_json: '[{"id":"p1","title":"BudgetPal"},{"id":"p2","title":"OtherApp"}]' },
    validate(o: any) {
      if (typeof o?.has_context !== "boolean") return "has_context not boolean";
      if (o.has_context && o.project_id !== "p1") return `wrong project_id: ${o.project_id}`;
      return null;
    },
  },
  {
    name: "evaluation-step",
    // evaluation-result schema: {is_valid, feedback, suggestions, ready_to_advance, score(0-100)}
    system: `Evaluate if the following interview step is complete.
Step goal: {{step_goal}}
User response: "{{user_response}}"
Score 0-100 (integer). Set ready_to_advance: true if score >= 60.
Output ONLY valid JSON: {"is_valid":bool,"feedback":"...","suggestions":["..."],"ready_to_advance":bool,"score":85}`,
    user: "",
    vars: {
      step_goal:     "Collect project name and description",
      user_response: "I'm building BudgetPal to track monthly household expenses.",
    },
    validate(o: any) {
      if (typeof o?.is_valid !== "boolean")       return "is_valid not boolean";
      if (typeof o?.feedback !== "string")         return "feedback missing";
      if (!Array.isArray(o?.suggestions))          return "suggestions not array";
      if (typeof o?.ready_to_advance !== "boolean") return "ready_to_advance not boolean";
      return null;
    },
  },
];

async function main() {
  const cases: TestCase[] = [];

  for (const c of CASES) {
    const system = render(c.system, c.vars);
    const user   = render(c.user,   c.vars);

    const r = await call(
      [
        { role: "system", content: system },
        { role: "user",   content: user || "(begin)" },
      ],
      DEFAULT_MODEL,
      "json",
    );

    const parsed  = r.ok ? parseJson(r.text) : null;
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

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
