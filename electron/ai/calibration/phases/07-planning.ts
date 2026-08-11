/**
 * Phase 07 — Planning Generation Quality
 * Tests InterviewPlan generation: step count, field completeness, logical ordering,
 * and plan refinement (taking feedback and improving an existing plan).
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "07-planning";

const PROJECT_CONTEXT = {
  name:        "BudgetPal",
  description: "A personal finance tracker for monthly expense management",
  stack:       "React, Node.js, PostgreSQL",
  timeline:    "2 months",
  features:    "Expense entry, monthly reports, budget alerts",
};

const GENERATE_PROMPT = `Generate a development roadmap for this project:
Name: ${PROJECT_CONTEXT.name}
Description: ${PROJECT_CONTEXT.description}
Stack: ${PROJECT_CONTEXT.stack}
Timeline: ${PROJECT_CONTEXT.timeline}
Features: ${PROJECT_CONTEXT.features}

Create a 5-step plan. Output ONLY valid JSON:
{
  "steps": [
    {"step":1,"title":"...","description":"...","methodology":"...","estimated_duration":"...","deliverable":"..."}
  ],
  "total_steps": 5,
  "summary": "..."
}`;

async function main() {
  const cases: TestCase[] = [];

  // 1. Generate plan
  let generatedPlan: any = null;
  {
    const r = await call([{ role: "user", content: GENERATE_PROMPT }], DEFAULT_MODEL, "json");
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    let failure: string | null = null;

    if (!r.ok || !parsed) {
      failure = r.error ?? "parse failed";
    } else {
      if (!Array.isArray(parsed.steps))          failure = "steps not array";
      else if (parsed.steps.length < 3)          failure = `only ${parsed.steps.length} steps`;
      else if (typeof parsed.total_steps !== "number") failure = "total_steps not number";
      else if (!parsed.summary)                  failure = "summary missing";
      else {
        // Validate each step
        for (const s of parsed.steps) {
          if (!s.title || !s.description || !s.methodology) {
            failure = `step ${s.step} missing required fields`;
            break;
          }
        }
        // Check steps are ordered 1..N
        if (!failure) {
          for (let i = 0; i < parsed.steps.length; i++) {
            if (parsed.steps[i].step !== i + 1) {
              failure = `step numbering off at index ${i}: got ${parsed.steps[i].step}`;
              break;
            }
          }
        }
      }
    }

    if (!failure) generatedPlan = parsed;

    cases.push({
      name:      "plan-generation",
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `${parsed?.steps?.length ?? 0} steps, summary: ${String(parsed?.summary ?? "").slice(0, 80)}`,
      raw:       r.text.slice(0, 400),
      parsed,
    });
  }

  // 2. Plan refinement (only if generation passed)
  if (generatedPlan) {
    const refinePrompt = `Here is a project roadmap:
${JSON.stringify(generatedPlan, null, 2)}

The client has new feedback: "We also need user authentication and a mobile-responsive UI."
Refine the plan to incorporate this feedback. Keep the same JSON structure. Output ONLY valid JSON.`;

    const r = await call([{ role: "user", content: refinePrompt }], DEFAULT_MODEL, "json");
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    let failure: string | null = null;

    if (!r.ok || !parsed) {
      failure = r.error ?? "parse failed";
    } else if (!Array.isArray(parsed.steps) || parsed.steps.length === 0) {
      failure = "steps missing after refinement";
    } else {
      // Check that auth or mobile appears somewhere in the refined plan
      const allText = JSON.stringify(parsed).toLowerCase();
      if (!allText.includes("auth") && !allText.includes("mobile") && !allText.includes("responsive")) {
        failure = "feedback not incorporated (no auth/mobile keywords found)";
      }
    }

    cases.push({
      name:      "plan-refinement",
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `${parsed?.steps?.length ?? 0} steps after refinement`,
      raw:       r.text.slice(0, 400),
      parsed,
    });
  } else {
    cases.push({ name: "plan-refinement", passed: false, notes: "skipped — generation failed" });
  }

  // 3. Minimal plan (edge case: very vague input)
  {
    const r = await call(
      [{ role: "user", content: 'Generate a 3-step plan for "an app". Output ONLY valid JSON with keys: steps, total_steps, summary.' }],
      DEFAULT_MODEL,
      "json",
    );
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    const failure = r.ok && parsed && Array.isArray(parsed.steps) && parsed.steps.length >= 1 ? null : "failed on vague input";
    cases.push({
      name:      "plan-vague-input",
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `produced ${parsed?.steps?.length} steps for vague prompt`,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
