import { booleanIntersects, booleanPointInPolygon, point } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import * as SunCalc from "suncalc";
import type { UasfmCell, UasfmCollection, Waypoint } from "./types";

/** Part 107.51(b) altitude limit for a sUAS, feet AGL (absent a structure exception). */
export const PART_107_MAX_AGL_FT = 400;

export interface WaypointCheck {
  index: number;
  /** UASFM ceiling for the containing grid cell (ft AGL), or null when the point lies outside every cell. */
  ceiling_ft: number | null;
  /** The limit applied: the cell ceiling, or the 400 ft Part 107 limit outside the UASFM grid. */
  limit_ft: number;
  violation: boolean;
  message: string;
}

/** Returns the UASFM cell containing the point, preferring the lowest ceiling where cells overlap. */
export function cellAt(lon: number, lat: number, cells: UasfmCollection): UasfmCell | null {
  const pt = point([lon, lat]);
  let best: UasfmCell | null = null;
  for (const cell of cells.features) {
    if (!cell.geometry) continue;
    if (booleanPointInPolygon(pt, cell)) {
      if (!best || cell.properties.CEILING < best.properties.CEILING) best = cell;
    }
  }
  return best;
}

/** Validates each waypoint's AGL altitude against the FAA UASFM ceiling of the grid cell beneath it. */
export function validateWaypoints(waypoints: Waypoint[], cells: UasfmCollection): WaypointCheck[] {
  return waypoints.map((wp, index) => {
    const cell = cellAt(wp.lon, wp.lat, cells);
    const ceiling = cell ? Number(cell.properties.CEILING) : null;
    const limit = Math.min(ceiling ?? PART_107_MAX_AGL_FT, PART_107_MAX_AGL_FT);
    const violation = wp.alt_agl > limit;
    let message: string;
    if (ceiling === null) {
      message = violation
        ? `${wp.alt_agl} ft AGL exceeds the Part 107 ${PART_107_MAX_AGL_FT} ft AGL limit`
        : "Outside UASFM grid (no LAANC ceiling published here); verify airspace class";
    } else if (violation) {
      const apt = cell?.properties.APT1_FAAID ? ` (${cell.properties.APT1_FAAID})` : "";
      message = `LAANC violation: ${wp.alt_agl} ft AGL > ${ceiling} ft UASFM ceiling${apt}`;
    } else {
      message = `Within ${ceiling} ft AGL UASFM ceiling`;
    }
    return { index, ceiling_ft: ceiling, limit_ft: limit, violation, message };
  });
}

export type LaancStatus = "auto_approval" | "further_coordination" | "no_laanc_grid" | "not_eligible";

export interface LaancPrecheck {
  status: LaancStatus;
  headline: string;
  min_ceiling_ft: number | null;
  max_ceiling_ft: number | null;
  intersecting_cells: number;
  airports: string[];
  target_alt_agl_ft: number;
  daylight: boolean;
  civil_twilight: boolean;
  notes: string[];
}

export interface PrecheckInput {
  area: Feature<Polygon>;
  target_alt_agl_ft: number;
  start: Date;
  end: Date;
  /** "part107" (commercial/recreational-with-cert) or "44809" (recreational exception). */
  rule: "part107" | "44809";
}

/** True when the whole interval lies between sunrise and sunset at the given point. */
export function isDaylight(lat: number, lon: number, start: Date, end: Date) {
  const times = SunCalc.getTimes(start, lat, lon);
  // SunCalc returns null/invalid times during polar day/night; treat those as not-daylight.
  const within = (a: Date | null, b: Date | null) => !!a && !!b && start >= a && end <= b;
  const daylight = within(times.sunrise, times.sunset);
  const civil = within(times.dawn, times.dusk);
  return { daylight, civil, sunrise: times.sunrise, sunset: times.sunset, dawn: times.dawn, dusk: times.dusk };
}

/**
 * Intersects the mission polygon with UASFM cells and classifies the request:
 * target <= min(ceiling) → eligible for instant LAANC auto-approval,
 * target >  min(ceiling) → further coordination required.
 */
export function laancPrecheck(input: PrecheckInput, cells: UasfmCollection): LaancPrecheck {
  const { area, target_alt_agl_ft, start, end, rule } = input;
  const hits = cells.features.filter((c) => c.geometry && booleanIntersects(area, c));
  const ceilings = hits.map((c) => Number(c.properties.CEILING));
  const airports = [...new Set(hits.map((c) => c.properties.APT1_FAAID).filter(Boolean) as string[])];
  const min = ceilings.length ? Math.min(...ceilings) : null;
  const max = ceilings.length ? Math.max(...ceilings) : null;

  const ring = area.geometry.coordinates[0];
  const [clon, clat] = ring.reduce(([a, b], [x, y]) => [a + x / ring.length, b + y / ring.length], [0, 0]);
  const sun = isDaylight(clat, clon, start, end);
  const notes: string[] = [];

  if (end <= start) notes.push("End time must be after start time.");
  if (!sun.daylight) {
    if (rule === "44809") {
      notes.push("Night operation: recreational flyers need anti-collision lighting visible for 3 statute miles.");
    } else {
      notes.push(
        "Night or twilight operation: Part 107.29 requires completed night training/testing and anti-collision lighting visible for 3 statute miles.",
      );
    }
  }
  if (rule === "44809") {
    notes.push("Recreational (44809) LAANC requests are capped at the grid ceiling and cannot use further coordination.");
  }
  notes.push("Check active TFRs and NOTAMs before flight; UASFM ceilings do not reflect temporary restrictions.");

  const base = {
    min_ceiling_ft: min,
    max_ceiling_ft: max,
    intersecting_cells: hits.length,
    airports,
    target_alt_agl_ft,
    daylight: sun.daylight,
    civil_twilight: sun.civil,
    notes,
  };

  if (target_alt_agl_ft > PART_107_MAX_AGL_FT) {
    return {
      ...base,
      status: "not_eligible",
      headline: `Target ${target_alt_agl_ft} ft AGL exceeds the ${PART_107_MAX_AGL_FT} ft AGL limit — requires a Part 107 waiver`,
    };
  }
  if (min === null) {
    return {
      ...base,
      status: "no_laanc_grid",
      headline: "Area is outside the UASFM grid — no LAANC ceiling published; verify the airspace class (Class G needs no authorization)",
    };
  }
  if (target_alt_agl_ft <= min) {
    return { ...base, status: "auto_approval", headline: `Eligible for Instant LAANC Auto-Approval (≤ ${min} ft AGL)` };
  }
  if (rule === "44809") {
    return {
      ...base,
      status: "not_eligible",
      headline: `Target exceeds ${min} ft AGL grid ceiling — not available to recreational flyers; lower altitude to ${min} ft`,
    };
  }
  return {
    ...base,
    status: "further_coordination",
    headline: `Further Coordination Required — target ${target_alt_agl_ft} ft AGL > ${min} ft AGL grid ceiling (submit at least 72 h ahead)`,
  };
}
