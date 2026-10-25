import JSZip from "jszip";
import { FT_PER_M } from "./survey";
import type { Waypoint } from "./types";

export interface ExportOptions {
  /** Distance between photos in meters while flying photo legs (from the survey stats). */
  photo_interval_m?: number;
  /** Terrain elevation (ft MSL) at the takeoff point; enables terrain-following relative altitudes. */
  home_terrain_msl?: number;
  mission_name?: string;
}

/**
 * Altitude in meters relative to takeoff that keeps the waypoint's AGL constant over terrain.
 * Without terrain data it falls back to AGL == relative altitude (flat-ground assumption).
 */
export function relativeAltitudeM(wp: Waypoint, homeTerrainMsl?: number) {
  const offsetFt = wp.terrain_msl !== undefined && homeTerrainMsl !== undefined ? wp.terrain_msl - homeTerrainMsl : 0;
  return round((wp.alt_agl + offsetFt) / FT_PER_M, 2);
}

const hasTerrain = (wps: Waypoint[], o: ExportOptions) =>
  o.home_terrain_msl !== undefined && wps.every((w) => w.terrain_msl !== undefined);

// ---------------------------------------------------------------- Litchi CSV
const LITCHI_ACTION: Record<Waypoint["action"], [number, number]> = {
  none: [-1, 0],
  photo: [1, 0],
  start_video: [2, 0],
  stop_video: [3, 0],
  hover: [0, 2000], // "stay for" in milliseconds
};

/** Litchi Mission Hub CSV. Litchi missions are limited to 99 waypoints. */
export function toLitchiCsv(wps: Waypoint[], o: ExportOptions = {}): string {
  const actionCols = Array.from({ length: 15 }, (_, i) => `actiontype${i + 1},actionparam${i + 1}`).join(",");
  const header = `latitude,longitude,altitude(m),heading(deg),curvesize(m),rotationdir,gimbalmode,gimbalpitchangle,${actionCols},altitudemode,speed(m/s),poi_latitude,poi_longitude,poi_altitude(m),poi_altitudemode,photo_timeinterval,photo_distinterval`;
  const terrain = hasTerrain(wps, o);
  const rows = wps.map((wp) => {
    const actions: number[] = [];
    const [t, p] = LITCHI_ACTION[wp.action];
    actions.push(t, p);
    while (actions.length < 30) actions.push(-1, 0);
    // altitudemode 0 = relative to takeoff (terrain-compensated here), 1 = above ground (Litchi resolves elevation).
    const alt = terrain ? relativeAltitudeM(wp, o.home_terrain_msl) : round(wp.alt_agl / FT_PER_M, 2);
    const distInterval = wp.action === "photo" && o.photo_interval_m ? o.photo_interval_m : -1;
    return [
      wp.lat.toFixed(8), wp.lon.toFixed(8), alt, Math.round(wp.heading), 0, 0, 2, wp.gimbal_pitch,
      ...actions, terrain ? 0 : 1, wp.speed, 0, 0, 0, 0, -1, distInterval,
    ].join(",");
  });
  return [header, ...rows].join("\n") + "\n";
}

// ---------------------------------------------------------------- QGroundControl .plan
const MAV = {
  NAV_WAYPOINT: 16,
  NAV_LOITER_TIME: 19,
  NAV_RETURN_TO_LAUNCH: 20,
  NAV_TAKEOFF: 22,
  DO_MOUNT_CONTROL: 205,
  DO_SET_CAM_TRIGG_DIST: 206,
  IMAGE_START_CAPTURE: 2000,
  VIDEO_START_CAPTURE: 2500,
  VIDEO_STOP_CAPTURE: 2501,
  FRAME_MISSION: 2,
  FRAME_GLOBAL_RELATIVE_ALT: 3,
};

/** QGroundControl plan file (MAVLink mission, altitudes relative to home). */
export function toQgcPlan(wps: Waypoint[], o: ExportOptions = {}) {
  if (!wps.length) throw new Error("No waypoints to export");
  let seq = 1;
  const items: Record<string, unknown>[] = [];
  const cmd = (command: number, params: (number | null)[], frame = MAV.FRAME_MISSION) => {
    items.push({ type: "SimpleItem", autoContinue: true, command, frame, doJumpId: seq++, params });
  };
  const nav = (command: number, wp: Waypoint, hold = 0) => {
    const alt = relativeAltitudeM(wp, o.home_terrain_msl);
    items.push({
      type: "SimpleItem", autoContinue: true, command, frame: MAV.FRAME_GLOBAL_RELATIVE_ALT, doJumpId: seq++,
      AMSLAltAboveTerrain: null, Altitude: alt, AltitudeMode: 1,
      params: [hold, 0, 0, null, wp.lat, wp.lon, alt],
    });
  };
  const first = wps[0];
  nav(MAV.NAV_TAKEOFF, first);
  let pitch: number | null = null;
  let triggering = false;
  for (const wp of wps) {
    nav(MAV.NAV_WAYPOINT, wp, wp.action === "hover" ? 2 : 0);
    if (wp.gimbal_pitch !== pitch) {
      // params: pitch, roll, yaw, -, -, -, MAV_MOUNT_MODE_MAVLINK_TARGETING (2)
      cmd(MAV.DO_MOUNT_CONTROL, [wp.gimbal_pitch, 0, 0, 0, 0, 0, 2]);
      pitch = wp.gimbal_pitch;
    }
    if (wp.action === "photo" && o.photo_interval_m && !triggering) {
      cmd(MAV.DO_SET_CAM_TRIGG_DIST, [o.photo_interval_m, 0, 1, 0, 0, 0, 0]);
      triggering = true;
    } else if (wp.action === "none" && triggering) {
      cmd(MAV.DO_SET_CAM_TRIGG_DIST, [0, 0, 0, 0, 0, 0, 0]);
      triggering = false;
    } else if (wp.action === "photo" && !o.photo_interval_m) {
      cmd(MAV.IMAGE_START_CAPTURE, [0, 0, 1, 0, 0, 0, 0]);
    } else if (wp.action === "start_video") {
      cmd(MAV.VIDEO_START_CAPTURE, [0, 0, 0, 0, 0, 0, 0]);
    } else if (wp.action === "stop_video") {
      cmd(MAV.VIDEO_STOP_CAPTURE, [0, 0, 0, 0, 0, 0, 0]);
    }
  }
  if (triggering) cmd(MAV.DO_SET_CAM_TRIGG_DIST, [0, 0, 0, 0, 0, 0, 0]);
  cmd(MAV.NAV_RETURN_TO_LAUNCH, [0, 0, 0, 0, 0, 0, 0]);
  const speed = Math.max(...wps.map((w) => w.speed));
  return {
    fileType: "Plan",
    version: 1,
    groundStation: "QGroundControl",
    geoFence: { circles: [], polygons: [], version: 2 },
    rallyPoints: { points: [], version: 2 },
    mission: {
      version: 2,
      firmwareType: 12, // MAV_AUTOPILOT_PX4; QGC also opens it for ArduPilot vehicles
      vehicleType: 2, // MAV_TYPE_QUADROTOR
      cruiseSpeed: speed,
      hoverSpeed: speed,
      globalPlanAltitudeMode: 1,
      plannedHomePosition: [first.lat, first.lon, o.home_terrain_msl !== undefined ? round(o.home_terrain_msl / FT_PER_M, 1) : 0],
      items,
    },
  };
}

// ---------------------------------------------------------------- DJI WPML (.kmz)
/** DJI drone enum values used in wpml:droneInfo. */
export const DJI_DRONES = {
  "M300 RTK": 60,
  "M30 Series": 67,
  "Mavic 3 Enterprise": 77,
  "M350 RTK": 89,
  "Matrice 3D": 91,
} as const;

const esc = (s: string) => s.replace(/[<>&]/g, (c) => ({ "<": "&lt;", ">": "&gt;", "&": "&amp;" })[c]!);

/** Splits photo legs into evenly spaced capture points so the aircraft takes a photo at each. */
export function densifyPhotoLegs(wps: Waypoint[], interval_m?: number): Waypoint[] {
  if (!interval_m) return wps;
  const out: Waypoint[] = [];
  for (let i = 0; i < wps.length; i++) {
    const a = wps[i];
    out.push(a);
    const b = wps[i + 1];
    if (a.action !== "photo" || !b) continue;
    const d = haversineM(a, b);
    const n = Math.floor(d / interval_m);
    for (let k = 1; k <= n; k++) {
      const t = (k * interval_m) / d;
      if (t >= 1) break;
      out.push({ ...a, lat: a.lat + (b.lat - a.lat) * t, lon: a.lon + (b.lon - a.lon) * t,
        terrain_msl: a.terrain_msl !== undefined && b.terrain_msl !== undefined ? a.terrain_msl + (b.terrain_msl - a.terrain_msl) * t : undefined,
        action: "photo" });
    }
  }
  return out;
}

function placemark(wp: Waypoint, index: number, alt: number, actionGroupId: number): string {
  const actions: string[] = [];
  let id = 0;
  actions.push(`<wpml:action><wpml:actionId>${id++}</wpml:actionId><wpml:actionActuatorFunc>gimbalRotate</wpml:actionActuatorFunc><wpml:actionActuatorFuncParam>
            <wpml:gimbalHeadingYawBase>aircraft</wpml:gimbalHeadingYawBase><wpml:gimbalRotateMode>absoluteAngle</wpml:gimbalRotateMode>
            <wpml:gimbalPitchRotateEnable>1</wpml:gimbalPitchRotateEnable><wpml:gimbalPitchRotateAngle>${wp.gimbal_pitch}</wpml:gimbalPitchRotateAngle>
            <wpml:gimbalRollRotateEnable>0</wpml:gimbalRollRotateEnable><wpml:gimbalRollRotateAngle>0</wpml:gimbalRollRotateAngle>
            <wpml:gimbalYawRotateEnable>0</wpml:gimbalYawRotateEnable><wpml:gimbalYawRotateAngle>0</wpml:gimbalYawRotateAngle>
            <wpml:gimbalRotateTimeEnable>0</wpml:gimbalRotateTimeEnable><wpml:gimbalRotateTime>0</wpml:gimbalRotateTime>
            <wpml:payloadPositionIndex>0</wpml:payloadPositionIndex></wpml:actionActuatorFuncParam></wpml:action>`);
  const fn = { photo: "takePhoto", start_video: "startRecord", stop_video: "stopRecord", hover: "hover", none: null }[wp.action];
  if (fn) {
    const param = fn === "hover" ? "<wpml:hoverTime>2</wpml:hoverTime>" : "<wpml:payloadPositionIndex>0</wpml:payloadPositionIndex>";
    actions.push(`<wpml:action><wpml:actionId>${id++}</wpml:actionId><wpml:actionActuatorFunc>${fn}</wpml:actionActuatorFunc><wpml:actionActuatorFuncParam>${param}</wpml:actionActuatorFuncParam></wpml:action>`);
  }
  return `
      <Placemark>
        <Point><coordinates>${wp.lon.toFixed(8)},${wp.lat.toFixed(8)}</coordinates></Point>
        <wpml:index>${index}</wpml:index>
        <wpml:executeHeight>${alt}</wpml:executeHeight>
        <wpml:waypointSpeed>${wp.speed}</wpml:waypointSpeed>
        <wpml:waypointHeadingParam><wpml:waypointHeadingMode>fixed</wpml:waypointHeadingMode><wpml:waypointHeadingAngle>${headingTo180(wp.heading)}</wpml:waypointHeadingAngle><wpml:waypointPoiPoint>0.000000,0.000000,0.000000</wpml:waypointPoiPoint><wpml:waypointHeadingAngleEnable>1</wpml:waypointHeadingAngleEnable><wpml:waypointHeadingPathMode>followBadArc</wpml:waypointHeadingPathMode></wpml:waypointHeadingParam>
        <wpml:waypointTurnParam><wpml:waypointTurnMode>toPointAndStopWithDiscontinuityCurvature</wpml:waypointTurnMode><wpml:waypointTurnDampingDist>0</wpml:waypointTurnDampingDist></wpml:waypointTurnParam>
        <wpml:useStraightLine>1</wpml:useStraightLine>
        <wpml:actionGroup><wpml:actionGroupId>${actionGroupId}</wpml:actionGroupId><wpml:actionGroupStartIndex>${index}</wpml:actionGroupStartIndex><wpml:actionGroupEndIndex>${index}</wpml:actionGroupEndIndex><wpml:actionGroupMode>sequence</wpml:actionGroupMode><wpml:actionTrigger><wpml:actionTriggerType>reachPoint</wpml:actionTriggerType></wpml:actionTrigger>
          ${actions.join("\n          ")}
        </wpml:actionGroup>
      </Placemark>`;
}

/** Builds the waylines.wpml and template.kml documents for a DJI WPML mission. */
export function toDjiWpml(wps: Waypoint[], o: ExportOptions & { drone_enum?: number } = {}) {
  const pts = densifyPhotoLegs(wps, o.photo_interval_m);
  const speed = Math.max(...pts.map((w) => w.speed));
  const drone = o.drone_enum ?? DJI_DRONES["Mavic 3 Enterprise"];
  const now = Date.now();
  const missionConfig = `
    <wpml:missionConfig>
      <wpml:flyToWaylineMode>safely</wpml:flyToWaylineMode>
      <wpml:finishAction>goHome</wpml:finishAction>
      <wpml:exitOnRCLost>executeLostAction</wpml:exitOnRCLost>
      <wpml:executeRCLostAction>goBack</wpml:executeRCLostAction>
      <wpml:globalTransitionalSpeed>${speed}</wpml:globalTransitionalSpeed>
      <wpml:droneInfo><wpml:droneEnumValue>${drone}</wpml:droneEnumValue><wpml:droneSubEnumValue>0</wpml:droneSubEnumValue></wpml:droneInfo>
    </wpml:missionConfig>`;
  const marks = pts.map((wp, i) => placemark(wp, i, relativeAltitudeM(wp, o.home_terrain_msl), i)).join("");
  const head = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2" xmlns:wpml="http://www.dji.com/wpmz/1.0.2">
  <Document>`;
  const waylines = `${head}${missionConfig}
    <Folder>
      <wpml:templateId>0</wpml:templateId>
      <wpml:executeHeightMode>relativeToStartPoint</wpml:executeHeightMode>
      <wpml:waylineId>0</wpml:waylineId>
      <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>${marks}
    </Folder>
  </Document>
</kml>
`;
  const template = `${head}
    <wpml:author>AeroCommand</wpml:author>
    <wpml:createTime>${now}</wpml:createTime>
    <wpml:updateTime>${now}</wpml:updateTime>${missionConfig}
    <Folder>
      <wpml:templateType>waypoint</wpml:templateType>
      <wpml:templateId>0</wpml:templateId>
      <wpml:waylineCoordinateSysParam><wpml:coordinateMode>WGS84</wpml:coordinateMode><wpml:heightMode>relativeToStartPoint</wpml:heightMode></wpml:waylineCoordinateSysParam>
      <wpml:autoFlightSpeed>${speed}</wpml:autoFlightSpeed>${marks}
    </Folder>
  </Document>
</kml>
`;
  return { waylines, template, name: esc(o.mission_name ?? "aerocommand") };
}

/** DJI WPML mission packaged as a .kmz (zip with wpmz/template.kml + wpmz/waylines.wpml). */
export async function toDjiKmz(wps: Waypoint[], o: ExportOptions & { drone_enum?: number } = {}): Promise<Blob> {
  const { waylines, template } = toDjiWpml(wps, o);
  const zip = new JSZip();
  zip.file("wpmz/template.kml", template);
  zip.file("wpmz/waylines.wpml", waylines);
  return zip.generateAsync({ type: "blob", mimeType: "application/vnd.google-earth.kmz" });
}

function headingTo180(h: number) {
  const x = ((h % 360) + 360) % 360;
  return Math.round(x > 180 ? x - 360 : x);
}

function haversineM(a: { lat: number; lon: number }, b: { lat: number; lon: number }) {
  const R = 6371008.8;
  const r = Math.PI / 180;
  const dLat = (b.lat - a.lat) * r;
  const dLon = (b.lon - a.lon) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * r) * Math.cos(b.lat * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

const round = (v: number, d: number) => Math.round(v * 10 ** d) / 10 ** d;
