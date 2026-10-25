import { NextRequest, NextResponse } from "next/server";
import { fetchTraffic } from "@/lib/sources";
import { fail, num } from "../_util";

/** GET /api/adsb?lat&lon&radius=15 → normalized aircraft list (adsb.lol, or ADS-B Exchange when ADSBX_API_KEY is set). */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  let lat, lon;
  try {
    lat = num(p.get("lat"), "lat");
    lon = num(p.get("lon"), "lon");
  } catch (e) {
    return fail(e, 400);
  }
  try {
    const radius = Number(p.get("radius") ?? 15) || 15;
    const data = await fetchTraffic(lat, lon, radius);
    return NextResponse.json({ ...data, fetchedAt: new Date().toISOString() });
  } catch (e) {
    return fail(e);
  }
}
