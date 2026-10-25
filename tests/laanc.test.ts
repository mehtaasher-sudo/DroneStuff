import { describe, expect, it } from "vitest";
import { laancPrecheck, validateWaypoints } from "@/lib/laanc";
import type { UasfmCollection, Waypoint } from "@/lib/types";
import type { Feature, Polygon } from "geojson";

// Two adjacent 30-arc-second cells: west ceiling 200 ft, east ceiling 100 ft.
const cell = (w: number, ceiling: number) => ({
  type: "Feature" as const,
  properties: { CEILING: ceiling, APT1_FAAID: "TST" },
  geometry: { type: "Polygon" as const, coordinates: [[[w, 40], [w + 1 / 120, 40], [w + 1 / 120, 40 + 1 / 120], [w, 40 + 1 / 120], [w, 40]]] },
});
const cells: UasfmCollection = { type: "FeatureCollection", features: [cell(-75, 200), cell(-75 + 1 / 120, 100)] };
const wp = (lon: number, alt: number): Waypoint => ({ lat: 40.004, lon, alt_agl: alt, speed: 5, heading: 0, gimbal_pitch: -90, action: "none" });

describe("validateWaypoints", () => {
  it("flags waypoints above the containing cell ceiling", () => {
    const r = validateWaypoints([wp(-74.996, 150), wp(-74.988, 150), wp(-74.988, 100)], cells);
    expect(r.map((c) => c.ceiling_ft)).toEqual([200, 100, 100]);
    expect(r.map((c) => c.violation)).toEqual([false, true, false]);
    expect(r[1].message).toContain("LAANC violation");
  });
  it("applies the 400 ft Part 107 limit outside the grid", () => {
    const r = validateWaypoints([wp(-70, 390), wp(-70, 410)], cells);
    expect(r[0]).toMatchObject({ ceiling_ft: null, violation: false });
    expect(r[1]).toMatchObject({ ceiling_ft: null, violation: true, limit_ft: 400 });
  });
});

describe("laancPrecheck", () => {
  const area: Feature<Polygon> = {
    type: "Feature", properties: {},
    geometry: { type: "Polygon", coordinates: [[[-74.997, 40.002], [-74.989, 40.002], [-74.989, 40.006], [-74.997, 40.006], [-74.997, 40.002]]] },
  };
  // Noon local (UTC-4/5) in mid-June → daylight.
  const start = new Date("2026-06-15T16:00:00Z");
  const end = new Date("2026-06-15T17:00:00Z");
  it("auto-approval when target <= min ceiling", () => {
    const r = laancPrecheck({ area, target_alt_agl_ft: 100, start, end, rule: "part107" }, cells);
    expect(r).toMatchObject({ status: "auto_approval", min_ceiling_ft: 100, max_ceiling_ft: 200, intersecting_cells: 2, daylight: true });
  });
  it("further coordination when target > min ceiling", () => {
    const r = laancPrecheck({ area, target_alt_agl_ft: 150, start, end, rule: "part107" }, cells);
    expect(r.status).toBe("further_coordination");
  });
  it("recreational flyers cannot exceed grid", () => {
    expect(laancPrecheck({ area, target_alt_agl_ft: 150, start, end, rule: "44809" }, cells).status).toBe("not_eligible");
  });
  it("detects night operations", () => {
    const r = laancPrecheck({ area, target_alt_agl_ft: 100, start: new Date("2026-06-15T05:00:00Z"), end: new Date("2026-06-15T06:00:00Z"), rule: "part107" }, cells);
    expect(r.daylight).toBe(false);
    expect(r.notes.join(" ")).toContain("107.29");
  });
  it("no grid outside cells", () => {
    const far: Feature<Polygon> = { ...area, geometry: { type: "Polygon", coordinates: [[[-70, 40], [-69.99, 40], [-69.99, 40.01], [-70, 40]]] } };
    expect(laancPrecheck({ area: far, target_alt_agl_ft: 100, start, end, rule: "part107" }, cells).status).toBe("no_laanc_grid");
  });
});
