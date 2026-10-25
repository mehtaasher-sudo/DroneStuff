"use client";
import "maplibre-gl/dist/maplibre-gl.css";
import { setWorkerUrl } from "maplibre-gl";
import { useCallback, useMemo, useRef } from "react";
import Map, { Layer, Marker, NavigationControl, ScaleControl, Source, type MapLayerMouseEvent, type MapRef } from "react-map-gl/maplibre";
import type { FeatureCollection } from "geojson";
import { Navigation, Plane } from "lucide-react";
import { useAirspaceStore, useMissionStore, useTelemetryStore } from "@/stores";
import { MAX_BBOX_SPAN_DEG } from "@/lib/bbox";

setWorkerUrl("/maplibre/maplibre-gl-worker.mjs");

const STYLE = process.env.NEXT_PUBLIC_MAP_STYLE || "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json";

/** UASFM ceiling → fill color (ft AGL). */
const ceilingColor: unknown = [
  "step", ["to-number", ["get", "CEILING"]],
  "#ef4444", 50, "#f97316", 100, "#f59e0b", 200, "#eab308", 300, "#84cc16", 400, "#22c55e",
];

export default function MapView({ onViewport }: { onViewport: (b: [number, number, number, number], center: [number, number]) => void }) {
  const mapRef = useRef<MapRef>(null);
  const { drawing, draft, parcel, waypoints, checks, addVertex, finishDraft } = useMissionStore();
  const { uasfm, classAirspace, layers } = useAirspaceStore();
  const { assessments, dronePos } = useTelemetryStore();

  const emitViewport = useCallback(() => {
    const m = mapRef.current?.getMap();
    if (!m) return;
    const b = m.getBounds();
    const c = m.getCenter();
    onViewport([b.getWest(), b.getSouth(), b.getEast(), b.getNorth()], [c.lng, c.lat]);
  }, [onViewport]);

  const onClick = (e: MapLayerMouseEvent) => {
    if (drawing) addVertex([e.lngLat.lng, e.lngLat.lat]);
  };

  const draftFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: draft.length
      ? [
          { type: "Feature", properties: {}, geometry: { type: "LineString", coordinates: draft.length > 2 ? [...draft, draft[0]] : draft } },
          ...draft.map((p) => ({ type: "Feature" as const, properties: {}, geometry: { type: "Point" as const, coordinates: p } })),
        ]
      : [],
  }), [draft]);

  const routeFc = useMemo<FeatureCollection>(() => ({
    type: "FeatureCollection",
    features: [
      ...(waypoints.length > 1
        ? [{ type: "Feature" as const, properties: {}, geometry: { type: "LineString" as const, coordinates: waypoints.map((w) => [w.lon, w.lat]) } }]
        : []),
      ...waypoints.map((w, i) => ({
        type: "Feature" as const,
        properties: { i: i + 1, violation: checks[i]?.violation ?? false, alt: w.alt_agl },
        geometry: { type: "Point" as const, coordinates: [w.lon, w.lat] },
      })),
    ],
  }), [waypoints, checks]);

  return (
    <Map
      ref={mapRef}
      initialViewState={{ longitude: -77.0369, latitude: 38.8977, zoom: 13 }}
      mapStyle={STYLE}
      onLoad={() => emitViewport()}
      onMoveEnd={emitViewport}
      onClick={onClick}
      onDblClick={(e) => {
        if (drawing) {
          e.preventDefault();
          finishDraft();
        }
      }}
      doubleClickZoom={!drawing}
      cursor={drawing ? "crosshair" : "grab"}
      style={{ position: "absolute", inset: 0 }}
      attributionControl={{ compact: true }}
    >
      <NavigationControl position="bottom-right" />
      <ScaleControl position="bottom-right" unit="imperial" />

      {layers.classAirspace && classAirspace && (
        <Source id="class" type="geojson" data={classAirspace}>
          <Layer id="class-fill" type="fill" paint={{ "fill-color": "#3b82f6", "fill-opacity": 0.06 }} />
          <Layer id="class-line" type="line" paint={{ "line-color": "#60a5fa", "line-width": 1.5, "line-dasharray": [3, 2] }} />
        </Source>
      )}

      {layers.uasfm && uasfm && (
        <Source id="uasfm" type="geojson" data={uasfm}>
          <Layer id="uasfm-fill" type="fill" paint={{ "fill-color": ceilingColor as never, "fill-opacity": 0.22 }} />
          <Layer id="uasfm-line" type="line" paint={{ "line-color": ceilingColor as never, "line-width": 0.6, "line-opacity": 0.7 }} />
          <Layer id="uasfm-label" type="symbol" minzoom={13}
            layout={{ "text-field": ["to-string", ["get", "CEILING"]], "text-size": 11, "text-font": ["Open Sans Bold", "Noto Sans Bold"] }}
            paint={{ "text-color": "#f8fafc", "text-halo-color": "#020617", "text-halo-width": 1.2 }} />
        </Source>
      )}

      {parcel && (
        <Source id="parcel" type="geojson" data={parcel}>
          <Layer id="parcel-fill" type="fill" paint={{ "fill-color": "#22d3ee", "fill-opacity": 0.08 }} />
          <Layer id="parcel-line" type="line" paint={{ "line-color": "#22d3ee", "line-width": 2 }} />
        </Source>
      )}

      <Source id="draft" type="geojson" data={draftFc}>
        <Layer id="draft-line" type="line" filter={["==", "$type", "LineString"]} paint={{ "line-color": "#22d3ee", "line-width": 2, "line-dasharray": [2, 1] }} />
        <Layer id="draft-pts" type="circle" filter={["==", "$type", "Point"]} paint={{ "circle-radius": 4, "circle-color": "#22d3ee" }} />
      </Source>

      {layers.waypoints && (
        <Source id="route" type="geojson" data={routeFc}>
          <Layer id="route-line" type="line" filter={["==", "$type", "LineString"]} paint={{ "line-color": "#34d399", "line-width": 1.5 }} />
          <Layer id="route-pts" type="circle" filter={["==", "$type", "Point"]}
            paint={{ "circle-radius": ["case", ["get", "violation"], 6, 3.5], "circle-color": ["case", ["get", "violation"], "#ef4444", "#34d399"], "circle-stroke-color": "#020617", "circle-stroke-width": 1 }} />
        </Source>
      )}

      {layers.traffic && assessments.map((a) => (
        <Marker key={a.aircraft.hex} longitude={a.aircraft.lon} latitude={a.aircraft.lat} anchor="center">
          <div className="flex flex-col items-center pointer-events-none">
            <Plane
              size={20}
              style={{ transform: `rotate(${(a.aircraft.track ?? 0) - 45}deg)` }}
              className={a.level === "warning" ? "text-red-500 animate-pulse" : a.level === "caution" ? "text-amber-400" : "text-sky-300"}
              fill="currentColor"
            />
            <span className="mt-0.5 rounded bg-slate-950/80 px-1 font-mono text-[10px] leading-tight text-slate-200">
              {a.aircraft.callsign ?? a.aircraft.hex}
              {a.alt_agl_ft !== null ? ` ${Math.round(a.alt_agl_ft / 100).toString().padStart(3, "0")}` : ""}
              {a.aircraft.vert_rate_fpm ? (a.aircraft.vert_rate_fpm > 200 ? "↑" : a.aircraft.vert_rate_fpm < -200 ? "↓" : "") : ""}
            </span>
          </div>
        </Marker>
      ))}

      {dronePos && (
        <Marker longitude={dronePos.lon} latitude={dronePos.lat} anchor="center">
          <div className="rounded-full border-2 border-cyan-300 bg-cyan-500/30 p-1 shadow-[0_0_12px_#22d3ee]">
            <Navigation size={14} className="text-cyan-200" fill="currentColor" />
          </div>
        </Marker>
      )}

      {drawing && (
        <div className="absolute left-1/2 top-16 -translate-x-1/2 rounded-md border border-cyan-500/40 bg-slate-950/85 px-3 py-1.5 text-xs text-cyan-200">
          Click to add vertices · double-click to finish ({draft.length} pts) · zoom ≥ 11 with span ≤ {MAX_BBOX_SPAN_DEG}° to load airspace
        </div>
      )}
    </Map>
  );
}
