import { NextRequest, NextResponse } from "next/server";
import { fetchWeather } from "@/lib/sources";
import { fail, num } from "../_util";

/** GET /api/weather?lat&lon → nearest METAR, winds at 10/80/120 m, and planetary Kp. */
export async function GET(req: NextRequest) {
  const p = req.nextUrl.searchParams;
  try {
    const lat = num(p.get("lat"), "lat");
    const lon = num(p.get("lon"), "lon");
    return NextResponse.json(await fetchWeather(lat, lon));
  } catch (e) {
    return fail(e, 400);
  }
}
