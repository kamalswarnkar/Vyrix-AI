/**
 * templates/planning.ts
 *
 * Prompt templates for the AI Planning Engine (M18).
 * Generates structured InterviewPlan (5-10 step roadmaps) and
 * context-aware planning advice.
 */

export interface PlanGenerationVars {
  /** Mission title */
  missionTitle:    string;
  /** Compiled project context string from ContextBuilder */
  contextBlock:    string;
  /** Number of steps to generate (5-10) */
  stepCount?:      number;
  /** Any specific user constraints or preferences */
  userConstraints?: string;
}

export interface RoadmapRefinementVars {
  /** Mission title */
  missionTitle: string;
  /** Current roadmap JSON (serialised) */
  currentPlan:  string;
  /** User's refinement request */
  userRequest:  string;
}

// ─── Planning system prompt ───────────────────────────────────────────────────

export function planningSystemPrompt(): string {
  return `You are Vyrix, an expert strategic planning AI.
Your task is to generate structured, actionable roadmaps for missions.

RULES:
- Each step must be concrete, measurable, and achievable.
- Steps should build on each other in logical order.
- Include methodology hints (e.g., "use MoSCoW prioritisation", "conduct stakeholder interview").
- Estimated durations should be realistic ranges (e.g., "1-2 days", "1 week").
- Respond ONLY with a valid JSON object. No text outside the JSON.

REQUIRED OUTPUT SHAPE:
{
  "steps": [
    {
      "step": <integer starting from 1>,
      "title": "<step title>",
      "description": "<what to do in this step>",
      "methodology": "<how to approach this step>",
      "estimated_duration": "<e.g. '3-5 days'>",
      "deliverable": "<tangible output of this step>"
    }
  ],
  "total_steps": <integer matching steps array length>,
  "summary": "<one-paragraph overview of the full roadmap>"
}`.trim();
}

// ─── Plan generation prompt ───────────────────────────────────────────────────

export function planGenerationPrompt(vars: PlanGenerationVars): string {
  const { missionTitle, contextBlock, stepCount = 7, userConstraints } = vars;

  const contextSection = contextBlock
    ? `\n\nProject context:\n${contextBlock}`
    : "";

  const constraintsLine = userConstraints
    ? `\n\nUser constraints: ${userConstraints}`
    : "";

  return `Generate a ${stepCount}-step actionable roadmap for this mission.

Mission: "${missionTitle}"${contextSection}${constraintsLine}

Requirements:
- Between 5 and 10 steps total
- Each step should have a clear title, description, and methodology
- Include estimated duration and deliverable for each step
- Steps must be in logical dependency order

Respond with valid JSON matching the InterviewPlan schema.`.trim();
}

// ─── Roadmap refinement prompt ────────────────────────────────────────────────

export function roadmapRefinementPrompt(vars: RoadmapRefinementVars): string {
  const { missionTitle, currentPlan, userRequest } = vars;

  return `Refine the following roadmap for mission "${missionTitle}" based on the user's request.

Current roadmap:
${currentPlan}

User request: "${userRequest}"

Update the roadmap to incorporate the user's feedback while maintaining logical step ordering.
Respond with valid JSON matching the InterviewPlan schema.`.trim();
}

// ─── Context-resolve prompt ───────────────────────────────────────────────────

export interface ContextResolveVars {
  /** The user's message to analyse */
  message:     string;
  /** List of available project summaries */
  projects:    Array<{ id: string; title: string; description?: string }>;
}

export function contextResolvePrompt(vars: ContextResolveVars): string {
  const { message, projects } = vars;

  const projectList = projects
    .map((p, i) => `${i + 1}. [${p.id}] "${p.title}"${p.description ? `: ${p.description.slice(0, 100)}` : ""}`)
    .join("\n");

  return `Analyse the user's message and determine which project it relates to, if any.

Available projects:
${projectList}

User message: "${message}"

If the message clearly relates to one of the listed projects, set has_context: true and project_id to the matching ID.
If no project is clearly relevant, set has_context: false and project_id: "".

Respond ONLY with JSON:
{"has_context":bool,"project_id":"<id or empty>","project_title":"<optional>","context_summary":"<optional one sentence>"}`.trim();
}
