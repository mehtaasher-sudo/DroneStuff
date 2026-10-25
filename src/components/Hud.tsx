"use client";
import dynamic from "next/dynamic";
import { useState } from "react";
import { AlertTriangle, Bot, ClipboardCheck, Layers, Lock, Plane, Rocket, Route } from "lucide-react";
import { useAirspaceStore, useTelemetryStore } from "@/stores";
import { useAdsbPolling, useAirspaceSync, useDroneAnchor, useTelemetryPlayback, useWaypointValidation, useWeather } from "./useLiveData";
import AirspacePanel, { statusTone } from "./hud/AirspacePanel";
import ChecklistPanel, { useLaunchGate } from "./hud/ChecklistPanel";
import CopilotPanel from "./hud/CopilotPanel";
import MissionPanel from "./hud/MissionPanel";
import TelemetryPanel from "./hud/TelemetryPanel";
import TrafficPanel from "./hud/TrafficPanel";
import WeatherPanel from "./hud/WeatherPanel";
import { Badge } from "./hud/ui";

const MapView = dynamic(() => import("./MapView"), { ssr: false, loading: () => <div className="absolute inset-0 bg-slate-950" /> });

const TABS = [
  { id: "airspace", label: "Airspace", icon: Layers, el: <AirspacePanel /> },
  { id: "mission", label: "Mission", icon: Route, el: <MissionPanel /> },
  { id: "copilot", label: "Copilot", icon: Bot, el: <CopilotPanel /> },
  { id: "checklist", label: "Checklist", icon: ClipboardCheck, el: <ChecklistPanel /> },
] as const;

export default function Hud() {
  const [tab, setTab] = useState<(typeof TABS)[number]["id"]>("mission");
  const { onViewport } = useAirspaceSync();
  useWaypointValidation();
  useDroneAnchor();
  useAdsbPolling();
  useTelemetryPlayback();
  useWeather();

  const precheck = useAirspaceStore((s) => s.precheck);
  const warnings = useTelemetryStore((s) => s.assessments.filter((a) => a.level === "warning").length);
  const gate = useLaunchGate();

  return (
    <main className="relative h-dvh w-full overflow-hidden bg-slate-950 text-slate-100">
      <MapView onViewport={onViewport} />

      <header className="pointer-events-none absolute inset-x-0 top-0 z-10 flex items-center justify-between gap-2 p-3">
        <div className="pointer-events-auto flex items-center gap-2 rounded-xl border border-slate-700/60 bg-slate-950/80 px-3 py-2 backdrop-blur-md">
          <Plane size={16} className="text-cyan-400" />
          <span className="text-sm font-bold tracking-widest">AERO<span className="text-cyan-400">COMMAND</span></span>
        </div>
        <div className="pointer-events-auto flex flex-wrap items-center justify-end gap-2 rounded-xl border border-slate-700/60 bg-slate-950/80 px-3 py-2 backdrop-blur-md">
          {precheck && <Badge tone={statusTone(precheck.status)}>LAANC {precheck.status.replace(/_/g, " ")}</Badge>}
          {warnings > 0 && <Badge tone="danger" className="animate-pulse"><AlertTriangle size={10} /> TRAFFIC {warnings}</Badge>}
          <Badge tone={gate.ready ? "ok" : "muted"}>{gate.ready ? <Rocket size={10} /> : <Lock size={10} />} {gate.ready ? "Ready to launch" : "Launch locked"}</Badge>
        </div>
      </header>

      <aside className="absolute bottom-20 left-3 top-16 z-10 flex w-[22rem] max-w-[calc(100vw-1.5rem)] flex-col gap-2">
        <nav className="flex gap-1 rounded-xl border border-slate-700/60 bg-slate-950/80 p-1 backdrop-blur-md">
          {TABS.map((t) => (
            <button key={t.id} onClick={() => setTab(t.id)}
              className={`flex flex-1 items-center justify-center gap-1 rounded-lg py-1.5 text-[11px] font-medium ${tab === t.id ? "bg-cyan-600 text-white" : "text-slate-400 hover:bg-slate-800"}`}>
              <t.icon size={12} /> {t.label}
            </button>
          ))}
        </nav>
        <div className="min-h-0 flex-1 overflow-y-auto pr-1">
          {TABS.map((t) => <div key={t.id} hidden={tab !== t.id}>{t.el}</div>)}
        </div>
      </aside>

      <aside className="absolute bottom-20 right-3 top-16 z-10 hidden w-80 flex-col gap-2 overflow-y-auto lg:flex">
        <TrafficPanel />
        <WeatherPanel />
      </aside>

      <footer className="absolute inset-x-3 bottom-3 z-10 flex justify-center">
        <TelemetryPanel />
      </footer>
    </main>
  );
}
