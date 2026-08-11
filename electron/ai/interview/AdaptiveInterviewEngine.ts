/**
 * AdaptiveInterviewEngine.ts  (M17)
 *
 * Drives the 6-step onboarding interview for new Missions.
 *
 * State machine:
 *   Step 1 → AI asks open question
 *   Step 2 → Goals clarification (SKIPPED if step 1 response was comprehensive)
 *   Step 3 → Output type
 *   Step 4 → Domain keywords
 *   Step 5 → Timeline
 *   Step 6 → Confirmation → triggers roadmap generation via AiPlanningEngine
 *
 * Rules:
 *   - Caller manages state persistence (loaded from / saved to ProjectStateManager)
 *   - Step advancement only happens if EvaluationFramework scores >= 60
 *   - Skip detection for step 2 uses the AI's skip_next_step flag
 *   - Mission is locked (interview_completed = true) after step 6 is confirmed
 *
 * Usage:
 *   const engine  = new AdaptiveInterviewEngine(promptEngine, validator, planning, evaluation);
 *   const state   = initialInterviewState(projectId);
 *   const result  = await engine.processUserTurn({ projectId, userMessage, state });
 */

import { PromptEngine }         from "../prompt/PromptEngine";
import { SchemaValidator }      from "../validation/SchemaValidator";
import { AiPlanningEngine }     from "../planning/AiPlanningEngine";
import { AiEvaluationFramework } from "../evaluation/AiEvaluationFramework";
import {
  interviewSystemPrompt,
  interviewStepPrompt,
} from "../prompt/templates/interview";
import type { InterviewStepResponse } from "../types/ai-schemas";
import type {
  InterviewTurnInput,
  InterviewTurnResult,
  InterviewState,
  InterviewStepNumber,
} from "./types";

// ─── Step goals (for evaluation) ─────────────────────────────────────────────

const STEP_GOALS: Record<number, string> = {
  1: "The user describes what they want to achieve and why",
  2: "The user clarifies concrete goals and what success looks like",
  3: "The user describes the expected output or deliverable",
  4: "The user provides domain-specific context and keywords",
  5: "The user describes timeline, deadlines, or urgency",
  6: "The user confirms the AI's summary of the mission",
};

// ─── AdaptiveInterviewEngine ─────────────────────────────────────────────────

export class AdaptiveInterviewEngine {
  constructor(
    private readonly promptEngine:  PromptEngine,
    private readonly validator:     SchemaValidator,
    private readonly planning:      AiPlanningEngine,
    private readonly evaluation:    AiEvaluationFramework,
  ) {}

  /**
   * Process one user turn in the interview state machine.
   * Returns the AI's next response and the updated state.
   */
  async processUserTurn(input: InterviewTurnInput): Promise<InterviewTurnResult> {
    const { projectId, userMessage, state } = input;

    if (state.isComplete) {
      return { ok: false, error: "Interview is already complete" };
    }

    const step = state.currentStep;

    // ── 1. Evaluate the user's response for current step ──────────────────
    if (step > 1 || userMessage.trim().length > 0) {
      const evalResult = await this.evaluation.evaluateStepCompletion({
        stepNumber:   step,
        userResponse: userMessage,
        stepGoal:     STEP_GOALS[step] ?? "Provide relevant information",
      });

      // If score is too low, ask the AI to re-prompt (don't advance)
      if (evalResult.ok && evalResult.result && !evalResult.result.ready_to_advance) {
        const rephrase = await this.promptEngine.run({
          systemPrompt: interviewSystemPrompt(),
          userMessage:  `The user's response was insufficient for step ${step}.
Feedback: ${evalResult.result.feedback}
Re-ask the question with this guidance incorporated.
User message was: "${userMessage}"`,
          taskType: "interview-step",
        });

        const rephrased = this.parseStepResponse(rephrase.text ?? "");
        return {
          ok:        rephrase.ok,
          aiMessage: rephrased?.ai_message ?? rephrase.text,
          nextState: state, // same step
          error:     rephrase.ok ? undefined : rephrase.error,
        };
      }
    }

    // ── 2. Generate the AI's response for the current step ────────────────
    const promptResult = await this.promptEngine.run({
      systemPrompt: interviewSystemPrompt(),
      userMessage:  interviewStepPrompt({
        step,
        missionTitle:    projectId, // title resolved upstream
        priorSummary:    state.priorSummary,
        lastUserMessage: userMessage,
      }),
      taskType: "interview-step",
    });

    if (!promptResult.ok || !promptResult.text) {
      return { ok: false, error: promptResult.error };
    }

    const stepResponse = this.parseStepResponse(promptResult.text);
    const aiMessage    = stepResponse?.ai_message ?? promptResult.text;

    // ── 3. Update state ───────────────────────────────────────────────────
    const nextState = this.advanceState(state, step, userMessage, stepResponse);

    // ── 4. If all steps done, generate roadmap ────────────────────────────
    if (nextState.isComplete) {
      const planResult = await this.planning.generate({
        projectId,
        contextBlock: nextState.priorSummary,
        persist:      true,
      });

      return {
        ok:         true,
        aiMessage,
        nextState,
        isComplete: true,
        roadmap:    planResult.plan?.steps ?? [],
      };
    }

    return {
      ok:        true,
      aiMessage,
      nextState,
      isComplete: false,
    };
  }

  // ── Private ───────────────────────────────────────────────────────────────

  private parseStepResponse(text: string): InterviewStepResponse | null {
    try {
      const cleaned = text.replace(/^```(?:json)?\n?/i, "").replace(/\n?```$/i, "").trim();
      return JSON.parse(cleaned) as InterviewStepResponse;
    } catch {
      return null;
    }
  }

  private advanceState(
    state:        InterviewState,
    completedStep: InterviewStepNumber,
    userMessage:  string,
    stepResponse: InterviewStepResponse | null,
  ): InterviewState {
    const next = { ...state };

    // Mark step complete
    if (!next.completedSteps.includes(completedStep)) {
      next.completedSteps = [...next.completedSteps, completedStep];
    }

    // Merge extracted data
    if (stepResponse?.extracted) {
      next.extracted = { ...next.extracted, ...stepResponse.extracted };
    }

    // Append to prior summary
    if (userMessage) {
      next.priorSummary += `\nStep ${completedStep}: ${userMessage}`;
    }

    // Detect step-2 skip
    if (completedStep === 1 && stepResponse?.skip_next_step) {
      next.skippedStep2 = true;
    }

    // Calculate next step number
    let nextStep = (completedStep + 1) as InterviewStepNumber;
    if (nextStep === 2 && next.skippedStep2) {
      nextStep = 3;
    }

    if (completedStep === 6) {
      next.isComplete  = true;
      next.currentStep = 6;
    } else {
      next.currentStep = Math.min(nextStep, 6) as InterviewStepNumber;
    }

    return next;
  }
}
