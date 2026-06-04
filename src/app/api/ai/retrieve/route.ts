import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";
import { retrieveDocumentRequestSchema } from "@/server/ai/validators/chat-schemas";

export async function POST(request: Request) {
  const json = await request.json();
  const input = retrieveDocumentRequestSchema.parse(json);
  const { retrievalService } = getAiContainer();
  const hits = await retrievalService.retrieve(input);

  return NextResponse.json({
    hits,
    citations: retrievalService.toCitations(hits),
    diagnostics: {
      query: input.query,
      normalizedQuery: input.query.trim().toLowerCase(),
      topKRequested: input.topK ?? 6,
      topKReturned: hits.length,
      indexesQueried: ["sqlite-keyword"],
    },
  });
}
