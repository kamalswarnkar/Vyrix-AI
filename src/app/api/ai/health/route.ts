import { NextResponse } from "next/server";

import { getAiContainer } from "@/server/ai/container";

export async function GET() {
  const { aiHealthService } = getAiContainer();
  const status = await aiHealthService.getStatus();

  return NextResponse.json(status, {
    status: status.ok ? 200 : 503,
  });
}
