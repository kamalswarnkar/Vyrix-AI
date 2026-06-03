import { listModelDefinitions } from "@/server/ai/models/model-registry";
import { OllamaClient } from "@/server/ai/adapters/ollama-client";

export interface InstalledModel {
  name: string;
  size?: string;
  modifiedAt?: string;
}

export interface AiHealthStatus {
  ok: boolean;
  provider: "ollama";
  baseUrl: string;
  installedModels: InstalledModel[];
  configuredModels: string[];
  missingModels: string[];
  defaultChatModel: string;
  checkedAt: string;
  message: string;
}

export interface AiHealthServiceDependencies {
  ollamaClient: OllamaClient;
  defaultChatModel: string;
  baseUrl: string;
  now?: () => Date;
}

export class AiHealthService {
  private readonly ollamaClient: OllamaClient;
  private readonly defaultChatModel: string;
  private readonly baseUrl: string;
  private readonly now: () => Date;

  constructor(dependencies: AiHealthServiceDependencies) {
    this.ollamaClient = dependencies.ollamaClient;
    this.defaultChatModel = dependencies.defaultChatModel;
    this.baseUrl = dependencies.baseUrl;
    this.now = dependencies.now ?? (() => new Date());
  }

  async getStatus(): Promise<AiHealthStatus> {
    try {
      const installedModels = await this.ollamaClient.listModels();
      const configuredModels = listModelDefinitions().map((model) => model.id);
      const installedNames = new Set(installedModels.map((model) => model.name));
      const missingModels = configuredModels.filter(
        (modelId) => !installedNames.has(modelId),
      );

      return {
        ok: true,
        provider: "ollama",
        baseUrl: this.baseUrl,
        installedModels,
        configuredModels,
        missingModels,
        defaultChatModel: this.defaultChatModel,
        checkedAt: this.now().toISOString(),
        message:
          missingModels.length === 0
            ? "AI runtime is reachable and all configured models are installed."
            : "AI runtime is reachable, but some configured models are not installed yet.",
      };
    } catch {
      return {
        ok: false,
        provider: "ollama",
        baseUrl: this.baseUrl,
        installedModels: [],
        configuredModels: listModelDefinitions().map((model) => model.id),
        missingModels: listModelDefinitions().map((model) => model.id),
        defaultChatModel: this.defaultChatModel,
        checkedAt: this.now().toISOString(),
        message:
          "AI runtime is not reachable yet. This is expected before Ollama is installed and started.",
      };
    }
  }
}
