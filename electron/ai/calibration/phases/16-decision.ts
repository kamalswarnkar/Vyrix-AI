/**
 * Phase 16 — Decision Engine Calibration
 *
 * Tests the decision prompt and schema.
 * Validates that CONTINUE / IMPROVE / REDESIGN classifications match DVF scores.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "16-decision";

const SCHEMA = `{"decision":"continue"|"improve"|"redesign","reasoning":"...","confidence":0-100,"next_steps":["..."]}`;

interface DecCase {
  name:           string;
  prompt:         string;
  expectDecision: "continue" | "improve" | "redesign";
}

const CASES: DecCase[] = [
  {
    name: "strong-dvf-continue",
    prompt: `Recommend a decision after DVF evaluation.
Project: CampusEats (food delivery app)
End goal: Mobile app prototype
DVF overall score: 80/100
Summary: Strong desirability (85), good viability (78), feasible tech stack (77).
Gaps: Minor — need to confirm restaurant partnerships.
User feedback: "I'm happy with the evaluation. Let's keep going."
The user is confident and the score is high. Recommend "continue".
Output ONLY JSON: ${SCHEMA}`,
    expectDecision: "continue",
  },
  {
    name: "moderate-dvf-improve",
    prompt: `Recommend a decision after DVF evaluation.
Project: Social Learning App
End goal: Working prototype
DVF overall score: 58/100
Summary: Good desirability (72), weak viability (42 — no revenue model), decent feasibility (60).
Gaps: Revenue model undefined, competition not analyzed.
Recommend "improve" because the core concept is sound but viability needs work.
Output ONLY JSON: ${SCHEMA}`,
    expectDecision: "improve",
  },
  {
    name: "low-dvf-redesign",
    prompt: `Recommend a decision after DVF evaluation.
Project: Premium SMS News Service
End goal: Full product
DVF overall score: 28/100
Summary: Low desirability (30 — SMS is obsolete for this use case), poor viability (22 — can't compete with free apps), adequate feasibility (65).
The core approach is fundamentally flawed. User said: "Maybe I need to rethink this completely."
Recommend "redesign".
Output ONLY JSON: ${SCHEMA}`,
    expectDecision: "redesign",
  },
];

async function main() {
  const cases: TestCase[] = [];

  for (const c of CASES) {
    const r = await call([{ role: "user", content: c.prompt }], DEFAULT_MODEL, "json");
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    let failure: string | null = null;

    if (!r.ok || !parsed) {
      failure = r.error ?? "parse failed";
    } else {
      if (!["continue", "improve", "redesign"].includes(parsed.decision)) {
        failure = `invalid decision "${parsed.decision}"`;
      } else if (parsed.decision !== c.expectDecision) {
        failure = `expected "${c.expectDecision}", got "${parsed.decision}"`;
      } else if (typeof parsed.confidence !== "number") {
        failure = "confidence not a number";
      } else if (!Array.isArray(parsed.next_steps) || parsed.next_steps.length === 0) {
        failure = "next_steps empty or missing";
      }
    }

    cases.push({
      name:      c.name,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `decision=${parsed?.decision}, confidence=${parsed?.confidence}`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
