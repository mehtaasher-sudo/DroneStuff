"use client";
import { create } from "zustand";
import type { Feature, FeatureCollection, Polygon } from "geojson";
import type { WaypointCheck, LaancPrecheck } from "@/lib/laanc";
import type { LaancSubmission } from "@/lib/laanc-provider";
import type { SurveyPattern, SurveyResult } from "@/lib/survey";
import type { TelemetryFrame } from "@/lib/telemetry";
import type { Aircraft, TrafficAssessment, UasfmCollection, Waypoint } from "@/lib/types";
import type { MetarSummary, WindsAloft } from "@/lib/weather";

export interface SurveySettings {
  pattern: SurveyPattern;
  alt_agl_ft: number;
  front_overlap: number;
  side_overlap: number;
  gimbal_pitch: number;
  line_angle_deg: number | null;
}

interface MissionState {
  drawing: boolean;
  draft: [number, number][];
  parcel: Feature<Polygon> | null;
  settings: SurveySettings;
  waypoints: Waypoint[];
  stats: SurveyResult["stats"] | null;
  checks: WaypointCheck[];
  homeTerrainMsl?: number;
  setDrawing: (v: boolean) => void;
  addVertex: (p: [number, number]) => void;
  finishDraft: () => void;
  clearParcel: () => void;
  setSettings: (s: Partial<SurveySettings>) => void;
  setPlan: (p: { waypoints: Waypoint[]; stats: SurveyResult["stats"] | null; checks?: WaypointCheck[]; homeTerrainMsl?: number }) => void;
  setChecks: (c: WaypointCheck[]) => void;
  updateWaypoint: (i: number, wp: Partial<Waypoint>) => void;
}

export const useMissionStore = create<MissionState>((set, get) => ({
  drawing: false,
  draft: [],
  parcel: null,
  settings: { pattern: "lawnmower", alt_agl_ft: 200, front_overlap: 0.75, side_overlap: 0.7, gimbal_pitch: -90, line_angle_deg: null },
  waypoints: [],
  stats: null,
  checks: [],
  setDrawing: (drawing) => set({ drawing, draft: drawing ? [] : get().draft }),
  addVertex: (p) => set({ draft: [...get().draft, p] }),
  finishDraft: () => {
    const d = get().draft;
    if (d.length < 3) return set({ drawing: false, draft: [] });
    set({
      drawing: false,
      draft: [],
      parcel: { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [[...d, d[0]]] } },
      waypoints: [],
      stats: null,
      checks: [],
    });
  },
  clearParcel: () => set({ parcel: null, draft: [], waypoints: [], stats: null, checks: [] }),
  setSettings: (s) => set({ settings: { ...get().settings, ...s } }),
  setPlan: ({ waypoints, stats, checks = [], homeTerrainMsl }) => set({ waypoints, stats, checks, homeTerrainMsl }),
  setChecks: (checks) => set({ checks }),
  updateWaypoint: (i, wp) => set({ waypoints: get().waypoints.map((w, k) => (k === i ? { ...w, ...wp } : w)) }),
}));

export type LayerKey = "uasfm" | "classAirspace" | "traffic" | "waypoints";

interface AirspaceState {
  uasfm: UasfmCollection | null;
  classAirspace: FeatureCollection | null;
  layers: Record<LayerKey, boolean>;
  loading: boolean;
  error: string | null;
  precheck: LaancPrecheck | null;
  submission: LaancSubmission | null;
  setData: (d: Partial<Pick<AirspaceState, "uasfm" | "classAirspace" | "loading" | "error">>) => void;
  toggle: (k: LayerKey) => void;
  setPrecheck: (p: LaancPrecheck | null, s?: LaancSubmission | null) => void;
}

export const useAirspaceStore = create<AirspaceState>((set, get) => ({
  uasfm: null,
  classAirspace: null,
  layers: { uasfm: true, classAirspace: true, traffic: true, waypoints: true },
  loading: false,
  error: null,
  precheck: null,
  submission: null,
  setData: (d) => set(d),
  toggle: (k) => set({ layers: { ...get().layers, [k]: !get().layers[k] } }),
  setPrecheck: (precheck, submission = null) => set({ precheck, submission }),
}));

interface TelemetryState {
  frames: TelemetryFrame[];
  t: number;
  playing: boolean;
  rate: number;
  fileName: string | null;
  /** Manual drone position when no replay is loaded (defaults to map center / parcel). */
  dronePos: { lat: number; lon: number; alt_agl_ft: number } | null;
  groundMslFt: number | null;
  aircraft: Aircraft[];
  assessments: TrafficAssessment[];
  adsbSource: string | null;
  adsbError: string | null;
  adsbEnabled: boolean;
  audio: boolean;
  set: (p: Partial<Omit<TelemetryState, "set">>) => void;
}

export const useTelemetryStore = create<TelemetryState>((set) => ({
  frames: [],
  t: 0,
  playing: false,
  rate: 1,
  fileName: null,
  dronePos: null,
  groundMslFt: null,
  aircraft: [],
  assessments: [],
  adsbSource: null,
  adsbError: null,
  adsbEnabled: true,
  audio: true,
  set: (p) => set(p),
}));

interface ChecklistState {
  checked: Record<string, boolean>;
  frat: Record<string, number>;
  metar: MetarSummary | null;
  winds: WindsAloft | null;
  kp: { kp: number; time: string } | null;
  weatherError: string | null;
  toggle: (id: string) => void;
  reset: () => void;
  setFrat: (id: string, v: number) => void;
  setWeather: (w: Partial<Pick<ChecklistState, "metar" | "winds" | "kp" | "weatherError">>) => void;
}

export const useChecklistStore = create<ChecklistState>((set, get) => ({
  checked: {},
  frat: {},
  metar: null,
  winds: null,
  kp: null,
  weatherError: null,
  toggle: (id) => set({ checked: { ...get().checked, [id]: !get().checked[id] } }),
  reset: () => set({ checked: {}, frat: {} }),
  setFrat: (id, v) => set({ frat: { ...get().frat, [id]: v } }),
  setWeather: (w) => set(w),
}));
