import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { createChatCompletionRequestSchema } from "@/server/ai/validators/chat-schemas";

interface RouteContext {
  params: Promise<{
    conversationId: string;
  }>;
}

export async function POST(request: Request, context: RouteContext) {
  const params = await context.params;
  const json = await request.json();
  const input = createChatCompletionRequestSchema.parse({
    ...json,
    conversationId: params.conversationId,
  });
  const { chatService } = getAiContainer();
  const result = await chatService.createCompletion(input);

  return NextResponse.json(result, { status: 201 });
}
