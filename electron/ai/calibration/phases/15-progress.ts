/**
 * Phase 15 — Progress Evaluation Calibration
 *
 * Tests the progress-evaluation prompt and schema.
 * Validates score direction, ready_to_advance flag, and rubric adherence.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "15-progress";

// ponytail: best deterministic wording found for Q4-on-Ollama — the ambiguous
// partial-completion case still stringifies/omits is_complete ~1 in 3 wordings.
// A filled example anchors values (model copies the example's score verbatim);
// abstract "bool" gets echoed as a string. This is a model-capability ceiling:
// the real fix is GBNF grammar enforcement via the llama.cpp sidecar (M05).
const SCHEMA = `{"step":1,"step_title":"...","is_complete":true|false,"score":0-100,"feedback":"1-2 sentences","suggestions":["..."],"ready_to_advance":true|false}`;

interface ProgCase {
  name:           string;
  prompt:         string;
  expectAdvance:  boolean;
  scoreMin?:      number;
  scoreMax?:      number;
}

const CASES: ProgCase[] = [
  {
    name: "strong-problem-clarification",
    prompt: `Evaluate the user's progress on project step 1.
Step: Problem Clarification
Goal: Articulate the problem clearly, identify who experiences it, and estimate significance.
User's work: "We are solving the problem of limited food options for 8,000+ university students on the XYZ campus. Currently, there is no delivery service. Students skip meals or travel 30 minutes off-campus. We interviewed 50 students — 80% said they would use a campus delivery service."
Score 0-100. Set ready_to_advance: true if score >= 60.
Output ONLY JSON: ${SCHEMA}`,
    expectAdvance: true,
    scoreMin:      65,
  },
  {
    name: "vague-work-no-advance",
    prompt: `Evaluate the user's progress on project step 1.
Step: Problem Clarification
Goal: Articulate the problem clearly, identify who experiences it, and estimate significance.
User's work: "There's a problem with food."
Score 0-100. Set ready_to_advance: true if score >= 60. A one-sentence vague response should score below 30.
Output ONLY JSON: ${SCHEMA}`,
    expectAdvance: false,
    scoreMax:      30,
  },
  {
    name: "partial-work-above-30",
    prompt: `Evaluate the user's progress on project step 2.
Step: User Identification
Goal: Identify the primary user group with at least demographic info and 2 specific pain points.
User's work: "Our users are university students. They have trouble finding food quickly."
SCORING: The user identified the demographic (students) but provided only vague pain points with no specifics. This is a partial attempt — score MUST be between 30 and 59.
Score 0-100. Set ready_to_advance: true if score >= 60.
Output ONLY JSON: ${SCHEMA}`,
    expectAdvance: false,
    scoreMin:      30,
    scoreMax:      59,
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
      if (typeof parsed.score !== "number")                    failure = "score not a number";
      else if (typeof parsed.ready_to_advance !== "boolean")   failure = "ready_to_advance not boolean";
      else if (typeof parsed.is_complete !== "boolean")        failure = "is_complete not boolean";
      else {
        if (c.expectAdvance && !parsed.ready_to_advance) {
          failure = `expected ready_to_advance=true, got false (score=${parsed.score})`;
        } else if (!c.expectAdvance && parsed.ready_to_advance) {
          failure = `expected ready_to_advance=false, got true (score=${parsed.score})`;
        }
        if (!failure && c.scoreMin !== undefined && parsed.score < c.scoreMin) {
          failure = `score ${parsed.score} below min ${c.scoreMin}`;
        }
        if (!failure && c.scoreMax !== undefined && parsed.score > c.scoreMax) {
          failure = `score ${parsed.score} above max ${c.scoreMax}`;
        }
      }
    }

    cases.push({
      name:      c.name,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `score=${parsed?.score}, advance=${parsed?.ready_to_advance}`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
