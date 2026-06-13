import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";

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

export async function DELETE(_request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const { conversationRepository } = getAiContainer();
    const deleted = await conversationRepository.deleteConversation(params.conversationId);

    if (!deleted) {
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

    return NextResponse.json({ ok: true });
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "CONVERSATION_DELETE_FAILED",
      "Unknown conversation deletion failure",
    );
  }
}
