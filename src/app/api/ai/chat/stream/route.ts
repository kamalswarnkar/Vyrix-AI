import { getAiContainer } from "@/server/ai/container";
import { createChatCompletionRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function POST(request: Request) {
  const json = await request.json();
  const input = createChatCompletionRequestSchema.parse(json);
  const { chatService } = getAiContainer();
  const stream = await chatService.streamCompletion(input);

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
