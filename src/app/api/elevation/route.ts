import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { fetchElevationFt } from "@/lib/sources";
import { fail } from "../_util";

const Body = z.object({ points: z.array(z.object({ lat: z.number(), lon: z.number() })).min(1).max(1000) });

/** POST /api/elevation {points:[{lat,lon}]} → {elevation_ft: number[]} (feet MSL). */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 400);
  try {
    return NextResponse.json({ elevation_ft: await fetchElevationFt(parsed.data.points) });
  } catch (e) {
    return fail(e);
  }
}
