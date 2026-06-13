import type { AiModelId, AiProvider } from "@/features/ai/contracts/chat";

export type AiUseCase = "research";

export interface ModelDefinition {
  id: AiModelId;
  provider: AiProvider;
  label: string;
  contextWindow: number;
  defaultTemperature: number;
  defaultMaxTokens: number;
  recommendedUseCases: AiUseCase[];
  resourceProfile: "low" | "medium" | "high";
}

export const MODEL_REGISTRY: Record<AiModelId, ModelDefinition> = {
  "llama3.2:3b-instruct": {
    id: "llama3.2:3b-instruct",
    provider: "ollama",
    label: "Llama 3.2 3B Instruct",
    contextWindow: 128_000,
    defaultTemperature: 0.15,
    defaultMaxTokens: 2_048,
    recommendedUseCases: ["research"],
    resourceProfile: "low",
  },
};

export function getModelDefinition(modelId: AiModelId): ModelDefinition {
  return MODEL_REGISTRY[modelId];
}

export function listModelDefinitions(): ModelDefinition[] {
  return Object.values(MODEL_REGISTRY);
}
