"use client";
import { Pause, Play, Upload } from "lucide-react";
import { frameAt, parseDjiSrt, parseTelemetryCsv } from "@/lib/telemetry";
import { useTelemetryStore } from "@/stores";
import { Badge, Btn } from "./ui";

const fmt = (ms: number) => `${Math.floor(ms / 60000)}:${String(Math.floor((ms % 60000) / 1000)).padStart(2, "0")}`;

export default function TelemetryPanel() {
  const { frames, t, playing, rate, fileName, dronePos, set } = useTelemetryStore();
  const end = frames.at(-1)?.t_ms ?? 0;
  const f = frameAt(frames, t);

  const load = async (file: File) => {
    const text = await file.text();
    try {
      const fr = /\.srt$/i.test(file.name) ? parseDjiSrt(text) : parseTelemetryCsv(text);
      if (!fr.length) throw new Error("No position frames found");
      set({ frames: fr, t: 0, playing: false, fileName: file.name, dronePos: { lat: fr[0].lat, lon: fr[0].lon, alt_agl_ft: Math.round(fr[0].alt_ft) } });
    } catch (e) {
      alert(`Could not parse ${file.name}: ${(e as Error).message}`);
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-slate-700/60 bg-slate-950/80 px-3 py-2 text-xs text-slate-200 shadow-xl backdrop-blur-md">
      <label className="inline-flex cursor-pointer items-center gap-1.5 rounded-md bg-slate-800 px-2.5 py-1.5 hover:bg-slate-700">
        <Upload size={12} /> Telemetry log
        <input type="file" accept=".csv,.srt" className="hidden" onChange={(e) => e.target.files?.[0] && load(e.target.files[0])} />
      </label>
      {fileName && <Badge tone="muted">{fileName}</Badge>}
      <Btn tone="primary" disabled={!frames.length} onClick={() => set({ playing: !playing, t: t >= end ? 0 : t })}>
        {playing ? <Pause size={12} /> : <Play size={12} />}
      </Btn>
      <input type="range" min={0} max={end || 1} value={t} disabled={!frames.length} className="w-40 accent-cyan-500 sm:w-64"
        onChange={(e) => {
          const nt = Number(e.target.value);
          const fr = frameAt(frames, nt);
          set({ t: nt, dronePos: fr ? { lat: fr.lat, lon: fr.lon, alt_agl_ft: Math.round(fr.alt_ft) } : dronePos });
        }} />
      <span className="font-mono">{fmt(t)} / {fmt(end)}</span>
      <select className="rounded bg-slate-800 px-1 py-1 font-mono" value={rate} onChange={(e) => set({ rate: Number(e.target.value) })}>
        {[1, 2, 5, 10].map((r) => <option key={r} value={r}>{r}×</option>)}
      </select>
      <div className="flex gap-3 font-mono text-cyan-300">
        <span>ALT {dronePos ? `${dronePos.alt_agl_ft} ft` : "—"}</span>
        <span>SPD {f?.speed_ms !== undefined ? `${f.speed_ms.toFixed(1)} m/s` : "—"}</span>
        <span>HDG {f?.heading !== undefined ? `${Math.round(f.heading)}°` : "—"}</span>
        <span className="text-slate-400">{dronePos ? `${dronePos.lat.toFixed(5)}, ${dronePos.lon.toFixed(5)}` : ""}</span>
      </div>
    </div>
  );
}
