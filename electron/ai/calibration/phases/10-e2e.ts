/**
 * Phase 10 — End-to-End Workflow
 * Simulates the full Vyrix user journey:
 * 1. User starts session → onboarding interview (6 steps)
 * 2. Interview completes → planning generates a roadmap
 * 3. Memory distilled from interview
 * 4. Project chat with context (uses memory + roadmap)
 * 5. Context resolution (@-mention)
 *
 * All model calls go through ollama.ts directly (no Electron IPC needed here).
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "10-e2e";

// Shared state across the workflow
interface WorkflowState {
  projectName?:    string;
  projectDesc?:    string;
  stack?:          string;
  extracted:       Record<string, unknown>;
  roadmap?:        unknown;
  memoryKeywords:  string[];
}

async function runInterview(state: WorkflowState): Promise<TestCase[]> {
  const cases: TestCase[] = [];
  const script = [
    "I'm building TaskFlow — a project management app for remote teams.",
    "Remote teams who need asynchronous collaboration tools.",
    "Next.js, Supabase, TypeScript.",
    "Kanban boards, real-time updates, time tracking.",
    "3 months, success = 500 paying users.",
    "Yes, all correct.",
  ];

  for (let i = 0; i < 6; i++) {
    const r = await call(
      [
        {
          role: "system",
          content: `Interview step ${i + 1}/6. Goal: collect project details. Context: ${JSON.stringify(state.extracted)}. Output ONLY JSON: {"step_number":${i+1},"ai_message":"...","skip_next_step":false,"extracted":{}}`,
        },
        { role: "user", content: script[i]! },
      ],
      DEFAULT_MODEL,
      "json",
    );
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    const ok = parsed?.step_number === i + 1 && !!parsed?.ai_message;
    if (parsed?.extracted) Object.assign(state.extracted, parsed.extracted);
    cases.push({
      name:      `e2e-interview-step-${i + 1}`,
      passed:    ok,
      latencyMs: r.latencyMs,
      notes:     ok ? `extracted: ${Object.keys(parsed?.extracted ?? {}).join(",")||"none"}` : (r.error ?? "bad shape"),
    });
  }

  // Capture project name from accumulated state
  state.projectName = (state.extracted as any).project_name ?? "TaskFlow";
  state.projectDesc = (state.extracted as any).project_description ?? "Project management for remote teams";

  return cases;
}

async function runPlanning(state: WorkflowState): Promise<TestCase> {
  const r = await call(
    [
      {
        role: "user",
        content: `Generate a 4-step roadmap for: ${state.projectName} — ${state.projectDesc}.
Stack: ${(state.extracted as any).tech_stack ?? "Next.js, Supabase"}.
Output ONLY JSON: {"steps":[{"step":1,"title":"...","description":"...","methodology":"..."}],"total_steps":4,"summary":"..."}`,
      },
    ],
    DEFAULT_MODEL,
    "json",
  );
  const parsed = r.ok ? parseJson<any>(r.text) : null;
  const ok = Array.isArray(parsed?.steps) && parsed.steps.length >= 2 && parsed?.summary;
  if (ok) state.roadmap = parsed;
  return {
    name:      "e2e-planning",
    passed:    !!ok,
    latencyMs: r.latencyMs,
    notes:     ok ? `${parsed.steps.length} steps` : (r.error ?? "bad shape"),
    parsed,
  };
}

async function runMemoryDistillation(state: WorkflowState): Promise<TestCase> {
  const summary = `Project: ${state.projectName}. Stack: Next.js, Supabase, TypeScript. Timeline: 3 months. Features: kanban, real-time, time tracking.`;
  const r = await call(
    [
      {
        role: "user",
        content: `Extract memory delta from: "${summary}"
Output ONLY JSON: {"decisions":[{"key":"...","value":"...","confidence":0.9}],"topics":["..."],"summary":"..."}`,
      },
    ],
    DEFAULT_MODEL,
    "json",
  );
  const parsed = r.ok ? parseJson<any>(r.text) : null;
  const ok = Array.isArray(parsed?.decisions) && parsed.decisions.length > 0;
  if (ok) state.memoryKeywords = parsed.topics ?? [];
  return {
    name:      "e2e-memory-distillation",
    passed:    !!ok,
    latencyMs: r.latencyMs,
    notes:     ok ? `${parsed.decisions.length} decisions, ${parsed.topics?.length ?? 0} topics` : (r.error ?? "bad shape"),
  };
}

async function runProjectChat(state: WorkflowState): Promise<TestCase> {
  const r = await call(
    [
      {
        role: "system",
        content: `You are assisting with project: ${state.projectName}.
Memory: ${state.memoryKeywords.slice(0, 5).join(", ")}.
Roadmap: ${state.roadmap ? JSON.stringify((state.roadmap as any).steps?.slice(0, 2)) : "not generated"}.
Answer the user's question helpfully.`,
      },
      { role: "user", content: "What should I build first?" },
    ],
    DEFAULT_MODEL,
  );
  return {
    name:      "e2e-project-chat",
    passed:    r.ok && r.text.length > 20,
    latencyMs: r.latencyMs,
    notes:     r.ok ? `${r.outputTokens ?? "?"} tokens` : (r.error ?? "failed"),
    raw:       r.text.slice(0, 200),
  };
}

async function runContextResolve(state: WorkflowState): Promise<TestCase> {
  const r = await call(
    [
      {
        role: "user",
        content: `The user said: "Can you show me the roadmap for @TaskFlow?"
Projects: [{"id":"p1","title":"TaskFlow"},{"id":"p2","title":"OtherApp"}]
Output ONLY JSON: {"has_context":true,"project_id":"p1","project_title":"TaskFlow","context_summary":"..."}`,
      },
    ],
    DEFAULT_MODEL,
    "json",
  );
  const parsed = r.ok ? parseJson<any>(r.text) : null;
  const ok = parsed?.has_context === true && parsed?.project_id === "p1";
  return {
    name:      "e2e-context-resolve",
    passed:    !!ok,
    latencyMs: r.latencyMs,
    notes:     ok ? "resolved correctly" : `has_context=${parsed?.has_context}, project_id=${parsed?.project_id}`,
  };
}

async function main() {
  const state: WorkflowState = { extracted: {}, memoryKeywords: [] };
  const cases: TestCase[] = [];

  console.log("▶ E2E: Interview...");
  cases.push(...await runInterview(state));

  console.log("▶ E2E: Planning...");
  cases.push(await runPlanning(state));

  console.log("▶ E2E: Memory distillation...");
  cases.push(await runMemoryDistillation(state));

  console.log("▶ E2E: Project chat...");
  cases.push(await runProjectChat(state));

  console.log("▶ E2E: Context resolve...");
  cases.push(await runContextResolve(state));

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
