/**
 * Phase 08 — Evaluation Framework Calibration
 * Tests the evaluation prompts that score interview step completeness
 * and roadmap quality. Validates score ranges, directional correctness,
 * and that suggestions are generated for incomplete responses.
 *
 * Schema: evaluation-result
 *   required: is_valid(bool), feedback(string), suggestions(string[]), ready_to_advance(bool)
 *   optional: score(integer 0-100), strengths(string[])
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "08-evaluation";

// Inline schema so model knows exactly what to produce
const EVAL_SCHEMA = `{"is_valid":bool,"feedback":"...","suggestions":["..."],"ready_to_advance":bool,"score":0-100}`;

interface EvalCase {
  name:         string;
  prompt:       string;
  expectValid:  boolean;   // expect is_valid=true?
  expectAdvance: boolean;  // expect ready_to_advance=true?
  scoreMin?:    number;    // 0-100
  scoreMax?:    number;    // 0-100
}

const EVAL_CASES: EvalCase[] = [
  {
    name: "complete-step",
    prompt: `Evaluate if this interview step is complete.
Step goal: "Collect project name and description"
User response: "I'm building BudgetPal — a personal finance tracker that helps users log and categorise monthly expenses across different spending categories."
CRITERIA: A clear project name AND a clear description of what it does = step is complete. Do NOT require business model, target audience, or implementation details at this stage.
This response provides both. Set is_valid:true and ready_to_advance:true.
Output ONLY JSON: ${EVAL_SCHEMA}`,
    expectValid:   true,
    expectAdvance: true,
    scoreMin:      70,
  },
  {
    name: "incomplete-step",
    prompt: `Evaluate if this interview step is complete.
Step goal: "Collect project name, description, and target audience"
User response: "I want to make an app."
Is this response on-topic, specific, and complete enough to proceed?
Output ONLY JSON: ${EVAL_SCHEMA}
Set is_valid:false and ready_to_advance:false for vague responses. Include suggestions for improvement.`,
    expectValid:   false,
    expectAdvance: false,
    scoreMax:      50,
  },
  {
    name: "partial-step",
    prompt: `Evaluate if this interview step is complete.
Step goal: "Collect technical stack AND project timeline" (both are required)
User response: "I want to use React for the frontend but I haven't decided on the timeline yet."
RULE: The step requires BOTH a tech stack AND a timeline. The user only provided one of two required fields.
Set is_valid:false and ready_to_advance:false. Suggest they provide the missing timeline.

SCORING RUBRIC (score must be an integer 0-100):
  0-10:  No attempt or completely off-topic
 11-29:  Minimal attempt — tangentially related but provides nothing useful
 30-50:  Meaningful partial attempt — user addressed SOME required fields but is missing key information (e.g. provided one of two required items)
 51-74:  Mostly complete — covers the main goal with minor gaps
 75-89:  Strong response — specific, on-topic, covers the goal fully
 90-100: Exceptional — specific, well-supported, goes beyond minimum

IMPORTANT: This user provided a concrete tech stack (React) which is one of the two required fields. That is a meaningful partial attempt. Score MUST be 30-50. Do NOT score below 30.
Output ONLY JSON: ${EVAL_SCHEMA}`,
    expectValid:   false,
    expectAdvance: false,
    scoreMin:      30,
    scoreMax:      75,
  },
  {
    name: "roadmap-quality-good",
    prompt: `Evaluate the quality of this project roadmap.
Project: BudgetPal (expense tracker, React+Node, 2 months)
Roadmap steps:
1. Setup & Auth — Configure project skeleton and JWT auth (Agile sprint, 3 days, deliverable: working auth)
2. Core Features — Expense CRUD, categories, dashboard (TDD, 2 weeks, deliverable: MVP feature set)
3. Reports & Alerts — Monthly reports, budget threshold alerts (Feature-driven, 1 week, deliverable: reporting module)
4. Testing & QA — E2E tests, performance audit (QA sprint, 3 days, deliverable: test suite)
5. Deploy & Launch — CI/CD, production deploy, monitoring (DevOps, 2 days, deliverable: live app)
CRITERIA: A production-quality roadmap has 3-7 steps, a methodology per step, a deliverable per step, and a realistic timeline. Do NOT require user stories or acceptance criteria — those belong in a backlog, not a roadmap.
This roadmap meets all criteria. Set is_valid:true and ready_to_advance:true.
Output ONLY JSON: ${EVAL_SCHEMA}`,
    expectValid:   true,
    expectAdvance: true,
    scoreMin:      70,
  },
  {
    name: "roadmap-quality-poor",
    prompt: `Evaluate the quality of this project roadmap.
Project: BudgetPal (expense tracker)
Roadmap: [{"step":1,"title":"Build it","description":"Make the app","methodology":"just do it"}]
Is this roadmap complete, logical, and production-quality?
Output ONLY JSON: ${EVAL_SCHEMA}
This is deliberately vague — set is_valid:false and provide specific suggestions.`,
    expectValid:   false,
    expectAdvance: false,
    scoreMax:      40,
  },
  {
    name: "suggestions-populated-on-failure",
    prompt: `Evaluate this user response to step 3 (output type clarification).
Step goal: "Identify what type of output or deliverable is expected"
User response: "something"
Output ONLY JSON: ${EVAL_SCHEMA}
The suggestions array must contain at least one improvement recommendation.`,
    expectValid:   false,
    expectAdvance: false,
  },
];

async function main() {
  const cases: TestCase[] = [];

  for (const c of EVAL_CASES) {
    const r = await call([{ role: "user", content: c.prompt }], DEFAULT_MODEL, "json");
    const parsed = r.ok ? parseJson<any>(r.text) : null;
    let failure: string | null = null;

    if (!r.ok || !parsed) {
      failure = r.error ?? "parse failed";
    } else {
      // Required fields
      if (typeof parsed.is_valid !== "boolean")       failure = "is_valid not boolean";
      else if (typeof parsed.feedback !== "string")   failure = "feedback missing";
      else if (!Array.isArray(parsed.suggestions))    failure = "suggestions not array";
      else if (typeof parsed.ready_to_advance !== "boolean") failure = "ready_to_advance not boolean";
      else {
        // Directional checks
        if (c.expectValid && !parsed.is_valid) {
          failure = `expected is_valid=true, got false (score=${parsed.score})`;
        } else if (!c.expectValid && parsed.is_valid) {
          failure = `expected is_valid=false, got true (score=${parsed.score})`;
        }
        if (!failure && c.expectAdvance && !parsed.ready_to_advance) {
          failure = `expected ready_to_advance=true, got false`;
        } else if (!failure && !c.expectAdvance && parsed.ready_to_advance) {
          failure = `expected ready_to_advance=false, got true`;
        }
        // Score range (score is integer 0-100; may be absent)
        const score = typeof parsed.score === "number" ? parsed.score : null;
        if (!failure && score !== null) {
          if (c.scoreMin !== undefined && score < c.scoreMin) {
            failure = `score ${score} below min ${c.scoreMin}`;
          }
          if (!failure && c.scoreMax !== undefined && score > c.scoreMax) {
            failure = `score ${score} above max ${c.scoreMax}`;
          }
        }
        // Suggestions check for failure cases
        if (!failure && c.name === "suggestions-populated-on-failure") {
          if (parsed.suggestions.length === 0) failure = "suggestions empty on failed evaluation";
        }
      }
    }

    cases.push({
      name:      c.name,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `is_valid=${(parsed as any)?.is_valid}, score=${(parsed as any)?.score}, advance=${(parsed as any)?.ready_to_advance}`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
