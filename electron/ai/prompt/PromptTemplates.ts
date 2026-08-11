/**
 * PromptTemplates.ts  (M10)
 *
 * Central registry and facade for all prompt templates.
 * Consumers import this class instead of individual template files.
 *
 * Usage:
 *   const pt = new PromptTemplates();
 *   const sys = pt.chat.systemPrompt({ contextBlock, projectTitle });
 *   const usr = pt.interview.stepPrompt({ step: 1, missionTitle: "Build a SaaS" });
 */

export {
  interviewSystemPrompt,
  interviewStepPrompt,
  interviewSkipEvalPrompt,
} from "./templates/interview";

export type {
  InterviewTemplateVars,
} from "./templates/interview";

export {
  chatSystemPrompt,
  suggestionChipPrompt,
  contextPrimerPrompt,
} from "./templates/chat";

export type {
  ChatSystemPromptVars,
  SuggestionChipVars,
} from "./templates/chat";

export {
  memoryDistillationSystemPrompt,
  memoryExtractionPrompt,
  keywordExtractionSystemPrompt,
  keywordExtractionPrompt,
} from "./templates/memory";

export type {
  MemoryExtractionVars,
  KeywordExtractionVars,
} from "./templates/memory";

export {
  planningSystemPrompt,
  planGenerationPrompt,
  roadmapRefinementPrompt,
  contextResolvePrompt,
} from "./templates/planning";

export type {
  PlanGenerationVars,
  RoadmapRefinementVars,
  ContextResolveVars,
} from "./templates/planning";

export {
  evaluationSystemPrompt,
  evaluationPrompt,
  stepCompletionEvalPrompt,
  roadmapEvalPrompt,
} from "./templates/evaluation";

export type {
  EvaluationVars,
  StepCompletionEvalVars,
  RoadmapEvalVars,
} from "./templates/evaluation";

// ─── Convenience namespace class ──────────────────────────────────────────────

import * as interview  from "./templates/interview";
import * as chat       from "./templates/chat";
import * as memory     from "./templates/memory";
import * as planning   from "./templates/planning";
import * as evaluation from "./templates/evaluation";

/**
 * Namespace facade that groups all template modules.
 * Useful when you prefer method-call style over direct imports.
 */
export class PromptTemplates {
  readonly interview  = interview;
  readonly chat       = chat;
  readonly memory     = memory;
  readonly planning   = planning;
  readonly evaluation = evaluation;
}
