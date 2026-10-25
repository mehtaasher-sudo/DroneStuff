import Anthropic from "@anthropic-ai/sdk";
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import type { Feature, Polygon } from "geojson";
import { runMissionAgent } from "@/lib/agent";
import { fail } from "../_util";

export const maxDuration = 300;

const Body = z.object({
  prompt: z.string().min(1).max(4000),
  parcel: z.object({ type: z.literal("Feature"), geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))).min(1) }) }).passthrough(),
});

/** POST /api/agent {prompt, parcel} → copilot reply plus a validated waypoint plan. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 400);
  try {
    const result = await runMissionAgent(parsed.data.prompt, parsed.data.parcel as unknown as Feature<Polygon>);
    return NextResponse.json(result);
  } catch (e) {
    if (e instanceof Anthropic.AuthenticationError) return fail("Claude API credentials missing or invalid — set ANTHROPIC_API_KEY in .env", 401);
    if (e instanceof Anthropic.RateLimitError) return fail("Claude API rate limit reached — retry shortly", 429);
    if (e instanceof Anthropic.APIError) return fail(`Claude API error ${e.status}: ${e.message}`, 502);
    return fail(e);
  }
}
