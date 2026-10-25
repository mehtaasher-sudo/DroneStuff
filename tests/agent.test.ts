import { beforeEach, describe, expect, it, vi } from "vitest";
import type { Feature, Polygon } from "geojson";

// Scripted Claude responses: ceilings → generate → final answer.
const create = vi.fn();
vi.mock("@anthropic-ai/sdk", () => {
  class Anthropic {
    beta = { messages: { create } };
  }
  return { default: Anthropic };
});

const parcel: Feature<Polygon> = {
  type: "Feature", properties: {},
  geometry: { type: "Polygon", coordinates: [[[-75, 40], [-74.997, 40], [-74.997, 40.002], [-75, 40.002], [-75, 40]]] },
};
const cells = {
  type: "FeatureCollection",
  features: [
    { type: "Feature", properties: { CEILING: 400, APT1_FAAID: "TST" }, geometry: { type: "Polygon", coordinates: [[[-75.01, 39.99], [-74.9985, 39.99], [-74.9985, 40.01], [-75.01, 40.01], [-75.01, 39.99]]] } },
    { type: "Feature", properties: { CEILING: 200, APT1_FAAID: "TST" }, geometry: { type: "Polygon", coordinates: [[[-74.9985, 39.99], [-74.99, 39.99], [-74.99, 40.01], [-74.9985, 40.01], [-74.9985, 39.99]]] } },
  ],
};

beforeEach(() => {
  create.mockReset();
  vi.stubGlobal("fetch", vi.fn(async (url: string) => {
    const u = String(url);
    if (u.includes("FeatureServer")) return new Response(JSON.stringify(cells));
    if (u.includes("/v1/elevation")) {
      const n = new URL(u).searchParams.get("latitude")!.split(",").length;
      return new Response(JSON.stringify({ elevation: Array(n).fill(30) }));
    }
    return new Response("{}", { status: 404 });
  }));
});

describe("runMissionAgent", () => {
  it("runs the tool loop and returns a validated plan", async () => {
    create
      .mockResolvedValueOnce({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "get_airspace_ceilings", input: { west: -75, south: 40, east: -74.997, north: 40.002 } }] })
      .mockResolvedValueOnce({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t2", name: "generate_waypoints", input: { pattern: "crosshatch", altitude_agl_ft: 250, front_overlap: 0.75, side_overlap: 0.75, gimbal_pitch: -35, line_angle_deg: -1, speed_ms: 0 } }] })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Plan exceeds the 200 ft grid on the eastern edge." }] });

    const { runMissionAgent } = await import("@/lib/agent");
    const r = await runMissionAgent("crosshatch at 250 ft", parcel);

    expect(r.reply).toContain("200 ft");
    expect(r.toolLog.map((t) => [t.name, t.ok])).toEqual([["get_airspace_ceilings", true], ["generate_waypoints", true]]);
    expect(r.plan?.params.pattern).toBe("crosshatch");
    expect(r.plan?.waypoints.every((w) => w.terrain_msl === 98 && w.gimbal_pitch === -35)).toBe(true);
    // Eastern-edge waypoints sit in the 200 ft cell → violations at 250 ft AGL.
    expect(r.plan?.checks.some((c) => c.violation && c.ceiling_ft === 200)).toBe(true);
    expect(r.plan?.checks.some((c) => !c.violation && c.ceiling_ft === 400)).toBe(true);

    const firstCall = create.mock.calls[0][0];
    expect(firstCall.thinking).toEqual({ type: "adaptive" });
    expect(firstCall.tools.every((t: { strict: boolean }) => t.strict)).toBe(true);
    // messages is the live array the loop appends to: [user, assistant(tool_use), user(tool_result), ...]
    const ceilingResult = JSON.parse(create.mock.calls[1][0].messages[2].content[0].content);
    expect(ceilingResult).toMatchObject({ min_ceiling_ft_agl: 200, max_ceiling_ft_agl: 400 });
  });

  it("returns tool errors to the model instead of throwing", async () => {
    create
      .mockResolvedValueOnce({ stop_reason: "tool_use", content: [{ type: "tool_use", id: "t1", name: "generate_waypoints", input: { pattern: "lawnmower", altitude_agl_ft: 900, front_overlap: 0.7, side_overlap: 0.7, gimbal_pitch: -90, line_angle_deg: -1, speed_ms: 0 } }] })
      .mockResolvedValueOnce({ stop_reason: "end_turn", content: [{ type: "text", text: "Altitude must be ≤ 400 ft." }] });
    const { runMissionAgent } = await import("@/lib/agent");
    const r = await runMissionAgent("fly at 900 ft", parcel);
    expect(r.toolLog[0].ok).toBe(false);
    expect(r.plan).toBeNull();
    expect(create.mock.calls[1][0].messages[2].content[0].is_error).toBe(true);
  });
});
