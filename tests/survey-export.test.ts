import { describe, expect, it } from "vitest";
import JSZip from "jszip";
import { DEFAULT_CAMERA, footprint, generateSurvey } from "@/lib/survey";
import { densifyPhotoLegs, relativeAltitudeM, toDjiKmz, toDjiWpml, toLitchiCsv, toQgcPlan } from "@/lib/exporters";

// ~300 m × 200 m rectangle near 40N.
const ring: [number, number][] = [[-75, 40], [-74.99648, 40], [-74.99648, 40.0018], [-75, 40.0018]];

describe("footprint", () => {
  it("matches the pinhole model for a P4P at 100 m", () => {
    const f = footprint(100, DEFAULT_CAMERA);
    expect(f.across_m).toBeCloseTo(150, 1);
    expect(f.along_m).toBeCloseTo(100, 1);
    expect(f.gsd_cm_px).toBeCloseTo(2.74, 2);
  });
});

describe("generateSurvey", () => {
  const base = { ring, alt_agl_ft: 250, front_overlap: 0.75, side_overlap: 0.75, gimbal_pitch: -90, line_angle_deg: 90 };
  it("lawnmower lines are spaced by footprint × (1 - side overlap)", () => {
    const r = generateSurvey({ ...base, pattern: "lawnmower" });
    // 250 ft = 76.2 m → across 114.3 m → spacing 28.6 m; 200.2 m tall / 28.6 m → ceil(7.004) = 8 lines
    expect(r.stats.line_spacing_m).toBeCloseTo(28.6, 1);
    expect(r.stats.lines).toBe(8);
    expect(r.waypoints).toHaveLength(16);
    expect(r.waypoints.every((w) => w.alt_agl === 250 && w.gimbal_pitch === -90)).toBe(true);
    // boustrophedon: alternating east/west headings
    expect(r.waypoints[0].heading).toBe(90);
    expect(r.waypoints[2].heading).toBe(270);
    // all points inside the bounding box
    for (const w of r.waypoints) {
      expect(w.lon).toBeGreaterThanOrEqual(-75.00001);
      expect(w.lon).toBeLessThanOrEqual(-74.99647);
      expect(w.lat).toBeGreaterThanOrEqual(39.99999);
      expect(w.lat).toBeLessThanOrEqual(40.00181);
    }
  });
  it("crosshatch adds a perpendicular pass", () => {
    const r = generateSurvey({ ...base, pattern: "crosshatch" });
    expect(r.stats.lines).toBe(8 + 11);
    expect(new Set(r.waypoints.map((w) => w.heading))).toEqual(new Set([90, 270, 0, 180]));
  });
});

describe("exporters", () => {
  const { waypoints, stats } = generateSurvey({ ring, alt_agl_ft: 200, front_overlap: 0.7, side_overlap: 0.7, gimbal_pitch: -80, line_angle_deg: 90, pattern: "lawnmower" });

  it("terrain-compensated relative altitude keeps AGL constant", () => {
    expect(relativeAltitudeM({ ...waypoints[0], terrain_msl: 150 }, 100)).toBeCloseTo((200 + 50) / 3.28084, 2);
    expect(relativeAltitudeM(waypoints[0])).toBeCloseTo(200 / 3.28084, 2);
  });
  it("Litchi CSV has 46 columns (8 + 15 action pairs + 8) per row", () => {
    const csv = toLitchiCsv(waypoints, { photo_interval_m: stats.photo_interval_m }).trim().split("\n");
    expect(csv[0].split(",")).toHaveLength(46);
    expect(csv.slice(1).every((r) => r.split(",").length === 46)).toBe(true);
    const first = csv[1].split(",");
    expect(first[8]).toBe("1"); // actiontype1 = take photo
    expect(Number(first[45])).toBeCloseTo(stats.photo_interval_m, 1);
  });
  it("QGC plan uses takeoff, waypoints, camera trigger and RTL", () => {
    const plan = toQgcPlan(waypoints, { photo_interval_m: stats.photo_interval_m });
    const cmds = plan.mission.items.map((i) => i.command as number);
    expect(cmds[0]).toBe(22);
    expect(cmds.at(-1)).toBe(20);
    expect(cmds.filter((c) => c === 16)).toHaveLength(waypoints.length);
    expect(cmds).toContain(206);
    expect(plan.mission.items.map((i) => i.doJumpId)).toEqual(plan.mission.items.map((_, k) => k + 1));
  });
  it("DJI WPML densifies photo legs and zips into wpmz/", async () => {
    const dense = densifyPhotoLegs(waypoints, stats.photo_interval_m);
    expect(dense.length).toBeGreaterThan(waypoints.length);
    const { waylines, template } = toDjiWpml(waypoints, { photo_interval_m: stats.photo_interval_m });
    expect((waylines.match(/<Placemark>/g) ?? []).length).toBe(dense.length);
    expect(waylines).toContain("<wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>");
    expect(template).toContain("<wpml:templateType>waypoint</wpml:templateType>");
    const zip = await JSZip.loadAsync(await (await toDjiKmz(waypoints)).arrayBuffer());
    expect(Object.keys(zip.files).sort()).toEqual(["wpmz/", "wpmz/template.kml", "wpmz/waylines.wpml"]);
  });
});
