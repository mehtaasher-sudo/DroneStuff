"use client";
import { CloudSun } from "lucide-react";
import { weatherFlags } from "@/lib/weather";
import { useChecklistStore } from "@/stores";
import { Badge, Panel, Stat } from "./ui";

const dir = (d: number | "VRB" | null | undefined) => (d === "VRB" ? "VRB" : d === null || d === undefined ? "—" : `${String(Math.round(d)).padStart(3, "0")}°`);

export default function WeatherPanel() {
  const { metar, winds, kp, weatherError } = useChecklistStore();
  const flags = weatherFlags(metar, winds, kp?.kp ?? null);
  return (
    <Panel title="Aviation Weather" icon={<CloudSun size={14} />} right={metar?.flight_category ? <Badge tone={metar.flight_category === "VFR" ? "ok" : "caution"}>{metar.flight_category}</Badge> : null}>
      {metar ? (
        <>
          <p className="break-words font-mono text-[11px] text-emerald-300">{metar.raw}</p>
          <div className="grid grid-cols-3 gap-1.5">
            <Stat label="Wind" value={`${dir(metar.wind_dir_deg)} ${metar.wind_kt ?? "—"}${metar.gust_kt ? `G${metar.gust_kt}` : ""}`} unit="kt" />
            <Stat label="Vis" value={`${metar.visibility_sm ?? "—"}${metar.visibility_plus ? "+" : ""}`} unit="SM" />
            <Stat label="Ceiling" value={metar.ceiling_ft_agl ?? "none"} unit={metar.ceiling_ft_agl ? "ft" : ""} />
          </div>
        </>
      ) : (
        <p className="text-xs text-slate-400">No METAR within ~60 NM.</p>
      )}
      {winds && (
        <div className="grid grid-cols-3 gap-1.5">
          <Stat label="10 m" value={`${dir(winds.dir_10m)} ${winds.wind_10m_kt ?? "—"}`} unit="kt" />
          <Stat label="80 m" value={`${dir(winds.dir_80m)} ${winds.wind_80m_kt ?? "—"}`} unit="kt" />
          <Stat label="120 m" value={`${dir(winds.dir_120m)} ${winds.wind_120m_kt ?? "—"}`} unit="kt" />
        </div>
      )}
      {kp && <Stat label="Planetary Kp (NOAA SWPC)" value={kp.kp} />}
      <div className="flex flex-wrap gap-1">
        {flags.map((f) => <Badge key={f.text} tone={f.level === "ok" ? "ok" : f.level === "caution" ? "caution" : "danger"}>{f.text}</Badge>)}
      </div>
      {weatherError && <p className="text-[10px] text-amber-300">{weatherError}</p>}
    </Panel>
  );
}
