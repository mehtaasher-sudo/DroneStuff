import type { Feature, FeatureCollection, MultiPolygon, Polygon } from "geojson";

/** A flight-plan waypoint. `alt_agl` is feet Above Ground Level. */
export interface Waypoint {
  lat: number;
  lon: number;
  /** Feet AGL (above the terrain directly below the waypoint). */
  alt_agl: number;
  /** Ground speed in m/s. */
  speed: number;
  /** Aircraft heading in degrees true (0-360). */
  heading: number;
  /** Gimbal pitch in degrees; 0 = horizon, -90 = nadir. */
  gimbal_pitch: number;
  action: "none" | "photo" | "start_video" | "stop_video" | "hover";
  /** Terrain elevation in feet MSL under the waypoint, when known. */
  terrain_msl?: number;
}

export interface UasfmProperties {
  /** Maximum LAANC auto-approval altitude in feet AGL for this 30-second grid cell. */
  CEILING: number;
  APT1_FAAID?: string;
  APT1_NAME?: string;
  [key: string]: unknown;
}

export type UasfmCell = Feature<Polygon | MultiPolygon, UasfmProperties>;
export type UasfmCollection = FeatureCollection<Polygon | MultiPolygon, UasfmProperties>;

export type BBox = [west: number, south: number, east: number, north: number];

export interface Aircraft {
  hex: string;
  callsign: string | null;
  lat: number;
  lon: number;
  /** Barometric altitude in feet MSL (pressure altitude); null if on ground/unknown. */
  alt_baro_ft: number | null;
  /** Geometric (GNSS) altitude in feet MSL. */
  alt_geom_ft: number | null;
  onGround: boolean;
  /** Ground speed in knots. */
  gs_kt: number | null;
  /** Track over ground in degrees true. */
  track: number | null;
  /** Vertical rate in ft/min. */
  vert_rate_fpm: number | null;
  category: string | null;
  type: string | null;
}

export type AlertLevel = "none" | "caution" | "warning";

export interface TrafficAssessment {
  aircraft: Aircraft;
  /** Horizontal distance from drone in nautical miles. */
  distance_nm: number;
  /** Aircraft altitude estimated in feet AGL, using ground elevation at the drone. */
  alt_agl_ft: number | null;
  /** Aircraft altitude minus drone altitude, both feet AGL. */
  alt_delta_ft: number | null;
  /** Closing speed in knots (>0 means getting closer). */
  closing_kt: number | null;
  converging: boolean;
  level: AlertLevel;
}
