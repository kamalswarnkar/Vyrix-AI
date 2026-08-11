/**
 * types.ts — Interview module type definitions
 */

export type InterviewStepNumber = 1 | 2 | 3 | 4 | 5 | 6;

export interface InterviewState {
  projectId:      string;
  currentStep:    InterviewStepNumber;
  completedSteps: InterviewStepNumber[];
  /** Cumulative context built from completed steps */
  priorSummary:   string;
  /** Extracted data accumulated across all steps */
  extracted: {
    projectDescription?: string;
    goals?:              string;
    understandingLevel?: string;
    outputType?:         string;
    domainKeywords?:     string[];
    timeline?:           string;
  };
  isComplete:     boolean;
  skippedStep2:   boolean;
}

export interface InterviewTurnInput {
  projectId:    string;
  userMessage:  string;
  /** Current interview state (loaded from ProjectStateManager) */
  state:        InterviewState;
}

export interface InterviewTurnResult {
  ok:           boolean;
  /** AI's response to render in the UI */
  aiMessage?:   string;
  /** Updated interview state */
  nextState?:   InterviewState;
  /** True when all 6 steps are complete */
  isComplete?:  boolean;
  /** The generated roadmap (populated when isComplete = true) */
  roadmap?:     unknown[];
  error?:       string;
}

export function initialInterviewState(projectId: string): InterviewState {
  return {
    projectId,
    currentStep:    1,
    completedSteps: [],
    priorSummary:   "",
    extracted:      {},
    isComplete:     false,
    skippedStep2:   false,
  };
}
