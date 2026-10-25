import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { bbox as turfBbox } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { laancPrecheck } from "@/lib/laanc";
import { getLaancProvider } from "@/lib/laanc-provider";
import { fetchUasfm } from "@/lib/sources";
import type { BBox } from "@/lib/types";
import { fail } from "../_util";

const Body = z.object({
  area: z.object({ type: z.literal("Feature"), geometry: z.object({ type: z.literal("Polygon"), coordinates: z.array(z.array(z.tuple([z.number(), z.number()]))) }) }).passthrough(),
  target_alt_agl_ft: z.number().min(0).max(1000),
  start: z.string(),
  end: z.string(),
  rule: z.enum(["part107", "44809"]),
  submit: z.boolean().optional(),
  pilot: z.object({ name: z.string(), phone: z.string().optional(), certificate: z.string().optional() }).optional(),
});

/** POST /api/laanc → UASFM pre-check; with submit=true, forwards eligible requests to the configured LAANC provider. */
export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 400);
  const b = parsed.data;
  const area = b.area as unknown as Feature<Polygon>;
  try {
    const cells = await fetchUasfm(turfBbox(area) as BBox);
    const precheck = laancPrecheck(
      { area, target_alt_agl_ft: b.target_alt_agl_ft, start: new Date(b.start), end: new Date(b.end), rule: b.rule },
      cells,
    );
    if (!b.submit) return NextResponse.json({ precheck });
    const provider = getLaancProvider();
    const submission = await provider.submit({ precheck, area, start: b.start, end: b.end, pilot: b.pilot, rule: b.rule });
    return NextResponse.json({ precheck, submission });
  } catch (e) {
    return fail(e);
  }
}
