import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { toRouteErrorResponse } from "@/server/ai/http/route-error";
import { createChatCompletionRequestSchema } from "@/server/ai/validators/chat-schemas";

interface RouteContext {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  try {
    const params = await context.params;
    const json = await request.json();
    const input = createChatCompletionRequestSchema.parse({
      ...json,
      conversationId: params.conversationId,
    });
    const { chatService } = getAiContainer();
    const result = await chatService.createCompletion(input);

    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return toRouteErrorResponse(
      error,
      "MESSAGE_CREATE_FAILED",
      "Unknown message creation failure",
    );
  }
}
