import { describe, expect, it } from "vitest";
import { assessAll, assessTraffic, parseAdsbResponse } from "@/lib/adsb";

const drone = { lat: 40, lon: -75, alt_agl_ft: 200, ground_msl_ft: 100 };
// 1 NM = 1/60 degree of latitude.
const nm = (n: number) => n / 60;

describe("ADS-B", () => {
  it("parses readsb JSON including ground aircraft", () => {
    const ac = parseAdsbResponse({ ac: [
      { hex: "a1", flight: "N123  ", lat: 40.01, lon: -75, alt_baro: 1000, gs: 100, track: 180, baro_rate: -500 },
      { hex: "a2", lat: 40.02, lon: -75, alt_baro: "ground" },
      { hex: "a3" },
    ] });
    expect(ac).toHaveLength(2);
    expect(ac[0]).toMatchObject({ callsign: "N123", alt_baro_ft: 1000, vert_rate_fpm: -500 });
    expect(ac[1].onGround).toBe(true);
  });
  it("warning: within 1.25 NM, low and converging", () => {
    const [a] = parseAdsbResponse({ ac: [{ hex: "h", lat: 40 + nm(1), lon: -75, alt_baro: 800, gs: 90, track: 180 }] });
    const r = assessTraffic(a, drone);
    expect(r.distance_nm).toBeCloseTo(1, 1);
    expect(r.alt_agl_ft).toBe(700);
    expect(r.alt_delta_ft).toBe(500);
    expect(r.converging).toBe(true);
    expect(r.level).toBe("warning");
  });
  it("caution when diverging inside 1.25 NM or within 3 NM", () => {
    const ac = parseAdsbResponse({ ac: [
      { hex: "d", lat: 40 + nm(1), lon: -75, alt_baro: 800, gs: 90, track: 0 },
      { hex: "c", lat: 40 + nm(2.5), lon: -75, alt_baro: 800, gs: 90, track: 180 },
    ] });
    expect(ac.map((a) => assessTraffic(a, drone).level)).toEqual(["caution", "caution"]);
  });
  it("ignores high and distant traffic", () => {
    const ac = parseAdsbResponse({ ac: [
      { hex: "hi", lat: 40 + nm(0.5), lon: -75, alt_baro: 35000, gs: 450, track: 180 },
      { hex: "far", lat: 40 + nm(5), lon: -75, alt_baro: 800, gs: 90, track: 180 },
    ] });
    expect(assessAll(ac, drone).every((r) => r.level === "none")).toBe(true);
  });
});
