"use client";
import { useState } from "react";
import { Bot, Loader2, Send } from "lucide-react";
import type { AgentResult } from "@/lib/agent";
import { useMissionStore } from "@/stores";
import { getJson } from "../useLiveData";
import { Badge, Btn, inputCls, Panel } from "./ui";

const EXAMPLE =
  "Generate a 250-foot crosshatch photogrammetry grid over this parcel with 75% front/side overlap, a 35-degree gimbal pitch, and verify it clears the UASFM grid on the eastern edge.";

interface Msg { role: "user" | "assistant"; text: string; tools?: AgentResult["toolLog"] }

export default function CopilotPanel() {
  const parcel = useMissionStore((s) => s.parcel);
  const [prompt, setPrompt] = useState(EXAMPLE);
  const [msgs, setMsgs] = useState<Msg[]>([]);
  const [busy, setBusy] = useState(false);

  const send = async () => {
    if (!parcel || !prompt.trim()) return;
    const text = prompt.trim();
    setMsgs((m) => [...m, { role: "user", text }]);
    setPrompt("");
    setBusy(true);
    try {
      const r = await getJson<AgentResult>("/api/agent", {
        method: "POST", headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt: text, parcel }),
      });
      if (r.plan) {
        const p = r.plan;
        useMissionStore.getState().setSettings({
          pattern: p.params.pattern, alt_agl_ft: p.params.altitude_agl_ft, front_overlap: p.params.front_overlap,
          side_overlap: p.params.side_overlap, gimbal_pitch: p.params.gimbal_pitch,
          line_angle_deg: p.params.line_angle_deg >= 0 ? p.params.line_angle_deg : null,
        });
        useMissionStore.getState().setPlan({ waypoints: p.waypoints, stats: p.stats, checks: p.checks, homeTerrainMsl: p.home_terrain_msl });
      }
      setMsgs((m) => [...m, { role: "assistant", text: r.reply, tools: r.toolLog }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: "assistant", text: `⚠ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Panel title="AI Mission Copilot" icon={<Bot size={14} />} right={<Badge tone="muted">Claude</Badge>}>
      {!parcel && <p className="text-xs text-amber-300">Draw the parcel in the Mission tab — the copilot plans over it.</p>}
      <div className="max-h-[45vh] space-y-2 overflow-y-auto">
        {msgs.map((m, i) => (
          <div key={i} className={`rounded-lg px-2.5 py-2 text-xs leading-relaxed ${m.role === "user" ? "ml-6 bg-cyan-900/40" : "mr-2 bg-slate-900"}`}>
            <p className="whitespace-pre-wrap">{m.text}</p>
            {m.tools && m.tools.length > 0 && (
              <div className="mt-1.5 flex flex-wrap gap-1">
                {m.tools.map((t, k) => <Badge key={k} tone={t.ok ? "info" : "danger"}>{t.name}</Badge>)}
              </div>
            )}
          </div>
        ))}
        {busy && <div className="flex items-center gap-2 text-xs text-slate-400"><Loader2 size={12} className="animate-spin" /> Planning — querying airspace and terrain…</div>}
      </div>
      <textarea className={`${inputCls} h-24 resize-none font-sans`} value={prompt} onChange={(e) => setPrompt(e.target.value)}
        onKeyDown={(e) => { if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) send(); }} placeholder="Describe the mission…" />
      <Btn tone="primary" disabled={!parcel || busy || !prompt.trim()} onClick={send}><Send size={12} /> Plan mission (⌘↵)</Btn>
    </Panel>
  );
}
