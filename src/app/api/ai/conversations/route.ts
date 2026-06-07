import { NextResponse } from "next/server";
import { nanoid } from "nanoid";

import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";
import { createConversationRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function GET(request: Request) {
  const { searchParams } = new URL(request.url);
  const projectId = searchParams.get("projectId");

  if (!projectId) {
    return NextResponse.json(
      {
        error: {
          code: "PROJECT_ID_REQUIRED",
          message: "projectId is required to list project conversations.",
        },
      },
      { status: 400 },
    );
  }

  const { conversationRepository } = getAiContainer();
  const conversations = await conversationRepository.listConversationsByProject(
    projectId,
  );

  return NextResponse.json({ conversations });
}

export async function POST(request: Request) {
  try {
    const json = await request.json();
    const input = createConversationRequestSchema.parse(json);
    const { conversationRepository } = getAiContainer();
    const title = input.title?.trim() || "New Conversation";
    const conversation = await conversationRepository.createConversation({
      id: nanoid(),
      projectId: input.projectId,
      workspaceId: input.workspaceId,
      title,
      scope: input.scope,
      model: input.model,
    });

    return NextResponse.json({ conversation }, { status: 201 });
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "CONVERSATION_CREATE_FAILED",
      "Unknown conversation creation failure",
    );
  }
}
