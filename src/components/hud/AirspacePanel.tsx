"use client";
import { useState } from "react";
import { Layers, Loader2, ShieldCheck } from "lucide-react";
import { useAirspaceStore, useMissionStore, type LayerKey } from "@/stores";
import { getJson } from "../useLiveData";
import { Badge, Btn, Field, inputCls, Panel } from "./ui";
import type { LaancPrecheck } from "@/lib/laanc";
import type { LaancSubmission } from "@/lib/laanc-provider";

const LAYERS: [LayerKey, string][] = [
  ["uasfm", "FAA UASFM ceilings"],
  ["classAirspace", "Class B/C/D/E airspace"],
  ["traffic", "ADS-B traffic"],
  ["waypoints", "Mission waypoints"],
];

const LEGEND = [
  ["#ef4444", "0"], ["#f97316", "50"], ["#f59e0b", "100"], ["#eab308", "200"], ["#84cc16", "300"], ["#22c55e", "400"],
];

const local = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export const statusTone = (s?: LaancPrecheck["status"]) =>
  s === "auto_approval" ? "ok" : s === "further_coordination" ? "caution" : s === "not_eligible" ? "danger" : "info";

export default function AirspacePanel() {
  const { layers, toggle, loading, error, uasfm, precheck, submission, setPrecheck } = useAirspaceStore();
  const parcel = useMissionStore((s) => s.parcel);
  const alt = useMissionStore((s) => s.settings.alt_agl_ft);
  const [target, setTarget] = useState<number | null>(null);
  const [start, setStart] = useState(() => local(new Date(Date.now() + 3600_000)));
  const [end, setEnd] = useState(() => local(new Date(Date.now() + 2 * 3600_000)));
  const [rule, setRule] = useState<"part107" | "44809">("part107");
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const run = async (submit: boolean) => {
    if (!parcel) return;
    setBusy(true);
    setErr(null);
    try {
      const r = await getJson<{ precheck: LaancPrecheck; submission?: LaancSubmission }>("/api/laanc", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          area: parcel, target_alt_agl_ft: target ?? alt, rule, submit,
          start: new Date(start).toISOString(), end: new Date(end).toISOString(),
        }),
      });
      setPrecheck(r.precheck, r.submission ?? null);
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="space-y-3">
      <Panel title="Airspace Layers" icon={<Layers size={14} />} right={loading ? <Loader2 size={14} className="animate-spin text-cyan-400" /> : uasfm ? <Badge tone="muted">{uasfm.features.length} cells</Badge> : null}>
        <div className="space-y-1.5">
          {LAYERS.map(([k, label]) => (
            <label key={k} className="flex cursor-pointer items-center gap-2 text-xs">
              <input type="checkbox" checked={layers[k]} onChange={() => toggle(k)} className="accent-cyan-500" />
              {label}
            </label>
          ))}
        </div>
        <div>
          <div className="mb-1 text-[10px] uppercase tracking-wide text-slate-500">UASFM ceiling (ft AGL)</div>
          <div className="flex gap-1">
            {LEGEND.map(([c, l]) => (
              <div key={l} className="flex-1 text-center">
                <div className="h-2 rounded-sm" style={{ background: c }} />
                <span className="font-mono text-[10px] text-slate-400">{l}</span>
              </div>
            ))}
          </div>
        </div>
        {error && <p className="text-xs text-amber-300">{error}</p>}
        <p className="text-[10px] text-slate-500">Source: FAA UAS Data Delivery System (ArcGIS). TFRs are not included — check NOTAMs/TFRs separately.</p>
      </Panel>

      <Panel title="LAANC Pre-Check" icon={<ShieldCheck size={14} />}>
        {!parcel && <p className="text-xs text-slate-400">Draw an operating area in the Mission tab first.</p>}
        <div className="grid grid-cols-2 gap-2">
          <Field label="Max altitude (ft AGL)">
            <input type="number" min={0} max={400} className={inputCls} value={target ?? alt} onChange={(e) => setTarget(Number(e.target.value))} />
          </Field>
          <Field label="Operating rule">
            <select className={inputCls} value={rule} onChange={(e) => setRule(e.target.value as never)}>
              <option value="part107">Part 107</option>
              <option value="44809">44809 (recreational)</option>
            </select>
          </Field>
          <Field label="Start (local)">
            <input type="datetime-local" className={inputCls} value={start} onChange={(e) => setStart(e.target.value)} />
          </Field>
          <Field label="End (local)">
            <input type="datetime-local" className={inputCls} value={end} onChange={(e) => setEnd(e.target.value)} />
          </Field>
        </div>
        <div className="flex gap-2">
          <Btn tone="primary" disabled={!parcel || busy} onClick={() => run(false)}>
            {busy && <Loader2 size={12} className="animate-spin" />} Run pre-check
          </Btn>
          <Btn disabled={!parcel || busy || !precheck} onClick={() => run(true)} title="Uses the configured LAANC provider (simulator by default)">
            Submit (simulator)
          </Btn>
        </div>
        {err && <p className="text-xs text-red-300">{err}</p>}
        {precheck && (
          <div className="space-y-2 rounded-md border border-slate-800 bg-slate-900/60 p-2">
            <Badge tone={statusTone(precheck.status)}>{precheck.status.replace(/_/g, " ")}</Badge>
            <p className="text-xs font-medium">{precheck.headline}</p>
            <div className="grid grid-cols-3 gap-1 font-mono text-[11px] text-slate-300">
              <span>min {precheck.min_ceiling_ft ?? "—"} ft</span>
              <span>max {precheck.max_ceiling_ft ?? "—"} ft</span>
              <span>{precheck.intersecting_cells} cells</span>
            </div>
            {precheck.airports.length > 0 && <p className="text-[11px] text-slate-400">Airports: {precheck.airports.join(", ")}</p>}
            <p className="text-[11px]">{precheck.daylight ? "☀ Daylight operation" : "☾ Night/twilight operation"}</p>
            <ul className="list-disc space-y-0.5 pl-4 text-[11px] text-slate-400">
              {precheck.notes.map((n) => <li key={n}>{n}</li>)}
            </ul>
          </div>
        )}
        {submission && (
          <div className="rounded-md border border-cyan-800 bg-cyan-950/40 p-2 text-xs">
            <div className="flex items-center gap-2">
              <Badge tone={submission.state === "approved" ? "ok" : submission.state === "rejected" ? "danger" : "caution"}>{submission.state.replace("_", " ")}</Badge>
              <span className="font-mono">{submission.reference}</span>
            </div>
            <p className="mt-1 text-slate-300">{submission.message}</p>
          </div>
        )}
      </Panel>
    </div>
  );
}
