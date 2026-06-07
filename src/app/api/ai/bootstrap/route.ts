import { NextResponse } from "next/server";

import { getAiConfig } from "@/server/ai/config/ai-config";
import { getAiContainer } from "@/server/ai/container";
import { listModelDefinitions } from "@/server/ai/models/model-registry";

export async function GET() {
  const config = getAiConfig();
  const { aiHealthService } = getAiContainer();
  const health = await aiHealthService.getStatus();
  const modelDefinitions = listModelDefinitions();
  const installedModelIds = new Set(health.installedModels.map((model) => model.name));
  const preferredChatModel =
    modelDefinitions.find((model) => installedModelIds.has(model.id))?.id ??
    config.defaultChatModel;

  return NextResponse.json({
    defaultChatModel: config.defaultChatModel,
    preferredChatModel,
    installedModelIds: [...installedModelIds],
    historyMessageLimit: config.chatHistoryMessageLimit,
    provider: "ollama",
    models: modelDefinitions.map((model) => ({
      ...model,
      installed: installedModelIds.has(model.id),
    })),
    health,
  });
}
