import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";

interface RouteContext {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function GET(_request: Request, context: RouteContext) {
  const params = await context.params;
  const { conversationRepository } = getAiContainer();
  const conversation = await conversationRepository.getConversation(
    params.conversationId,
  );

  if (!conversation) {
    return NextResponse.json(
      {
        error: {
          code: "CONVERSATION_NOT_FOUND",
          message: `Conversation ${params.conversationId} was not found.`,
        },
      },
      { status: 404 },
    );
  }

  const messages = await conversationRepository.listMessages(params.conversationId);

  return NextResponse.json({
    conversation,
    messages,
  });
}
