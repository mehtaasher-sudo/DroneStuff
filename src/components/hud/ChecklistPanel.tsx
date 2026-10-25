"use client";
import { CheckSquare, Lock, RotateCcw, Rocket } from "lucide-react";
import { DEFAULT_CHECKLIST, FRAT_FACTORS, fratScore, launchGate, type ChecklistItem } from "@/lib/checklist";
import { weatherFlags } from "@/lib/weather";
import { useAirspaceStore, useChecklistStore } from "@/stores";
import { Badge, Btn, inputCls, Panel } from "./ui";

export function useLaunchGate() {
  const { checked, metar, winds, kp } = useChecklistStore();
  const noGo = weatherFlags(metar, winds, kp?.kp ?? null).some((f) => f.level === "nogo");
  return launchGate(DEFAULT_CHECKLIST, checked, noGo);
}

export default function ChecklistPanel() {
  const { checked, toggle, reset, frat, setFrat, metar, winds, kp } = useChecklistStore();
  const precheck = useAirspaceStore((s) => s.precheck);
  const submission = useAirspaceStore((s) => s.submission);
  const gate = useLaunchGate();
  const score = fratScore(frat);

  const autofill = (k: ChecklistItem["autofill"]): string | null => {
    switch (k) {
      case "metar_wind": return metar ? `${metar.station} ${metar.wind_dir_deg ?? ""}@${metar.wind_kt ?? "—"}${metar.gust_kt ? `G${metar.gust_kt}` : ""} kt` : null;
      case "metar_vis": return metar?.visibility_sm != null ? `${metar.visibility_sm}${metar.visibility_plus ? "+" : ""} SM` : null;
      case "metar_ceiling": return metar ? (metar.ceiling_ft_agl ? `${metar.ceiling_ft_agl} ft` : "No ceiling") : null;
      case "kp": return kp ? `Kp ${kp.kp}` : null;
      case "winds_aloft": return winds ? `${winds.wind_80m_kt ?? "—"} / ${winds.wind_120m_kt ?? "—"} kt` : null;
      case "laanc": return submission ? `${submission.reference}${submission.simulated ? " (sim)" : ""}` : precheck ? precheck.status.replace(/_/g, " ") : null;
      default: return null;
    }
  };

  return (
    <div className="space-y-3">
      <Panel
        title="Launch Gate"
        icon={<Rocket size={14} />}
        right={<Btn onClick={reset} title="Reset checklist"><RotateCcw size={12} /></Btn>}
      >
        <div className={`flex items-center justify-center gap-2 rounded-lg py-2 text-sm font-bold tracking-wider ${gate.ready ? "bg-emerald-600/80 text-white" : "bg-slate-800 text-slate-400"}`}>
          {gate.ready ? <Rocket size={16} /> : <Lock size={16} />} {gate.ready ? "READY TO LAUNCH" : `LOCKED · ${gate.missing.length} item(s)`}
        </div>
        {gate.weatherNoGo && <p className="text-xs text-red-300">Weather below Part 107 minimums.</p>}
      </Panel>

      {DEFAULT_CHECKLIST.map((sec) => {
        const done = sec.items.filter((i) => checked[i.id]).length;
        return (
          <Panel key={sec.phase} title={sec.title} icon={<CheckSquare size={14} />} right={<Badge tone={done === sec.items.length ? "ok" : "muted"}>{done}/{sec.items.length}</Badge>}>
            <ul className="space-y-1">
              {sec.items.map((it) => {
                const af = autofill(it.autofill);
                return (
                  <li key={it.id}>
                    <label className="flex cursor-pointer items-start gap-2 text-xs">
                      <input type="checkbox" className="mt-0.5 accent-emerald-500" checked={!!checked[it.id]} onChange={() => toggle(it.id)} />
                      <span className={checked[it.id] ? "text-slate-500 line-through" : ""}>
                        {it.label}
                        {it.mandatory && sec.gatesLaunch && <span className="ml-1 text-red-400">*</span>}
                        {af && <span className="ml-1.5 rounded bg-slate-800 px-1 font-mono text-[10px] text-cyan-300">{af}</span>}
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </Panel>
        );
      })}

      <Panel title="Flight Risk Assessment (FRAT)" right={<Badge tone={score.level === "low" ? "ok" : score.level === "medium" ? "caution" : "danger"}>{score.total}/{score.max} {score.level}</Badge>}>
        {FRAT_FACTORS.map((f) => (
          <label key={f.id} className="grid grid-cols-[1fr_1.4fr] items-center gap-2 text-xs">
            <span className="text-slate-400">{f.label}</span>
            <select className={inputCls} value={frat[f.id] ?? 0} onChange={(e) => setFrat(f.id, Number(e.target.value))}>
              {f.options.map((o, i) => <option key={o} value={i}>{i} · {o}</option>)}
            </select>
          </label>
        ))}
      </Panel>
    </div>
  );
}
