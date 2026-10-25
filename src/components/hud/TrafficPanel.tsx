"use client";
import { Radar, Volume2, VolumeX } from "lucide-react";
import { CAUTION_RADIUS_NM, WARNING_RADIUS_NM } from "@/lib/adsb";
import { useTelemetryStore } from "@/stores";
import { Badge, Panel } from "./ui";

export default function TrafficPanel() {
  const { assessments, adsbSource, adsbError, adsbEnabled, audio, groundMslFt, set } = useTelemetryStore();
  const near = assessments.filter((a) => a.distance_nm <= 15).slice(0, 12);
  const warnings = assessments.filter((a) => a.level === "warning").length;
  const cautions = assessments.filter((a) => a.level === "caution").length;
  return (
    <Panel
      title="ADS-B Traffic"
      icon={<Radar size={14} />}
      right={
        <div className="flex items-center gap-2">
          <button onClick={() => set({ audio: !audio })} className="text-slate-400 hover:text-cyan-300" title="Audio callouts">
            {audio ? <Volume2 size={14} /> : <VolumeX size={14} />}
          </button>
          <label className="flex items-center gap-1 text-[10px] text-slate-400">
            <input type="checkbox" className="accent-cyan-500" checked={adsbEnabled} onChange={() => set({ adsbEnabled: !adsbEnabled })} /> live
          </label>
        </div>
      }
      className={warnings ? "ring-2 ring-red-500/70" : ""}
    >
      <div className="flex flex-wrap gap-1.5">
        <Badge tone={warnings ? "danger" : "muted"}>{warnings} warning</Badge>
        <Badge tone={cautions ? "caution" : "muted"}>{cautions} caution</Badge>
        <Badge tone="muted">{assessments.length} in 15 NM</Badge>
      </div>
      {adsbError && <p className="text-xs text-amber-300">{adsbError}</p>}
      <table className="w-full font-mono text-[11px]">
        <thead className="text-slate-500">
          <tr><th className="text-left">ID</th><th>NM</th><th>ft AGL</th><th>Δalt</th><th>kt</th><th>V/S</th></tr>
        </thead>
        <tbody>
          {near.map((a) => (
            <tr key={a.aircraft.hex} className={a.level === "warning" ? "text-red-300" : a.level === "caution" ? "text-amber-300" : "text-slate-300"}>
              <td className="truncate pr-1">{a.aircraft.callsign ?? a.aircraft.hex}{a.aircraft.type ? <span className="text-slate-500"> {a.aircraft.type}</span> : null}</td>
              <td className="text-center">{a.distance_nm.toFixed(1)}</td>
              <td className="text-center">{a.aircraft.onGround ? "GND" : a.alt_agl_ft ?? "—"}</td>
              <td className="text-center">{a.alt_delta_ft !== null ? (a.alt_delta_ft > 0 ? "+" : "") + a.alt_delta_ft : "—"}</td>
              <td className="text-center">{a.aircraft.gs_kt !== null ? Math.round(a.aircraft.gs_kt) : "—"}{a.converging ? "▸" : ""}</td>
              <td className="text-center">{a.aircraft.vert_rate_fpm ?? "—"}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="text-[10px] text-slate-500">
        Caution: &lt;{CAUTION_RADIUS_NM} NM & &lt;1,500 ft AGL · Warning: &lt;{WARNING_RADIUS_NM} NM, low, converging. AGL uses ground elevation {groundMslFt ?? "?"} ft MSL at the drone. Source: {adsbSource ?? "—"}. Not all aircraft broadcast ADS-B — maintain see-and-avoid.
      </p>
    </Panel>
  );
}
