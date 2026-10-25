import { NextRequest, NextResponse } from "next/server";
import { fetchUasfm, parseBBox } from "@/lib/sources";
import { fail } from "../../_util";

/** GET /api/airspace/uasfm?bbox=w,s,e,n → FAA UAS Facility Map grid cells (CEILING in ft AGL) as GeoJSON. */
export async function GET(req: NextRequest) {
  let bbox;
  try {
    bbox = parseBBox(req.nextUrl.searchParams.get("bbox"));
  } catch (e) {
    return fail(e, 400);
  }
  try {
    return NextResponse.json(await fetchUasfm(bbox));
  } catch (e) {
    return fail(e);
  }
}
