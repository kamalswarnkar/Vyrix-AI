import type { AiModelId, AiProvider } from "@/features/ai/contracts/chat";

export type AiUseCase =
  | "chat"
  | "research"
  | "roadmap"
  | "analysis"
  | "lightweight-chat";

export interface ModelDefinition {
  id: AiModelId;
  provider: AiProvider;
  label: string;
  contextWindow: number;
  defaultTemperature: number;
  defaultMaxTokens: number;
  recommendedUseCases: AiUseCase[];
  resourceProfile: "low" | "medium" | "high";
  fallbackModelId?: AiModelId;
}

export const MODEL_REGISTRY: Record<AiModelId, ModelDefinition> = {
  "llama3:8b-instruct": {
    id: "llama3:8b-instruct",
    provider: "ollama",
    label: "Llama 3 8B Instruct",
    contextWindow: 8_192,
    defaultTemperature: 0.2,
    defaultMaxTokens: 512,
    recommendedUseCases: ["chat", "research", "analysis"],
    resourceProfile: "medium",
    fallbackModelId: "llama3.2:3b-instruct",
  },
  "llama3.1:8b-instruct": {
    id: "llama3.1:8b-instruct",
    provider: "ollama",
    label: "Llama 3.1 8B Instruct",
    contextWindow: 128_000,
    defaultTemperature: 0.2,
    defaultMaxTokens: 640,
    recommendedUseCases: ["chat", "research", "roadmap", "analysis"],
    resourceProfile: "medium",
    fallbackModelId: "llama3:8b-instruct",
  },
  "llama3.2:3b-instruct": {
    id: "llama3.2:3b-instruct",
    provider: "ollama",
    label: "Llama 3.2 3B Instruct",
    contextWindow: 128_000,
    defaultTemperature: 0.2,
    defaultMaxTokens: 256,
    recommendedUseCases: ["chat", "lightweight-chat"],
    resourceProfile: "low",
    fallbackModelId: "llama3:8b-instruct",
  },
  "qwen2.5:7b-instruct": {
    id: "qwen2.5:7b-instruct",
    provider: "ollama",
    label: "Qwen 2.5 7B Instruct",
    contextWindow: 32_768,
    defaultTemperature: 0.2,
    defaultMaxTokens: 512,
    recommendedUseCases: ["chat", "research", "roadmap", "analysis"],
    resourceProfile: "medium",
    fallbackModelId: "phi3:mini",
  },
  "qwen2.5:14b-instruct": {
    id: "qwen2.5:14b-instruct",
    provider: "ollama",
    label: "Qwen 2.5 14B Instruct",
    contextWindow: 32_768,
    defaultTemperature: 0.2,
    defaultMaxTokens: 640,
    recommendedUseCases: ["research", "roadmap", "analysis"],
    resourceProfile: "high",
    fallbackModelId: "qwen2.5:7b-instruct",
  },
  "phi3:mini": {
    id: "phi3:mini",
    provider: "ollama",
    label: "Phi-3 Mini",
    contextWindow: 8_192,
    defaultTemperature: 0.1,
    defaultMaxTokens: 128,
    recommendedUseCases: ["chat", "lightweight-chat"],
    resourceProfile: "low",
    fallbackModelId: "phi3:medium",
  },
  "phi3:medium": {
    id: "phi3:medium",
    provider: "ollama",
    label: "Phi-3 Medium",
    contextWindow: 16_384,
    defaultTemperature: 0.1,
    defaultMaxTokens: 192,
    recommendedUseCases: ["chat", "lightweight-chat"],
    resourceProfile: "medium",
    fallbackModelId: "phi3:mini",
  },
};

export function getModelDefinition(modelId: AiModelId): ModelDefinition {
  return MODEL_REGISTRY[modelId];
}

export function listModelDefinitions(): ModelDefinition[] {
  return Object.values(MODEL_REGISTRY);
}
