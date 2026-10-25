import { describe, expect, it } from "vitest";
import { parseKp, parseMetar, parseOpenMeteo, weatherFlags } from "@/lib/weather";
import { frameAt, parseDjiSrt, parseTelemetryCsv } from "@/lib/telemetry";
import { DEFAULT_CHECKLIST, fratScore, launchGate } from "@/lib/checklist";

describe("weather", () => {
  it("parses METAR JSON with ceiling and 10+ visibility", () => {
    const m = parseMetar({ icaoId: "KPNE", obsTime: 1761400000, rawOb: "KPNE ...", wdir: 270, wspd: 12, wgst: 22, visib: "10+",
      clouds: [{ cover: "FEW", base: 1500 }, { cover: "BKN", base: 3500 }, { cover: "OVC", base: 6000 }], fltCat: "VFR" });
    expect(m).toMatchObject({ station: "KPNE", wind_kt: 12, gust_kt: 22, visibility_sm: 10, visibility_plus: true, ceiling_ft_agl: 3500 });
    const flags = weatherFlags(m, null, 3);
    expect(flags.find((f) => f.text.includes("Wind"))?.level).toBe("caution");
  });
  it("flags visibility below 3 SM as no-go", () => {
    const m = parseMetar({ icaoId: "X", visib: 2, clouds: [] });
    expect(weatherFlags(m, null, null)[0].level).toBe("nogo");
  });
  it("parses both SWPC Kp formats", () => {
    expect(parseKp([["time_tag", "Kp", "a_running", "station_count"], ["2026-10-25 15:00:00.000", "2.67", "12", "8"]])).toEqual({ kp: 2.67, time: "2026-10-25 15:00:00.000" });
    expect(parseKp([{ time_tag: "2026-10-25T15:00:00", Kp: 5.33 }])?.kp).toBe(5.33);
  });
  it("picks the nearest Open-Meteo hour", () => {
    const w = parseOpenMeteo({ hourly: { time: ["2026-10-25T17:00", "2026-10-25T18:00"], wind_speed_10m: [5, 6], wind_speed_80m: [9, 10], wind_speed_120m: [11, 12] } }, new Date("2026-10-25T18:10:00Z"));
    expect(w).toMatchObject({ wind_10m_kt: 6, wind_120m_kt: 12 });
  });
});

describe("telemetry", () => {
  it("parses Airdata-style CSV in feet and ms", () => {
    const f = parseTelemetryCsv("time(millisecond),latitude,longitude,height_above_takeoff(feet),speed(mph)\n1000,40,-75,0,0\n2000,40.0001,-75,50,10\n");
    expect(f).toHaveLength(2);
    expect(f[1]).toMatchObject({ t_ms: 1000, alt_ft: 50 });
    expect(f[1].speed_ms).toBeCloseTo(4.47, 2);
    expect(frameAt(f, 500)?.alt_ft).toBeCloseTo(25);
  });
  it("parses DJI SRT bracket format", () => {
    const srt = "1\n00:00:00,000 --> 00:00:00,033\n<font size=\"28\">FrameCnt: 1 [latitude: 40.123456] [longitude: -75.654321] [rel_alt: 30.000 abs_alt: 120.000]</font>\n\n2\n00:00:01,000 --> 00:00:01,033\n[latitude: 40.123556] [longitude: -75.654321] [rel_alt: 31.000 abs_alt: 121.000]\n";
    const f = parseDjiSrt(srt);
    expect(f).toHaveLength(2);
    expect(f[0].alt_ft).toBeCloseTo(98.4, 1);
    expect(f[1].t_ms).toBe(1000);
  });
});

describe("checklist gate", () => {
  it("locks launch until all mandatory gating items are checked", () => {
    const gated = DEFAULT_CHECKLIST.filter((s) => s.gatesLaunch).flatMap((s) => s.items.filter((i) => i.mandatory));
    expect(launchGate(DEFAULT_CHECKLIST, {}).ready).toBe(false);
    const all = Object.fromEntries(gated.map((i) => [i.id, true]));
    expect(launchGate(DEFAULT_CHECKLIST, all).ready).toBe(true);
    expect(launchGate(DEFAULT_CHECKLIST, all, true).ready).toBe(false);
  });
  it("scores FRAT", () => {
    expect(fratScore({ wind: 3, airspace: 3, crowd: 3, light: 2 })).toMatchObject({ total: 11, level: "high" });
  });
});
