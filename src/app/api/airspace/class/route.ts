import { NextRequest, NextResponse } from "next/server";
import { arcgisBBox, parseBBox, SOURCES } from "@/lib/sources";
import { fail } from "../../_util";

/** GET /api/airspace/class?bbox=w,s,e,n → FAA Class B/C/D/E airspace polygons as GeoJSON. */
export async function GET(req: NextRequest) {
  let bbox;
  try {
    bbox = parseBBox(req.nextUrl.searchParams.get("bbox"));
  } catch (e) {
    return fail(e, 400);
  }
  try {
    return NextResponse.json(await arcgisBBox(SOURCES.classAirspace, bbox));
  } catch (e) {
    return fail(e);
  }
}
