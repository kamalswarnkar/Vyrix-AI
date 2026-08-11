/**
 * Phase 13 — Desirability Evaluation Calibration
 *
 * Tests the desirability-evaluation prompt and schema.
 * Validates score direction, evidence/assumption distinction, ready_for_ideation flag.
 *
 * Schema: desirability-evaluation
 *   required: stage, score, problem_clarity, demand_strength, ready_for_ideation
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "13-desirability";

const SCHEMA = `{"stage":"initial_desirability","score":0-100,"problem_clarity":{"summary":"...","score":0-100},"demand_strength":{"summary":"...","score":0-100},"evidence":[{"statement":"...","type":"evidence"|"assumption"|"unknown"|"requires_validation"}],"assumptions":["..."],"risks":["..."],"recommendations":["..."],"ready_for_ideation":bool}`;

interface DesCase {
  name:           string;
  prompt:         string;
  expectReady:    boolean;
  scoreMin?:      number;
  scoreMax?:      number;
}

const CASES: DesCase[] = [
  {
    name: "clear-problem-with-demand",
    prompt: `Evaluate the initial desirability of this project.
Project: CampusEats
Problem: University students on campus have limited food options and existing delivery apps don't serve the campus area.
Target outcome: A mobile app prototype for campus food ordering.
Evaluate problem clarity and demand strength. Stage must be "initial_desirability".
Output ONLY JSON: ${SCHEMA}`,
    expectReady: true,
    scoreMin:    50,
  },
  {
    name: "vague-problem-low-desirability",
    prompt: `Evaluate the initial desirability of this project.
Project: Something App
Problem: People need something better.
Target outcome: An app.
Evaluate problem clarity and demand strength. Stage must be "initial_desirability".

SCORING GUIDANCE:
- A high score (>60) requires: a named target user group, a specific problem with evidence, and identifiable demand signals.
- A medium score (40-60) requires at least one of those elements to be partially present.
- A low score (<40) applies when: the problem is undefined, no target users are named, no evidence exists, and no demand signals are present.
This submission has NONE of those elements. "People need something better" names no users, specifies no problem, and provides no evidence. Score MUST be below 40. Set ready_for_ideation: false.
Output ONLY JSON: ${SCHEMA}`,
    expectReady: false,
    scoreMax:    40,
  },
  {
    name: "evidence-assumption-distinction",
    prompt: `Evaluate the initial desirability of this project.
Project: WaterFilter
Problem: Rural communities in dry regions use contaminated water sources. NGO reports confirm this is the #1 health issue in 3 target districts.
Target outcome: Physical water filtration prototype.
The NGO report data is EVIDENCE. Demand from other regions is ASSUMPTION. Stage must be "initial_desirability".
Output ONLY JSON: ${SCHEMA}`,
    expectReady: true,
    scoreMin:    55,
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
      if (parsed.stage !== "initial_desirability")    failure = `stage "${parsed.stage}" != "initial_desirability"`;
      else if (typeof parsed.score !== "number")       failure = "score not a number";
      else if (typeof parsed.ready_for_ideation !== "boolean") failure = "ready_for_ideation not boolean";
      else {
        if (c.expectReady && !parsed.ready_for_ideation) {
          failure = `expected ready_for_ideation=true, got false (score=${parsed.score})`;
        } else if (!c.expectReady && parsed.ready_for_ideation) {
          failure = `expected ready_for_ideation=false, got true (score=${parsed.score})`;
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
      notes:     failure ?? `score=${parsed?.score}, ready=${parsed?.ready_for_ideation}`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
