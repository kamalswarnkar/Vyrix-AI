/**
 * templates/interview.ts
 *
 * System and user prompt templates for the 6-step Adaptive Interview Engine.
 *
 * Step overview:
 *   1. Open question  — mission intent, goals, constraints
 *   2. Goals clarify  — (can be SKIPPED if step 1 captured goals + understanding)
 *   3. Output type    — what kind of deliverable / output is expected
 *   4. Domain context — technical / business domain keywords
 *   5. Timeline       — urgency, milestones, deadlines
 *   6. Confirmation   — AI summarises and asks user to confirm before locking mission
 */

export interface InterviewTemplateVars {
  /** Current step number (1-6) */
  step:         number;
  /** Mission title set by the user */
  missionTitle: string;
  /** Cumulative summary of what we know so far (for step 2+) */
  priorSummary?: string;
  /** User's previous response text (for step 2+) */
  lastUserMessage?: string;
  /** JSON Schema or GBNF grammar hint to embed in prompt */
  outputSchemaHint?: string;
}

// ─── System prompt (invariant across steps) ───────────────────────────────────

export function interviewSystemPrompt(): string {
  return `You are Vyrix, an expert AI strategic planning partner.
Your task is to conduct a structured onboarding interview to understand the user's mission deeply.

RULES:
- Ask ONE focused question per turn.
- Be warm, specific, and professional.
- Extract and surface concrete keywords, goals, and decisions.
- Never break character. Never explain that you are an AI.
- Respond ONLY with a valid JSON object. No text outside the JSON.

REQUIRED OUTPUT SHAPE:
{
  "step_number": <integer 1-6>,
  "ai_message": "<your question or message to the user>",
  "skip_next_step": <true if next step can be skipped, else false>,
  "extracted": {
    "project_description": "<optional: what user described>",
    "goals": "<optional: user goals>",
    "understanding_level": "<optional: beginner|intermediate|advanced>",
    "output_type": "<optional: prototype|3d_model|ideation|software|mixed>",
    "domain_keywords": ["<optional array of domain terms>"]
  }
}`.trim();
}

// ─── Per-step user prompt generators ─────────────────────────────────────────

export function interviewStepPrompt(vars: InterviewTemplateVars): string {
  const { step, missionTitle, priorSummary = "", lastUserMessage = "" } = vars;

  const context = priorSummary
    ? `\nContext from previous steps:\n${priorSummary}`
    : "";

  const userReply = lastUserMessage
    ? `\nUser's last message:\n"${lastUserMessage}"`
    : "";

  switch (step) {
    case 1:
      return `The user has created a new mission titled: "${missionTitle}".
${context}
Step 1 of 6: Ask an open-ended question to understand what the user wants to achieve, why it matters to them, and any constraints or success criteria they have in mind.

Respond with valid JSON matching the InterviewStepResponse schema.`.trim();

    case 2:
      return `${context}${userReply}

Step 2 of 6: Based on what the user shared, probe deeper into their goals and what "success" looks like concretely. If the user already provided clear goals and demonstrated understanding in step 1, set skip_next_step: true.

Respond with valid JSON matching the InterviewStepResponse schema.`.trim();

    case 3:
      return `${context}${userReply}

Step 3 of 6: Ask about the expected output or deliverable. Is it a product, a document, a service, a strategy, or something else? This will shape how Vyrix structures the roadmap.

Respond with valid JSON matching the InterviewStepResponse schema.`.trim();

    case 4:
      return `${context}${userReply}

Step 4 of 6: Ask about domain-specific context — the technical stack, business sector, audience, tools, or constraints that are relevant to this mission. Extract up to 10 domain keywords.

Respond with valid JSON matching the InterviewStepResponse schema.`.trim();

    case 5:
      return `${context}${userReply}

Step 5 of 6: Ask about timeline — is there a hard deadline, milestones, or a sense of urgency? What is the expected pace of work?

Respond with valid JSON matching the InterviewStepResponse schema.`.trim();

    case 6:
      return `${context}${userReply}

Step 6 of 6 (Final Confirmation): Summarize everything you have learned about this mission in your ai_message. Ask the user to confirm that your understanding is correct before we lock in the mission roadmap. Set ready_to_advance: true in the evaluation if the user confirms or if the summary is already accurate.

Respond with valid JSON matching the InterviewStepResponse schema.`.trim();

    default:
      throw new RangeError(`Interview step must be 1-6, got ${step}`);
  }
}

// ─── Step-skip evaluation prompt ─────────────────────────────────────────────

export function interviewSkipEvalPrompt(vars: Pick<InterviewTemplateVars, "lastUserMessage" | "priorSummary">): string {
  const { lastUserMessage = "", priorSummary = "" } = vars;
  return `You are evaluating whether the user's response is comprehensive enough to skip the goals-clarification step.

Prior summary: ${priorSummary}
User message: "${lastUserMessage}"

Does the user's message contain BOTH (a) clear goals AND (b) evidence they understand the domain?
Respond with valid JSON matching the InterviewStepResponse schema. Set skip_next_step: true only if both conditions are met.`.trim();
}
