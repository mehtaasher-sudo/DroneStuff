"use client";
import { useCallback, useEffect, useRef } from "react";
import { bearing, centroid } from "@turf/turf";
import { assessAll } from "@/lib/adsb";
import { MAX_BBOX_SPAN_DEG } from "@/lib/bbox";
import { validateWaypoints } from "@/lib/laanc";
import { frameAt } from "@/lib/telemetry";
import { useAirspaceStore, useChecklistStore, useMissionStore, useTelemetryStore } from "@/stores";

async function getJson<T>(url: string, init?: RequestInit): Promise<T> {
  const res = await fetch(url, init);
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error ?? `HTTP ${res.status}`);
  return body as T;
}
export { getJson };

/** Loads UASFM + class airspace for the current viewport (debounced, skipped when zoomed out too far). */
export function useAirspaceSync() {
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const centerRef = useRef<[number, number] | null>(null);
  const onViewport = useCallback((b: [number, number, number, number], center: [number, number]) => {
    centerRef.current = center;
    const tel = useTelemetryStore.getState();
    if (!tel.frames.length && !useMissionStore.getState().parcel) {
      tel.set({ dronePos: { lat: center[1], lon: center[0], alt_agl_ft: tel.dronePos?.alt_agl_ft ?? 0 } });
    }
    if (timer.current) clearTimeout(timer.current);
    timer.current = setTimeout(async () => {
      const set = useAirspaceStore.getState().setData;
      if (b[2] - b[0] > MAX_BBOX_SPAN_DEG || b[3] - b[1] > MAX_BBOX_SPAN_DEG) {
        set({ error: "Zoom in to load FAA airspace layers" });
        return;
      }
      set({ loading: true, error: null });
      const q = `bbox=${b.map((n) => n.toFixed(5)).join(",")}`;
      const [u, c] = await Promise.allSettled([getJson(`/api/airspace/uasfm?${q}`), getJson(`/api/airspace/class?${q}`)]);
      set({
        loading: false,
        uasfm: u.status === "fulfilled" ? (u.value as never) : useAirspaceStore.getState().uasfm,
        classAirspace: c.status === "fulfilled" ? (c.value as never) : useAirspaceStore.getState().classAirspace,
        error: [u, c].filter((r) => r.status === "rejected").map((r) => (r as PromiseRejectedResult).reason.message).join(" · ") || null,
      });
    }, 400);
  }, []);
  return { onViewport, centerRef };
}

/** Re-validates every waypoint against the loaded UASFM cells whenever either changes. */
export function useWaypointValidation() {
  const waypoints = useMissionStore((s) => s.waypoints);
  const uasfm = useAirspaceStore((s) => s.uasfm);
  useEffect(() => {
    if (!uasfm || !waypoints.length) return;
    useMissionStore.getState().setChecks(validateWaypoints(waypoints, uasfm));
  }, [waypoints, uasfm]);
}

/** Keeps the drone position on the parcel centroid when no telemetry is loaded, and fetches ground elevation there. */
export function useDroneAnchor() {
  const parcel = useMissionStore((s) => s.parcel);
  const alt = useMissionStore((s) => s.settings.alt_agl_ft);
  const frames = useTelemetryStore((s) => s.frames);
  useEffect(() => {
    if (!parcel || frames.length) return;
    const [lon, lat] = centroid(parcel).geometry.coordinates;
    useTelemetryStore.getState().set({ dronePos: { lat, lon, alt_agl_ft: alt } });
  }, [parcel, alt, frames.length]);

  const pos = useTelemetryStore((s) => s.dronePos);
  const key = pos ? `${pos.lat.toFixed(2)},${pos.lon.toFixed(2)}` : null;
  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(",").map(Number);
    getJson<{ elevation_ft: number[] }>("/api/elevation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ points: [{ lat, lon }] }),
    })
      .then((r) => useTelemetryStore.getState().set({ groundMslFt: r.elevation_ft[0] }))
      .catch(() => useTelemetryStore.getState().set({ groundMslFt: null }));
  }, [key]);
}

const speak = (text: string) => {
  if (typeof window === "undefined" || !("speechSynthesis" in window)) return;
  window.speechSynthesis.cancel();
  window.speechSynthesis.speak(new SpeechSynthesisUtterance(text));
};

/** Polls ADS-B traffic within `radiusNm` of the drone every `intervalMs` and computes proximity alerts. */
export function useAdsbPolling(radiusNm = 15, intervalMs = 4000) {
  const announced = useRef<Set<string>>(new Set());
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      const s = useTelemetryStore.getState();
      if (!s.adsbEnabled || !s.dronePos) return;
      try {
        const r = await getJson<{ source: string; aircraft: never[] }>(
          `/api/adsb?lat=${s.dronePos.lat.toFixed(4)}&lon=${s.dronePos.lon.toFixed(4)}&radius=${radiusNm}`,
        );
        if (stop) return;
        const cur = useTelemetryStore.getState();
        const drone = { ...cur.dronePos!, ground_msl_ft: cur.groundMslFt ?? 0 };
        const assessments = assessAll(r.aircraft, drone);
        cur.set({ aircraft: r.aircraft, assessments, adsbSource: r.source, adsbError: null });
        for (const a of assessments.filter((x) => x.level === "warning")) {
          if (cur.audio && !announced.current.has(a.aircraft.hex)) {
            const brg = (bearing([drone.lon, drone.lat], [a.aircraft.lon, a.aircraft.lat]) + 360) % 360;
            const dir = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"][Math.round(brg / 45) % 8];
            speak(`Traffic, traffic. ${a.aircraft.callsign ?? "Aircraft"}, ${dir}, ${a.distance_nm.toFixed(1)} miles, ${a.alt_agl_ft ?? "unknown"} feet, converging.`);
          }
          announced.current.add(a.aircraft.hex);
        }
        const warned = new Set(assessments.filter((x) => x.level === "warning").map((x) => x.aircraft.hex));
        for (const hex of announced.current) if (!warned.has(hex)) announced.current.delete(hex);
      } catch (e) {
        if (!stop) useTelemetryStore.getState().set({ adsbError: (e as Error).message });
      }
    };
    tick();
    const id = setInterval(tick, intervalMs);
    return () => {
      stop = true;
      clearInterval(id);
    };
  }, [radiusNm, intervalMs]);
}

/** Drives telemetry replay in real time (× rate) and moves the drone marker. */
export function useTelemetryPlayback() {
  const playing = useTelemetryStore((s) => s.playing);
  useEffect(() => {
    if (!playing) return;
    let last = performance.now();
    let raf = 0;
    const loop = (now: number) => {
      const s = useTelemetryStore.getState();
      const end = s.frames.at(-1)?.t_ms ?? 0;
      const t = Math.min(end, s.t + (now - last) * s.rate);
      last = now;
      const f = frameAt(s.frames, t);
      s.set({ t, playing: t < end, dronePos: f ? { lat: f.lat, lon: f.lon, alt_agl_ft: Math.round(f.alt_ft) } : s.dronePos });
      if (t < end) raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [playing]);
}

/** Fetches METAR / winds aloft / Kp for the drone area every 10 minutes. */
export function useWeather() {
  const pos = useTelemetryStore((s) => s.dronePos);
  const key = pos ? `${pos.lat.toFixed(1)},${pos.lon.toFixed(1)}` : null;
  useEffect(() => {
    if (!key) return;
    const [lat, lon] = key.split(",").map(Number);
    const load = () =>
      getJson<{ metar: never; winds: never; kp: never; errors: string[] }>(`/api/weather?lat=${lat}&lon=${lon}`)
        .then((w) => useChecklistStore.getState().setWeather({ metar: w.metar, winds: w.winds, kp: w.kp, weatherError: w.errors.join(" · ") || null }))
        .catch((e) => useChecklistStore.getState().setWeather({ weatherError: e.message }));
    load();
    const id = setInterval(load, 600_000);
    return () => clearInterval(id);
  }, [key]);
}
