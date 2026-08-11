/**
 * Phase 12 — Mission Classification Calibration
 *
 * Tests the mission-classification prompt and schema.
 * Validates that the model correctly classifies subject vs project missions.
 *
 * Schema: mission-classification
 *   required: mission_type(string), confidence(int), reasoning(string), understood_problem(string)
 *
 * NOTE: Requires live Ollama. Will skip gracefully if model is unavailable.
 */

import { call, parseJson, DEFAULT_MODEL } from "../ollama";
import { writeResults, printSummary, TestCase } from "../result";

const PHASE = "12-mission-classification";

const SCHEMA = `{"mission_type":"subject"|"project","confidence":0-100,"reasoning":"...","understood_problem":"...","detected_goals":["..."],"constraints":["..."]}`;

interface ClassifyCase {
  name:              string;
  prompt:            string;
  expectType:        "subject" | "project";
  minConfidence?:    number;
}

const CASES: ClassifyCase[] = [
  {
    name: "clear-project",
    prompt: `Classify this mission.
User: "I want to build a food delivery app for university students. The problem is that campus food options are limited and existing apps don't serve this area. I need to create a prototype within 3 months with a team of 2."
Output ONLY JSON: ${SCHEMA}`,
    expectType:     "project",
    minConfidence:  60,
  },
  {
    name: "clear-subject",
    prompt: `Classify this mission.
User: "I want to learn machine learning from scratch. I need to understand supervised learning, neural networks, and model evaluation. I'll follow a structured curriculum."
Output ONLY JSON: ${SCHEMA}`,
    expectType:     "subject",
    minConfidence:  60,
  },
  {
    name: "project-with-physical-deliverable",
    prompt: `Classify this mission.
User: "I want to design and build a low-cost water filtration device for rural communities. The problem is contaminated water. I need a physical prototype."
Output ONLY JSON: ${SCHEMA}`,
    expectType:     "project",
    minConfidence:  50,
  },
  {
    name: "subject-with-certification",
    prompt: `Classify this mission using these definitions:

SUBJECT/MODULE: A learning or skill-building mission with predefined goals, predefined methodology (curriculum, modules, syllabus), and known expected outcomes. The user follows an existing structured path. Examples: studying for a certification, learning a programming language, completing a course.

PROJECT: A problem-solving mission where the solution must be discovered. It has a problem statement, constraints, resources, and an outcome that is not predetermined. Examples: building a product, designing a device, researching a novel solution.

User: "I need to prepare for my AWS Solutions Architect certification. I'll study the required topics and practice exams."

This is a SUBJECT because: the AWS certification has a predefined curriculum (exam topics), predefined methodology (study + practice exams), and a known expected outcome (pass/fail). The user is following an existing structured path, not discovering a solution.
Output ONLY JSON: ${SCHEMA}`,
    expectType:     "subject",
    minConfidence:  50,
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
      if (typeof parsed.mission_type !== "string") {
        failure = "mission_type missing";
      } else if (parsed.mission_type !== c.expectType) {
        failure = `expected mission_type="${c.expectType}", got "${parsed.mission_type}"`;
      } else if (typeof parsed.confidence !== "number") {
        failure = "confidence not a number";
      } else if (c.minConfidence !== undefined && parsed.confidence < c.minConfidence) {
        failure = `confidence ${parsed.confidence} below min ${c.minConfidence}`;
      } else if (typeof parsed.reasoning !== "string" || parsed.reasoning.length < 5) {
        failure = "reasoning missing or too short";
      } else if (typeof parsed.understood_problem !== "string" || parsed.understood_problem.length < 5) {
        failure = "understood_problem missing or too short";
      }
    }

    cases.push({
      name:      c.name,
      passed:    failure === null,
      latencyMs: r.latencyMs,
      notes:     failure ?? `type=${parsed?.mission_type}, confidence=${parsed?.confidence}`,
      raw:       r.text.slice(0, 300),
      parsed,
    });
  }

  const result = writeResults(PHASE, DEFAULT_MODEL, cases);
  printSummary(result);
  process.exit(result.failed > 0 ? 1 : 0);
}

main().catch((e) => { console.error(e); process.exit(1); });
