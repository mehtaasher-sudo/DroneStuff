import type { Waypoint } from "./types";

export const FT_PER_M = 3.28084;
const EARTH_R = 6371008.8;

export interface CameraSpec {
  name: string;
  sensor_width_mm: number;
  sensor_height_mm: number;
  focal_length_mm: number;
  image_width_px: number;
  image_height_px: number;
}

/** DJI Phantom 4 Pro/Pro V2.0 camera: 1" 13.2×8.8 mm sensor, 8.8 mm focal length, 5472×3648 px. */
export const DEFAULT_CAMERA: CameraSpec = {
  name: "DJI Phantom 4 Pro (1\" 20 MP)",
  sensor_width_mm: 13.2,
  sensor_height_mm: 8.8,
  focal_length_mm: 8.8,
  image_width_px: 5472,
  image_height_px: 3648,
};

export type SurveyPattern = "lawnmower" | "crosshatch";

export interface SurveyParams {
  /** Polygon ring as [lon, lat] pairs (closing point optional). */
  ring: [number, number][];
  pattern: SurveyPattern;
  alt_agl_ft: number;
  /** Fractions 0-0.95. */
  front_overlap: number;
  side_overlap: number;
  gimbal_pitch: number;
  /** Flight-line direction in degrees true. */
  line_angle_deg?: number;
  speed_ms?: number;
  camera?: CameraSpec;
}

export interface SurveyResult {
  waypoints: Waypoint[];
  stats: {
    gsd_cm_px: number;
    footprint_across_m: number;
    footprint_along_m: number;
    line_spacing_m: number;
    photo_interval_m: number;
    lines: number;
    distance_m: number;
    est_flight_time_s: number;
    est_photos: number;
  };
}

type XY = [number, number];

/** Local equirectangular projection in meters around an origin; accurate to well under 0.1 % across a survey parcel. */
export function makeProjection(lat0: number, lon0: number) {
  const k = Math.cos((lat0 * Math.PI) / 180);
  return {
    toXY: ([lon, lat]: [number, number]): XY => [
      ((lon - lon0) * Math.PI * EARTH_R * k) / 180,
      ((lat - lat0) * Math.PI * EARTH_R) / 180,
    ],
    toLonLat: ([x, y]: XY): [number, number] => [lon0 + (x * 180) / (Math.PI * EARTH_R * k), lat0 + (y * 180) / (Math.PI * EARTH_R)],
  };
}

/** Nadir image footprint and ground sample distance for a camera at an altitude (landscape, long side across-track). */
export function footprint(alt_m: number, cam: CameraSpec) {
  return {
    across_m: (alt_m * cam.sensor_width_mm) / cam.focal_length_mm,
    along_m: (alt_m * cam.sensor_height_mm) / cam.focal_length_mm,
    gsd_cm_px: (cam.sensor_width_mm * alt_m * 100) / (cam.focal_length_mm * cam.image_width_px),
  };
}

function scanSegments(poly: XY[], angleDeg: number, spacing: number): [XY, XY][] {
  const h = (angleDeg * Math.PI) / 180;
  const s = Math.sin(h);
  const c = Math.cos(h);
  // u: along-line coordinate, v: across-line coordinate.
  const uv = poly.map(([x, y]) => [x * s + y * c, x * c - y * s] as XY);
  const back = ([u, v]: XY): XY => [u * s + v * c, u * c - v * s];
  const vs = uv.map((p) => p[1]);
  const vmin = Math.min(...vs);
  const vmax = Math.max(...vs);
  const width = vmax - vmin;
  // Center n lines across the polygon; each edge margin is at most spacing/2, so edges stay covered.
  const n = Math.max(1, Math.ceil(width / spacing));
  const margin = (width - (n - 1) * spacing) / 2;
  const lines: [XY, XY][][] = [];
  for (let i = 0; i < n; i++) {
    const v = n === 1 ? vmin + width / 2 : vmin + margin + i * spacing;
    const xs: number[] = [];
    for (let j = 0; j < uv.length; j++) {
      const [u1, v1] = uv[j];
      const [u2, v2] = uv[(j + 1) % uv.length];
      if (v1 === v2) continue;
      if ((v >= Math.min(v1, v2)) && (v < Math.max(v1, v2))) {
        xs.push(u1 + ((v - v1) * (u2 - u1)) / (v2 - v1));
      }
    }
    xs.sort((a, b) => a - b);
    const segs: [XY, XY][] = [];
    for (let k = 0; k + 1 < xs.length; k += 2) segs.push([back([xs[k], v]), back([xs[k + 1], v])]);
    if (segs.length) lines.push(segs);
  }
  // Boustrophedon: reverse every other line (and its segment order).
  const out: [XY, XY][] = [];
  lines.forEach((segs, i) => {
    if (i % 2 === 0) out.push(...segs);
    else out.push(...segs.reverse().map(([a, b]) => [b, a] as [XY, XY]));
  });
  return out;
}

function headingOf(a: XY, b: XY) {
  const deg = (Math.atan2(b[0] - a[0], b[1] - a[1]) * 180) / Math.PI;
  return (deg + 360) % 360;
}

/** Generates a lawnmower or crosshatch photogrammetry survey over a polygon. */
export function generateSurvey(p: SurveyParams): SurveyResult {
  const cam = p.camera ?? DEFAULT_CAMERA;
  const ring = [...p.ring];
  if (ring.length > 1 && ring[0][0] === ring.at(-1)![0] && ring[0][1] === ring.at(-1)![1]) ring.pop();
  if (ring.length < 3) throw new Error("Survey polygon needs at least 3 vertices");
  const front = Math.min(Math.max(p.front_overlap, 0), 0.95);
  const side = Math.min(Math.max(p.side_overlap, 0), 0.95);
  const lat0 = ring.reduce((a, r) => a + r[1], 0) / ring.length;
  const lon0 = ring.reduce((a, r) => a + r[0], 0) / ring.length;
  const proj = makeProjection(lat0, lon0);
  const poly = ring.map(proj.toXY);

  const alt_m = p.alt_agl_ft / FT_PER_M;
  const fp = footprint(alt_m, cam);
  const spacing = fp.across_m * (1 - side);
  const interval = fp.along_m * (1 - front);
  const speed = p.speed_ms ?? Math.min(10, Math.max(2, interval / 2)); // ≥2 s between photos
  const angle = p.line_angle_deg ?? autoAngle(poly);

  const segs = scanSegments(poly, angle, spacing);
  if (p.pattern === "crosshatch") segs.push(...scanSegments(poly, angle + 90, spacing));

  const waypoints: Waypoint[] = [];
  let distance_m = 0;
  let prev: XY | null = null;
  for (const [a, b] of segs) {
    if (prev) distance_m += Math.hypot(a[0] - prev[0], a[1] - prev[1]);
    distance_m += Math.hypot(b[0] - a[0], b[1] - a[1]);
    const hdg = Math.round(headingOf(a, b));
    for (const [pt, action] of [[a, "photo"], [b, "none"]] as const) {
      const [lon, lat] = proj.toLonLat(pt);
      waypoints.push({ lat, lon, alt_agl: p.alt_agl_ft, speed: round(speed, 1), heading: hdg, gimbal_pitch: p.gimbal_pitch, action });
    }
    prev = b;
  }
  const lineLength = segs.reduce((s, [a, b]) => s + Math.hypot(b[0] - a[0], b[1] - a[1]), 0);
  return {
    waypoints,
    stats: {
      gsd_cm_px: round(fp.gsd_cm_px, 2),
      footprint_across_m: round(fp.across_m, 1),
      footprint_along_m: round(fp.along_m, 1),
      line_spacing_m: round(spacing, 1),
      photo_interval_m: round(interval, 1),
      lines: segs.length,
      distance_m: Math.round(distance_m),
      est_flight_time_s: Math.round(distance_m / speed),
      est_photos: Math.ceil(lineLength / interval) + segs.length,
    },
  };
}

/** Picks the line direction parallel to the polygon's longest edge (fewest turns). */
function autoAngle(poly: XY[]) {
  let best = 0;
  let len = -1;
  for (let i = 0; i < poly.length; i++) {
    const a = poly[i];
    const b = poly[(i + 1) % poly.length];
    const l = Math.hypot(b[0] - a[0], b[1] - a[1]);
    if (l > len) {
      len = l;
      best = headingOf(a, b);
    }
  }
  return best % 180;
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
