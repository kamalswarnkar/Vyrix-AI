/**
 * templates/evaluation.ts
 *
 * Prompt templates for the AI Evaluation Framework (M19).
 * Used to validate interview responses, roadmap steps, and
 * user inputs before advancing the state machine.
 */

export interface EvaluationVars {
  /** What is being evaluated */
  subject:        string;
  /** The content to evaluate */
  content:        string;
  /** Specific criteria to evaluate against */
  criteria:       string[];
  /** Context that informs the evaluation */
  contextBlock?:  string;
}

export interface StepCompletionEvalVars {
  /** Step number (1-6) */
  stepNumber:   number;
  /** User's response to the interview question */
  userResponse: string;
  /** What the step was trying to elicit */
  stepGoal:     string;
}

// ─── Evaluation system prompt ─────────────────────────────────────────────────

export function evaluationSystemPrompt(): string {
  return `You are Vyrix, an expert quality evaluator for strategic planning sessions.
Your task is to evaluate whether a user's input meets the required quality bar to advance.

RULES:
- Be fair and constructive in your feedback.
- Score from 0 to 100 (integer). A score >= 70 sets ready_to_advance: true.
- Provide specific, actionable suggestions when the score is below 70.
- Respond ONLY with a valid JSON object. No text outside the JSON.

REQUIRED OUTPUT SHAPE:
{
  "is_valid": <true if response meets the criteria>,
  "feedback": "<detailed assessment>",
  "suggestions": ["<actionable improvement 1>", "<improvement 2>"],
  "ready_to_advance": <true if score >= 70>,
  "score": <integer 0-100>,
  "strengths": ["<what the user did well>"]
}`.trim();
}

// ─── General evaluation prompt ────────────────────────────────────────────────

export function evaluationPrompt(vars: EvaluationVars): string {
  const { subject, content, criteria, contextBlock } = vars;

  const criteriaList = criteria.map((c, i) => `${i + 1}. ${c}`).join("\n");

  const contextSection = contextBlock
    ? `\n\nProject context:\n${contextBlock}`
    : "";

  return `Evaluate the following ${subject}.
${contextSection}

Content to evaluate:
"${content}"

Evaluation criteria:
${criteriaList}

Score 0-100 (integer). Set ready_to_advance: true if score >= 70.
Respond ONLY with JSON: {"is_valid":bool,"feedback":"...","suggestions":["..."],"ready_to_advance":bool,"score":75}`.trim();
}

// ─── Interview step completion evaluation ─────────────────────────────────────

export function stepCompletionEvalPrompt(vars: StepCompletionEvalVars): string {
  const { stepNumber, userResponse, stepGoal } = vars;

  return `Evaluate whether the user's response adequately completes interview step ${stepNumber}.

Step goal: ${stepGoal}
User response: "${userResponse}"

Criteria:
1. The response is on-topic and addresses the step goal
2. The response contains concrete, specific information (not vague)
3. The response is of sufficient length (not a single word)

SCORING RUBRIC (score must be an integer 0-100):
  0-10:  No attempt or completely off-topic
 11-29:  Minimal attempt — tangentially related but provides nothing useful
 30-50:  Meaningful partial attempt — user addressed SOME required fields but is missing key information (e.g. provided one of two required items)
 51-74:  Mostly complete — covers the main goal with minor gaps
 75-89:  Strong response — specific, on-topic, covers the goal fully
 90-100: Exceptional — specific, well-supported, goes beyond minimum

IMPORTANT: A partial attempt that provides SOMETHING relevant must score >= 30, even if is_valid is false.
Set ready_to_advance: true if score >= 60.
Respond ONLY with JSON: {"is_valid":bool,"feedback":"...","suggestions":["..."],"ready_to_advance":bool,"score":75}`.trim();
}

// ─── Roadmap quality evaluation ───────────────────────────────────────────────

export interface RoadmapEvalVars {
  missionTitle: string;
  roadmapJson:  string;
  contextBlock?: string;
}

export function roadmapEvalPrompt(vars: RoadmapEvalVars): string {
  const { missionTitle, roadmapJson, contextBlock } = vars;

  const contextSection = contextBlock
    ? `\n\nProject context:\n${contextBlock}`
    : "";

  return `Evaluate this roadmap for mission "${missionTitle}".
${contextSection}

Roadmap:
${roadmapJson}

Evaluation criteria:
1. Steps are in logical dependency order
2. Each step has a clear deliverable
3. Estimated durations are realistic
4. The roadmap adequately covers the mission scope
5. Steps are specific and actionable (not vague)

Score 0-100 (integer). Set ready_to_advance: true if score >= 75.
Respond ONLY with JSON: {"is_valid":bool,"feedback":"...","suggestions":["..."],"ready_to_advance":bool,"score":80}`.trim();
}
