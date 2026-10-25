import { FT_PER_M } from "./survey";

export interface TelemetryFrame {
  /** Milliseconds since the start of the log. */
  t_ms: number;
  lat: number;
  lon: number;
  /** Feet above takeoff point (≈ AGL on flat ground). */
  alt_ft: number;
  speed_ms?: number;
  heading?: number;
}

function splitCsvLine(line: string): string[] {
  const out: string[] = [];
  let cur = "";
  let q = false;
  for (const ch of line) {
    if (ch === '"') q = !q;
    else if (ch === "," && !q) {
      out.push(cur);
      cur = "";
    } else cur += ch;
  }
  out.push(cur);
  return out.map((s) => s.trim());
}

/** Parses a flight-log CSV (Airdata exports and generic lat/lon/alt/time CSVs). */
export function parseTelemetryCsv(text: string): TelemetryFrame[] {
  const lines = text.split(/\r?\n/).filter((l) => l.trim());
  if (lines.length < 2) return [];
  const header = splitCsvLine(lines[0]).map((h) => h.toLowerCase());
  const find = (...pats: RegExp[]) => header.findIndex((h) => pats.some((p) => p.test(h)));
  const iLat = find(/^lat(itude)?\b/);
  const iLon = find(/^(lon|lng|longitude)\b/);
  const iAlt = find(/height_above_takeoff/, /^rel_alt/, /^alt(itude)?(\b|\()/, /^height/);
  const iT = find(/^time\(millisecond\)/, /^t_ms$/, /^time/, /^offset/);
  const iSpd = find(/^speed/);
  const iHdg = find(/heading|compass_heading|yaw/);
  if (iLat < 0 || iLon < 0) throw new Error("CSV needs latitude and longitude columns");
  const altFeet = iAlt >= 0 && /feet|ft/.test(header[iAlt]);
  const spdMph = iSpd >= 0 && /mph/.test(header[iSpd]);
  const tSeconds = iT >= 0 && !/milli|ms/.test(header[iT]);
  const frames: TelemetryFrame[] = [];
  lines.slice(1).forEach((line, n) => {
    const c = splitCsvLine(line);
    const lat = parseFloat(c[iLat]);
    const lon = parseFloat(c[iLon]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon) || (lat === 0 && lon === 0)) return;
    const altRaw = iAlt >= 0 ? parseFloat(c[iAlt]) : 0;
    const tRaw = iT >= 0 ? parseFloat(c[iT]) : NaN;
    const spd = iSpd >= 0 ? parseFloat(c[iSpd]) : NaN;
    const hdg = iHdg >= 0 ? parseFloat(c[iHdg]) : NaN;
    frames.push({
      t_ms: Number.isFinite(tRaw) ? (tSeconds ? tRaw * 1000 : tRaw) : n * 100,
      lat,
      lon,
      alt_ft: Number.isFinite(altRaw) ? (altFeet ? altRaw : altRaw * FT_PER_M) : 0,
      speed_ms: Number.isFinite(spd) ? (spdMph ? spd * 0.44704 : spd) : undefined,
      heading: Number.isFinite(hdg) ? ((hdg % 360) + 360) % 360 : undefined,
    });
  });
  return normalizeStart(frames);
}

const srtTime = (s: string) => {
  const m = s.match(/(\d+):(\d+):(\d+)[,.](\d+)/);
  return m ? ((+m[1] * 60 + +m[2]) * 60 + +m[3]) * 1000 + +m[4] : NaN;
};

/** Parses DJI video subtitle telemetry (.SRT) in both `[latitude: x] [longitude: y] [rel_alt: z ...]` and `GPS(lon,lat,alt)` styles. */
export function parseDjiSrt(text: string): TelemetryFrame[] {
  const frames: TelemetryFrame[] = [];
  for (const block of text.split(/\r?\n\r?\n/)) {
    const time = block.match(/(\d+:\d+:\d+[,.]\d+)\s*-->/);
    const t = time ? srtTime(time[1]) : NaN;
    let lat = NaN, lon = NaN, alt = 0;
    const la = block.match(/\[latitude\s*:\s*(-?[\d.]+)\]/i);
    const lo = block.match(/\[long(?:i|t)tude\s*:\s*(-?[\d.]+)\]/i);
    if (la && lo) {
      lat = +la[1];
      lon = +lo[1];
      const ra = block.match(/rel_alt\s*:\s*(-?[\d.]+)/i);
      alt = ra ? +ra[1] : 0;
    } else {
      const g = block.match(/GPS\s*\(\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)\s*,\s*(-?[\d.]+)/i);
      if (g) {
        lon = +g[1];
        lat = +g[2];
        const h = block.match(/H\s*([-\d.]+)\s*m/i);
        alt = h ? +h[1] : +g[3];
      }
    }
    if (Number.isFinite(lat) && Number.isFinite(lon) && !(lat === 0 && lon === 0) && Number.isFinite(t)) {
      frames.push({ t_ms: t, lat, lon, alt_ft: alt * FT_PER_M });
    }
  }
  return normalizeStart(frames);
}

function normalizeStart(frames: TelemetryFrame[]) {
  if (!frames.length) return frames;
  frames.sort((a, b) => a.t_ms - b.t_ms);
  const t0 = frames[0].t_ms;
  return frames.map((f) => ({ ...f, t_ms: f.t_ms - t0 }));
}

/** Linear interpolation of the frame at time t (ms). */
export function frameAt(frames: TelemetryFrame[], t: number): TelemetryFrame | null {
  if (!frames.length) return null;
  if (t <= frames[0].t_ms) return frames[0];
  const last = frames[frames.length - 1];
  if (t >= last.t_ms) return last;
  let lo = 0, hi = frames.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (frames[mid].t_ms <= t) lo = mid;
    else hi = mid;
  }
  const a = frames[lo], b = frames[hi];
  const k = (t - a.t_ms) / (b.t_ms - a.t_ms || 1);
  return {
    t_ms: t,
    lat: a.lat + (b.lat - a.lat) * k,
    lon: a.lon + (b.lon - a.lon) * k,
    alt_ft: a.alt_ft + (b.alt_ft - a.alt_ft) * k,
    speed_ms: a.speed_ms,
    heading: a.heading ?? ((Math.atan2((b.lon - a.lon) * Math.cos((a.lat * Math.PI) / 180), b.lat - a.lat) * 180) / Math.PI + 360) % 360,
  };
}
