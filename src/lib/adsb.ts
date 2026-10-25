import { bearing, distance, point } from "@turf/turf";
import type { Aircraft, AlertLevel, TrafficAssessment } from "./types";

export const CAUTION_RADIUS_NM = 3;
export const WARNING_RADIUS_NM = 1.25;
export const LOW_ALTITUDE_AGL_FT = 1500;

/** Normalizes one aircraft record from the readsb-style JSON served by adsb.lol / ADS-B Exchange v2. */
export function normalizeAircraft(raw: Record<string, unknown>): Aircraft | null {
  const lat = typeof raw.lat === "number" ? raw.lat : null;
  const lon = typeof raw.lon === "number" ? raw.lon : null;
  if (lat === null || lon === null) return null;
  const altBaro = raw.alt_baro;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  return {
    hex: String(raw.hex ?? ""),
    callsign: typeof raw.flight === "string" ? raw.flight.trim() || null : null,
    lat,
    lon,
    alt_baro_ft: num(altBaro),
    alt_geom_ft: num(raw.alt_geom),
    onGround: altBaro === "ground",
    gs_kt: num(raw.gs),
    track: num(raw.track),
    vert_rate_fpm: num(raw.baro_rate) ?? num(raw.geom_rate),
    category: typeof raw.category === "string" ? raw.category : null,
    type: typeof raw.t === "string" ? raw.t : null,
  };
}

export function parseAdsbResponse(body: unknown): Aircraft[] {
  const list = (body as { ac?: unknown[]; aircraft?: unknown[] })?.ac ?? (body as { aircraft?: unknown[] })?.aircraft ?? [];
  return list.map((r) => normalizeAircraft(r as Record<string, unknown>)).filter((a): a is Aircraft => a !== null);
}

export interface DroneState {
  lat: number;
  lon: number;
  /** Drone altitude in feet AGL. */
  alt_agl_ft: number;
  /** Ground elevation at the drone in feet MSL; used to convert aircraft MSL altitude to AGL. */
  ground_msl_ft: number;
}

/**
 * Assesses one aircraft relative to the drone.
 * Caution: within 3 NM horizontally and below 1,500 ft AGL.
 * Warning: within 1.25 NM, below 1,500 ft AGL and on a converging vector (positive closing speed).
 */
export function assessTraffic(ac: Aircraft, drone: DroneState): TrafficAssessment {
  const from = point([ac.lon, ac.lat]);
  const to = point([drone.lon, drone.lat]);
  const distance_nm = distance(from, to, { units: "nauticalmiles" });
  const altMsl = ac.onGround ? drone.ground_msl_ft : (ac.alt_geom_ft ?? ac.alt_baro_ft);
  const alt_agl_ft = altMsl === null ? null : Math.round(altMsl - drone.ground_msl_ft);
  const alt_delta_ft = alt_agl_ft === null ? null : alt_agl_ft - drone.alt_agl_ft;

  let closing_kt: number | null = null;
  if (ac.gs_kt !== null && ac.track !== null) {
    if (distance_nm < 1e-6) closing_kt = ac.gs_kt;
    else {
      const brgToDrone = bearing(from, to);
      closing_kt = ac.gs_kt * Math.cos(((ac.track - brgToDrone) * Math.PI) / 180);
    }
  }
  const converging = closing_kt !== null && closing_kt > 0;
  // Unknown altitude is treated as low: an aircraft without an altitude report is not assumed safe.
  const low = !ac.onGround && (alt_agl_ft === null || alt_agl_ft < LOW_ALTITUDE_AGL_FT);

  let level: AlertLevel = "none";
  if (low && distance_nm <= WARNING_RADIUS_NM && converging) level = "warning";
  else if (low && distance_nm <= CAUTION_RADIUS_NM) level = "caution";

  return { aircraft: ac, distance_nm, alt_agl_ft, alt_delta_ft, closing_kt, converging, level };
}

export function assessAll(aircraft: Aircraft[], drone: DroneState): TrafficAssessment[] {
  const rank = { warning: 0, caution: 1, none: 2 } as const;
  return aircraft
    .map((a) => assessTraffic(a, drone))
    .sort((a, b) => rank[a.level] - rank[b.level] || a.distance_nm - b.distance_nm);
}
