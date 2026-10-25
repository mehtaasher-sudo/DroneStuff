import Anthropic from "@anthropic-ai/sdk";
import { bbox as turfBbox } from "@turf/turf";
import type { Feature, Polygon } from "geojson";
import { z } from "zod";
import { validateWaypoints, type WaypointCheck } from "./laanc";
import { fetchElevationFt, fetchUasfm } from "./sources";
import { generateSurvey, type SurveyResult } from "./survey";
import type { BBox, UasfmCollection, Waypoint } from "./types";

export const AGENT_MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5-5";
const MAX_TURNS = 10;

const SYSTEM = `You are the AeroCommand mission-planning copilot for FAA Part 107 sUAS operators.
You plan photogrammetry and inspection flights over the parcel polygon the operator has drawn.

Rules:
- Altitudes are feet AGL unless labeled MSL. Never plan above 400 ft AGL.
- Before generating waypoints, call get_airspace_ceilings for the parcel bbox (and for any sub-area the operator mentions, e.g. "eastern edge") so you know the FAA UAS Facility Map ceilings.
- Use generate_waypoints to build the plan; it terrain-adjusts and validates every waypoint against the UASFM grid. If it reports violations, tell the operator exactly which ceiling is exceeded and either propose a compliant altitude or explain that LAANC further coordination is required.
- Report the final plan's key numbers: pattern, altitude AGL, overlaps, gimbal pitch, line spacing, photo interval, GSD, waypoint count, distance and estimated flight time.
- Be concise. You cannot submit LAANC requests or fly the aircraft.`;

const tools: Anthropic.Beta.BetaTool[] = [
  {
    name: "get_airspace_ceilings",
    description:
      "Query FAA UAS Facility Map (UASFM) grid cells inside a bounding box. Returns the min/max LAANC ceiling (ft AGL), the airports the cells belong to, and a per-ceiling breakdown with each group's bbox. Cells only exist in controlled airspace near airports; no cells means no LAANC grid.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        west: { type: "number" }, south: { type: "number" }, east: { type: "number" }, north: { type: "number" },
      },
      required: ["west", "south", "east", "north"],
      additionalProperties: false,
    },
  },
  {
    name: "get_terrain_elevation",
    description: "Terrain elevation in feet MSL (Copernicus 90 m DEM via Open-Meteo) for up to 100 [lon, lat] coordinates.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        coordinates: { type: "array", items: { type: "array", items: { type: "number" } } },
      },
      required: ["coordinates"],
      additionalProperties: false,
    },
  },
  {
    name: "generate_waypoints",
    description:
      "Generate a survey flight plan over the operator's parcel polygon. Computes line spacing and photo interval from overlaps and the camera footprint, attaches terrain elevation to every waypoint so AGL stays constant, and validates each waypoint against the UASFM ceiling beneath it. Returns stats and any LAANC violations. The plan is delivered to the operator's map automatically.",
    strict: true,
    input_schema: {
      type: "object",
      properties: {
        pattern: { type: "string", enum: ["lawnmower", "crosshatch"] },
        altitude_agl_ft: { type: "number", description: "Flight altitude in feet AGL (max 400)." },
        front_overlap: { type: "number", description: "Forward overlap fraction, e.g. 0.75." },
        side_overlap: { type: "number", description: "Side overlap fraction, e.g. 0.75." },
        gimbal_pitch: { type: "number", description: "Gimbal pitch in degrees: -90 nadir, -35 oblique, 0 horizon." },
        line_angle_deg: { type: "number", description: "Flight-line direction in degrees true, or -1 to align with the parcel's longest edge." },
        speed_ms: { type: "number", description: "Ground speed in m/s, or 0 to derive from the photo interval." },
      },
      required: ["pattern", "altitude_agl_ft", "front_overlap", "side_overlap", "gimbal_pitch", "line_angle_deg", "speed_ms"],
      additionalProperties: false,
    },
  },
];

const BBoxInput = z.object({ west: z.number(), south: z.number(), east: z.number(), north: z.number() });
const ElevInput = z.object({ coordinates: z.array(z.tuple([z.number(), z.number()])).min(1).max(100) });
const GenInput = z.object({
  pattern: z.enum(["lawnmower", "crosshatch"]),
  altitude_agl_ft: z.number().min(10).max(400),
  front_overlap: z.number().min(0).max(0.95),
  side_overlap: z.number().min(0).max(0.95),
  gimbal_pitch: z.number().min(-90).max(30),
  line_angle_deg: z.number(),
  speed_ms: z.number().min(0).max(20),
});

export interface AgentPlan {
  params: z.infer<typeof GenInput>;
  waypoints: Waypoint[];
  stats: SurveyResult["stats"];
  checks: WaypointCheck[];
  home_terrain_msl?: number;
}

export interface AgentResult {
  reply: string;
  plan: AgentPlan | null;
  toolLog: { name: string; input: unknown; ok: boolean }[];
}

function summarizeCells(cells: UasfmCollection) {
  const groups = new Map<number, { count: number; bbox: number[]; airports: Set<string> }>();
  for (const c of cells.features) {
    const ceil = Number(c.properties.CEILING);
    const b = turfBbox(c);
    const g = groups.get(ceil) ?? { count: 0, bbox: [Infinity, Infinity, -Infinity, -Infinity], airports: new Set<string>() };
    g.count++;
    g.bbox = [Math.min(g.bbox[0], b[0]), Math.min(g.bbox[1], b[1]), Math.max(g.bbox[2], b[2]), Math.max(g.bbox[3], b[3])];
    if (c.properties.APT1_FAAID) g.airports.add(String(c.properties.APT1_FAAID));
    groups.set(ceil, g);
  }
  const ceilings = [...groups.keys()].sort((a, b) => a - b);
  return {
    cell_count: cells.features.length,
    min_ceiling_ft_agl: ceilings[0] ?? null,
    max_ceiling_ft_agl: ceilings.at(-1) ?? null,
    by_ceiling: ceilings.map((ft) => {
      const g = groups.get(ft)!;
      return { ceiling_ft_agl: ft, cells: g.count, bbox: g.bbox.map((n) => +n.toFixed(5)), airports: [...g.airports] };
    }),
  };
}

export async function runMissionAgent(prompt: string, parcel: Feature<Polygon>, history: Anthropic.Beta.BetaMessageParam[] = []): Promise<AgentResult> {
  const client = new Anthropic();
  const parcelBbox = turfBbox(parcel) as BBox;
  const ring = parcel.geometry.coordinates[0] as [number, number][];
  const toolLog: AgentResult["toolLog"] = [];
  let plan: AgentPlan | null = null;
  let parcelCells: UasfmCollection | null = null;

  const context = `Parcel polygon ([lon, lat]): ${JSON.stringify(ring.map(([x, y]) => [+x.toFixed(6), +y.toFixed(6)]))}
Parcel bbox [west, south, east, north]: ${JSON.stringify(parcelBbox.map((n) => +n.toFixed(6)))}`;

  const messages: Anthropic.Beta.BetaMessageParam[] = [...history, { role: "user", content: `${context}\n\n${prompt}` }];

  async function execute(name: string, input: unknown): Promise<string> {
    if (name === "get_airspace_ceilings") {
      const b = BBoxInput.parse(input);
      return JSON.stringify(summarizeCells(await fetchUasfm([b.west, b.south, b.east, b.north])));
    }
    if (name === "get_terrain_elevation") {
      const { coordinates } = ElevInput.parse(input);
      const elev = await fetchElevationFt(coordinates.map(([lon, lat]) => ({ lat, lon })));
      return JSON.stringify(coordinates.map((c, i) => ({ lon: c[0], lat: c[1], elevation_ft_msl: elev[i] })));
    }
    if (name === "generate_waypoints") {
      const p = GenInput.parse(input);
      const survey = generateSurvey({
        ring,
        pattern: p.pattern,
        alt_agl_ft: p.altitude_agl_ft,
        front_overlap: p.front_overlap,
        side_overlap: p.side_overlap,
        gimbal_pitch: p.gimbal_pitch,
        line_angle_deg: p.line_angle_deg >= 0 ? p.line_angle_deg : undefined,
        speed_ms: p.speed_ms > 0 ? p.speed_ms : undefined,
      });
      let home: number | undefined;
      try {
        const elev = await fetchElevationFt(survey.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })));
        survey.waypoints.forEach((w, i) => (w.terrain_msl = elev[i]));
        home = elev[0];
      } catch {
        // Terrain is an enhancement; the plan stays valid relative to takeoff without it.
      }
      parcelCells ??= await fetchUasfm(parcelBbox);
      const checks = validateWaypoints(survey.waypoints, parcelCells);
      plan = { params: p, waypoints: survey.waypoints, stats: survey.stats, checks, home_terrain_msl: home };
      const violations = checks.filter((c) => c.violation);
      const terrain = survey.waypoints.map((w) => w.terrain_msl).filter((t): t is number => t !== undefined);
      return JSON.stringify({
        waypoint_count: survey.waypoints.length,
        stats: survey.stats,
        terrain_ft_msl: terrain.length ? { min: Math.min(...terrain), max: Math.max(...terrain) } : "unavailable",
        violations: violations.length,
        violation_details: violations.slice(0, 10).map((v) => v.message),
        limits_seen_ft_agl: [...new Set(checks.map((c) => c.limit_ft))].sort((a, b) => a - b),
      });
    }
    throw new Error(`Unknown tool ${name}`);
  }

  for (let turn = 0; turn < MAX_TURNS; turn++) {
    const response = await client.beta.messages.create({
      model: AGENT_MODEL,
      max_tokens: 16000,
      thinking: { type: "adaptive" },
      output_config: { effort: "medium" },
      betas: ["server-side-fallback-2026-07-01"],
      fallbacks: "default",
      system: SYSTEM,
      tools,
      messages,
    });
    messages.push({ role: "assistant", content: response.content });
    const text = response.content.filter((b): b is Anthropic.Beta.BetaTextBlock => b.type === "text").map((b) => b.text).join("\n").trim();

    if (response.stop_reason === "refusal") {
      return { reply: text || "The request was declined.", plan, toolLog };
    }
    if (response.stop_reason !== "tool_use") {
      return { reply: text || (response.stop_reason === "max_tokens" ? "Response truncated." : "Done."), plan, toolLog };
    }
    const uses = response.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
    const results = await Promise.all(
      uses.map(async (u): Promise<Anthropic.Beta.BetaToolResultBlockParam> => {
        try {
          const content = await execute(u.name, u.input);
          toolLog.push({ name: u.name, input: u.input, ok: true });
          return { type: "tool_result", tool_use_id: u.id, content };
        } catch (e) {
          toolLog.push({ name: u.name, input: u.input, ok: false });
          return { type: "tool_result", tool_use_id: u.id, content: e instanceof Error ? e.message : String(e), is_error: true };
        }
      }),
    );
    messages.push({ role: "user", content: results });
  }
  return { reply: "Stopped after the maximum number of planning steps.", plan, toolLog };
}
