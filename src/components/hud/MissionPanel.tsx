"use client";
import { useCallback, useEffect, useState } from "react";
import { Download, Loader2, Map as MapIcon, Pencil, Route, Save, Trash2 } from "lucide-react";
import { generateSurvey } from "@/lib/survey";
import { DJI_DRONES, toDjiKmz, toLitchiCsv, toQgcPlan } from "@/lib/exporters";
import type { Waypoint } from "@/lib/types";
import { useAirspaceStore, useMissionStore } from "@/stores";
import { getJson } from "../useLiveData";
import { download } from "./download";
import { Badge, Btn, Field, inputCls, Panel, Stat } from "./ui";

interface SavedMission { id: string; name: string; waypoints: Waypoint[]; altAglFt: number; area: never; updatedAt: string; laancId?: string | null }

export default function MissionPanel() {
  const m = useMissionStore();
  const submission = useAirspaceStore((s) => s.submission);
  const precheck = useAirspaceStore((s) => s.precheck);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [name, setName] = useState("Survey mission");
  const [drone, setDrone] = useState<number>(DJI_DRONES["Mavic 3 Enterprise"]);
  const [saved, setSaved] = useState<SavedMission[]>([]);

  const refresh = useCallback(() => getJson<SavedMission[]>("/api/missions").then(setSaved).catch(() => setSaved([])), []);
  useEffect(() => {
    refresh();
  }, [refresh]);

  const s = m.settings;
  const violations = m.checks.filter((c) => c.violation).length;
  const opts = { photo_interval_m: m.stats?.photo_interval_m, home_terrain_msl: m.homeTerrainMsl, mission_name: name };

  const generate = async () => {
    if (!m.parcel) return;
    setBusy(true);
    setErr(null);
    try {
      const r = generateSurvey({
        ring: m.parcel.geometry.coordinates[0] as [number, number][],
        pattern: s.pattern, alt_agl_ft: s.alt_agl_ft, front_overlap: s.front_overlap, side_overlap: s.side_overlap,
        gimbal_pitch: s.gimbal_pitch, line_angle_deg: s.line_angle_deg ?? undefined,
      });
      let home: number | undefined;
      try {
        const e = await getJson<{ elevation_ft: number[] }>("/api/elevation", {
          method: "POST", headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ points: r.waypoints.map((w) => ({ lat: w.lat, lon: w.lon })) }),
        });
        r.waypoints.forEach((w, i) => (w.terrain_msl = e.elevation_ft[i]));
        home = e.elevation_ft[0];
      } catch (e) {
        setErr(`Terrain unavailable (${(e as Error).message}); altitudes are relative to takeoff.`);
      }
      m.setPlan({ waypoints: r.waypoints, stats: r.stats, homeTerrainMsl: home });
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  const save = async () => {
    try {
      await getJson("/api/missions", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, area: m.parcel, waypoints: m.waypoints, altAglFt: Math.min(400, Math.round(s.alt_agl_ft)), pattern: s.pattern,
          laancStatus: precheck?.status, laancId: submission?.reference }),
      });
      refresh();
    } catch (e) {
      setErr((e as Error).message);
    }
  };

  const terrain = m.waypoints.map((w) => w.terrain_msl).filter((t): t is number => t !== undefined);
  const file = name.replace(/[^\w-]+/g, "_");

  return (
    <div className="space-y-3">
      <Panel title="Operating Area" icon={<MapIcon size={14} />}>
        <div className="flex gap-2">
          <Btn tone={m.drawing ? "success" : "primary"} onClick={() => (m.drawing ? m.finishDraft() : m.setDrawing(true))}>
            <Pencil size={12} /> {m.drawing ? `Finish (${m.draft.length})` : m.parcel ? "Redraw area" : "Draw area"}
          </Btn>
          <Btn disabled={!m.parcel && !m.draft.length} onClick={m.clearParcel}><Trash2 size={12} /> Clear</Btn>
        </div>
      </Panel>

      <Panel title="Survey Grid" icon={<Route size={14} />}>
        <div className="grid grid-cols-2 gap-2">
          <Field label="Pattern">
            <select className={inputCls} value={s.pattern} onChange={(e) => m.setSettings({ pattern: e.target.value as never })}>
              <option value="lawnmower">Lawnmower</option>
              <option value="crosshatch">Crosshatch</option>
            </select>
          </Field>
          <Field label="Altitude (ft AGL)">
            <input type="number" min={20} max={400} className={inputCls} value={s.alt_agl_ft} onChange={(e) => m.setSettings({ alt_agl_ft: Number(e.target.value) })} />
          </Field>
          <Field label="Front overlap %">
            <input type="number" min={0} max={95} className={inputCls} value={Math.round(s.front_overlap * 100)} onChange={(e) => m.setSettings({ front_overlap: Number(e.target.value) / 100 })} />
          </Field>
          <Field label="Side overlap %">
            <input type="number" min={0} max={95} className={inputCls} value={Math.round(s.side_overlap * 100)} onChange={(e) => m.setSettings({ side_overlap: Number(e.target.value) / 100 })} />
          </Field>
          <Field label="Gimbal pitch °">
            <input type="number" min={-90} max={0} className={inputCls} value={s.gimbal_pitch} onChange={(e) => m.setSettings({ gimbal_pitch: Number(e.target.value) })} />
          </Field>
          <Field label="Line angle °T" hint="blank = longest edge">
            <input type="number" min={0} max={359} className={inputCls} value={s.line_angle_deg ?? ""} onChange={(e) => m.setSettings({ line_angle_deg: e.target.value === "" ? null : Number(e.target.value) })} />
          </Field>
        </div>
        <Btn tone="primary" disabled={!m.parcel || busy} onClick={generate}>
          {busy && <Loader2 size={12} className="animate-spin" />} Generate waypoints
        </Btn>
        {err && <p className="text-xs text-amber-300">{err}</p>}
        {m.stats && (
          <>
            <div className="grid grid-cols-3 gap-1.5">
              <Stat label="Waypoints" value={m.waypoints.length} />
              <Stat label="GSD" value={m.stats.gsd_cm_px} unit="cm/px" />
              <Stat label="Lines" value={m.stats.lines} />
              <Stat label="Spacing" value={m.stats.line_spacing_m} unit="m" />
              <Stat label="Photo every" value={m.stats.photo_interval_m} unit="m" />
              <Stat label="Photos" value={`~${m.stats.est_photos}`} />
              <Stat label="Distance" value={(m.stats.distance_m / 1000).toFixed(2)} unit="km" />
              <Stat label="Flight time" value={Math.round(m.stats.est_flight_time_s / 60)} unit="min" />
              <Stat label="Terrain" value={terrain.length ? `${Math.min(...terrain)}–${Math.max(...terrain)}` : "—"} unit="ft MSL" />
            </div>
            {violations > 0 ? (
              <div className="rounded-md border border-red-600/60 bg-red-950/50 p-2 text-xs text-red-200">
                <b>{violations} waypoint(s) exceed the UASFM ceiling.</b>
                <ul className="mt-1 max-h-24 list-disc overflow-y-auto pl-4">
                  {m.checks.filter((c) => c.violation).slice(0, 20).map((c) => <li key={c.index}>WP {c.index + 1}: {c.message}</li>)}
                </ul>
              </div>
            ) : m.checks.length ? (
              <Badge tone="ok">All waypoints within UASFM / Part 107 limits</Badge>
            ) : (
              <Badge tone="muted">Load airspace to validate</Badge>
            )}
          </>
        )}
      </Panel>

      {m.waypoints.length > 0 && (
        <Panel title="Waypoints & Export" icon={<Download size={14} />}>
          <div className="max-h-48 overflow-y-auto rounded border border-slate-800">
            <table className="w-full font-mono text-[11px]">
              <thead className="sticky top-0 bg-slate-900 text-slate-400">
                <tr><th className="px-1 text-left">#</th><th>ft AGL</th><th>hdg</th><th>ceil</th><th>act</th></tr>
              </thead>
              <tbody>
                {m.waypoints.map((w, i) => {
                  const c = m.checks[i];
                  return (
                    <tr key={i} className={c?.violation ? "bg-red-950/60 text-red-200" : "odd:bg-slate-900/40"}>
                      <td className="px-1">{i + 1}</td>
                      <td className="text-center">
                        <input type="number" className="w-14 bg-transparent text-center outline-none" value={w.alt_agl}
                          onChange={(e) => m.updateWaypoint(i, { alt_agl: Number(e.target.value) })} />
                      </td>
                      <td className="text-center">{w.heading}</td>
                      <td className="text-center">{c?.ceiling_ft ?? "—"}</td>
                      <td className="text-center">{w.action}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <Field label="Mission name">
            <input className={inputCls} value={name} onChange={(e) => setName(e.target.value)} />
          </Field>
          <div className="flex flex-wrap gap-2">
            <Btn onClick={() => download(`${file}.csv`, toLitchiCsv(m.waypoints, opts), "text/csv")} title={m.waypoints.length > 99 ? "Litchi supports up to 99 waypoints" : ""}>
              Litchi CSV {m.waypoints.length > 99 && <Badge tone="caution">&gt;99</Badge>}
            </Btn>
            <Btn onClick={() => download(`${file}.plan`, JSON.stringify(toQgcPlan(m.waypoints, opts), null, 2), "application/json")}>QGC .plan</Btn>
            <Btn onClick={async () => download(`${file}.kmz`, await toDjiKmz(m.waypoints, { ...opts, drone_enum: drone }))}>DJI WPML .kmz</Btn>
          </div>
          <Field label="DJI aircraft (WPML droneEnumValue)">
            <select className={inputCls} value={drone} onChange={(e) => setDrone(Number(e.target.value))}>
              {Object.entries(DJI_DRONES).map(([k, v]) => <option key={k} value={v}>{k} ({v})</option>)}
            </select>
          </Field>
          <Btn tone="success" onClick={save}><Save size={12} /> Save mission</Btn>
        </Panel>
      )}

      {saved.length > 0 && (
        <Panel title="Saved Missions">
          <ul className="space-y-1 text-xs">
            {saved.map((sm) => (
              <li key={sm.id} className="flex items-center justify-between gap-2 rounded bg-slate-900/70 px-2 py-1">
                <button className="truncate text-left hover:text-cyan-300" onClick={() => {
                  if (sm.area) useMissionStore.setState({ parcel: sm.area });
                  m.setPlan({ waypoints: sm.waypoints, stats: null });
                  setName(sm.name);
                }}>
                  {sm.name} <span className="text-slate-500">· {sm.waypoints.length} wp · {sm.altAglFt} ft</span>
                </button>
                <button className="text-slate-500 hover:text-red-400" onClick={() => fetch(`/api/missions/${sm.id}`, { method: "DELETE" }).then(refresh)}>
                  <Trash2 size={12} />
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
