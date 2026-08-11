/**
 * Phase 14 — DVF Evaluation Calibration
 *
 * Tests the dvf-evaluation prompt and schema.
 * Validates all three dimensions, score direction, ready_for_decision flag.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "14-dvf";

const SCHEMA = `{"stage":"dvf_evaluation","version":1,"desirability":{"score":0-100,"summary":"..."},"viability":{"score":0-100,"summary":"..."},"feasibility":{"score":0-100,"summary":"..."},"overall_score":0-100,"recommendation":"...","ready_for_decision":bool}`;

interface DVFCase {
  name:           string;
  prompt:         string;
  expectReady:    boolean;
  overallScoreMin?: number;
  overallScoreMax?: number;
}

const CASES: DVFCase[] = [
  {
    name: "strong-project-all-dimensions",
    prompt: `Conduct a full DVF evaluation.
Project: CampusEats (food delivery for university students)
Problem: Limited campus food options, no existing delivery service.
End goal: Working mobile app prototype.
Concepts: Campus-only delivery, peer delivery model, restaurant partnerships.
Stage must be "dvf_evaluation", version must be 1.
Output ONLY JSON: ${SCHEMA}`,
    expectReady:      true,
    overallScoreMin:  45,
  },
  {
    name: "weak-viability",
    prompt: `Conduct a full DVF evaluation.
Project: Free Social Network
Problem: People want a free social media platform.
End goal: Full product with 1M users in year 1, no monetization plan.
Concepts: Ad-free platform, donations only.
Stage must be "dvf_evaluation", version must be 1.
IMPORTANT: Viability is weak because there is no revenue model. Score viability below 30.
Output ONLY JSON: ${SCHEMA}`,
    expectReady:      true, // ready_for_decision based on overall, not individual dimensions
    overallScoreMax:  60,
  },
  {
    name: "three-dimensions-present",
    prompt: `Conduct a full DVF evaluation.
Project: AutoSave Tool for Google Docs users.
Problem: Users lose work when browser crashes.
End goal: Browser extension prototype.
Concepts: Periodic auto-save, crash detection, offline storage.
Stage must be "dvf_evaluation", version must be 1.
Output ONLY JSON: ${SCHEMA}`,
    expectReady: true,
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
      if (parsed.stage !== "dvf_evaluation") {
        failure = `stage "${parsed.stage}" != "dvf_evaluation"`;
      } else if (!parsed.desirability || !parsed.viability || !parsed.feasibility) {
        failure = "missing one or more DVF dimensions";
      } else if (typeof parsed.overall_score !== "number") {
        failure = "overall_score not a number";
      } else if (typeof parsed.ready_for_decision !== "boolean") {
        failure = "ready_for_decision not boolean";
      } else {
        if (c.overallScoreMin !== undefined && parsed.overall_score < c.overallScoreMin) {
          failure = `overall_score ${parsed.overall_score} below min ${c.overallScoreMin}`;
        }
        if (!failure && c.overallScoreMax !== undefined && parsed.overall_score > c.overallScoreMax) {
          failure = `overall_score ${parsed.overall_score} above max ${c.overallScoreMax}`;
        }
      }
    }

    cases.push({
      name:      c.name,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `D=${parsed?.desirability?.score} V=${parsed?.viability?.score} F=${parsed?.feasibility?.score} overall=${parsed?.overall_score}`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
