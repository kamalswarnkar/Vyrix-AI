/**
 * MissionWorkflowEngine.test.ts
 * Unit tests for MissionWorkflowEngine state machine — deterministic, mock-only.
 *
 * Run: npx jest electron/ai/mission/MissionWorkflowEngine.test.ts
 */

import fs   from "node:fs/promises";
import os   from "node:os";
import path from "node:path";

import { MissionWorkflowEngine }  from "./MissionWorkflowEngine";
import { MissionClassifier }      from "./MissionClassifier";
import { DesirabilityEvaluator }  from "../evaluation/DesirabilityEvaluator";
import { DVFEvaluator }           from "../evaluation/DVFEvaluator";
import { ProgressEvaluator }      from "../evaluation/ProgressEvaluator";
import { DecisionEngine }         from "../evaluation/DecisionEngine";
import { AiPlanningEngine }       from "../planning/AiPlanningEngine";
import { RoadmapVersioning }      from "../planning/RoadmapVersioning";
import { ProjectStateManager }    from "../project/ProjectStateManager";
import { SchemaValidator }        from "../validation/SchemaValidator";
import { MockPromptEngine }       from "../__tests__/mocks/MockPromptEngine";
import { applyBeta2Defaults }     from "../__tests__/mocks/MockBeta2Responses";

// ── helpers ────────────────────────────────────────────────────────────────────

const VALID_PLAN = JSON.stringify({
  steps: [
    { step: 1, title: "Problem Clarification", description: "Clarify the problem", methodology: "research" },
    { step: 2, title: "User Research", description: "Interview users", methodology: "interviews" },
  ],
  total_steps: 2,
  summary: "Ideation roadmap",
});

let storageRoot: string;
let projectId:   string;
let engine:      MockPromptEngine;
let workflow:    MissionWorkflowEngine;

beforeEach(async () => {
  storageRoot = await fs.mkdtemp(path.join(os.tmpdir(), "vyrix-wf-test-"));
  engine = new MockPromptEngine();
  applyBeta2Defaults(engine);
  engine.onTaskType("interview-plan", VALID_PLAN);

  const validator     = new SchemaValidator();
  const projectState  = new ProjectStateManager(storageRoot);
  const planningEngine = new AiPlanningEngine(engine as any, validator, projectState);

  const classifier    = new MissionClassifier(engine as any, validator);
  const desirability  = new DesirabilityEvaluator(engine as any, validator);
  const dvf           = new DVFEvaluator(engine as any, validator);
  const progress      = new ProgressEvaluator(engine as any, validator);
  const decision      = new DecisionEngine(engine as any, validator);
  const versioning    = new RoadmapVersioning(planningEngine, projectState);

  workflow = new MissionWorkflowEngine(
    classifier, desirability, dvf, progress, decision,
    planningEngine, versioning, projectState,
  );

  const created = await projectState.create({ title: "Test Mission" });
  if (!created.ok) throw new Error("Failed to create project");
  projectId = created.data.id;
});

afterEach(async () => {
  await fs.rm(storageRoot, { recursive: true, force: true });
});

// ── classify ───────────────────────────────────────────────────────────────────

describe("classify()", () => {
  it("returns nextState=AWAITING_CLASSIFICATION_CONFIRMATION", async () => {
    const result = await workflow.classify(projectId, "I want to build an app");
    expect(result.ok).toBe(true);
    expect(result.nextState).toBe("AWAITING_CLASSIFICATION_CONFIRMATION");
    expect(result.data?.mission_type).toBe("project");
  });

  it("persists workflow_state to project meta", async () => {
    await workflow.classify(projectId, "I want to build an app");
    const projectState = new ProjectStateManager(storageRoot);
    const meta = await projectState.getMeta(projectId);
    if (!meta.ok) throw new Error("getMeta failed");
    expect(meta.data.workflow_state).toBe("AWAITING_CLASSIFICATION_CONFIRMATION");
  });
});

// ── confirmClassification ─────────────────────────────────────────────────────

describe("confirmClassification()", () => {
  beforeEach(async () => {
    await workflow.classify(projectId, "I want to build an app");
  });

  it("advances to PROJECT_GOAL_CAPTURE when confirmed", async () => {
    const result = await workflow.confirmClassification(projectId, true);
    expect(result.ok).toBe(true);
    expect(result.nextState).toBe("PROJECT_GOAL_CAPTURE");
  });

  it("reclassifies when correction provided", async () => {
    const result = await workflow.confirmClassification(
      projectId, false, "Actually I want to study ML",
    );
    // reclassification runs again, stays in AWAITING_CLASSIFICATION_CONFIRMATION
    expect(result.ok).toBe(true);
    expect(result.nextState).toBe("AWAITING_CLASSIFICATION_CONFIRMATION");
  });
});

// ── transition guard ──────────────────────────────────────────────────────────

describe("invalid transitions", () => {
  it("rejects jumping from NEW_MISSION to DVF_EVALUATION", async () => {
    // project is in NEW_MISSION state (default)
    const projectState = new ProjectStateManager(storageRoot);
    // Forcibly set to NEW_MISSION
    await projectState.updateMeta(projectId, { workflow_state: "NEW_MISSION" });
    const result = await workflow.generateFinalRoadmap(projectId);
    expect(result.ok).toBe(false);
    expect(result.error).toContain("Invalid transition");
  });
});
