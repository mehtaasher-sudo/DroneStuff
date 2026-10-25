"use client";
import type { ButtonHTMLAttributes, ReactNode } from "react";

export function Panel({ title, icon, right, children, className = "" }: { title: string; icon?: ReactNode; right?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <section className={`rounded-xl border border-slate-700/60 bg-slate-950/75 shadow-xl backdrop-blur-md ${className}`}>
      <header className="flex items-center justify-between gap-2 border-b border-slate-800 px-3 py-2">
        <h2 className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-cyan-300">
          {icon}
          {title}
        </h2>
        {right}
      </header>
      <div className="space-y-3 p-3 text-sm text-slate-200">{children}</div>
    </section>
  );
}

const tones = {
  primary: "bg-cyan-600 hover:bg-cyan-500 text-white",
  ghost: "bg-slate-800 hover:bg-slate-700 text-slate-200",
  danger: "bg-red-700 hover:bg-red-600 text-white",
  success: "bg-emerald-600 hover:bg-emerald-500 text-white",
};

export function Btn({ tone = "ghost", className = "", ...p }: ButtonHTMLAttributes<HTMLButtonElement> & { tone?: keyof typeof tones }) {
  return (
    <button
      {...p}
      className={`inline-flex items-center justify-center gap-1.5 rounded-md px-2.5 py-1.5 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-40 ${tones[tone]} ${className}`}
    />
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block space-y-1">
      <span className="text-[11px] uppercase tracking-wide text-slate-400">{label}</span>
      {children}
      {hint && <span className="block text-[10px] text-slate-500">{hint}</span>}
    </label>
  );
}

export const inputCls =
  "w-full rounded-md border border-slate-700 bg-slate-900 px-2 py-1 font-mono text-xs text-slate-100 outline-none focus:border-cyan-500";

const badgeTones = {
  ok: "border-emerald-500/50 bg-emerald-500/15 text-emerald-300",
  caution: "border-amber-500/50 bg-amber-500/15 text-amber-300",
  danger: "border-red-500/60 bg-red-500/15 text-red-300",
  info: "border-cyan-500/50 bg-cyan-500/10 text-cyan-300",
  muted: "border-slate-600 bg-slate-800/60 text-slate-400",
};

export function Badge({ tone = "info", children, className = "" }: { tone?: keyof typeof badgeTones; children: ReactNode; className?: string }) {
  return <span className={`inline-flex items-center gap-1 rounded border px-1.5 py-0.5 font-mono text-[10px] uppercase ${badgeTones[tone]} ${className}`}>{children}</span>;
}

export function Stat({ label, value, unit }: { label: string; value: ReactNode; unit?: string }) {
  return (
    <div className="rounded-md bg-slate-900/80 px-2 py-1.5">
      <div className="text-[10px] uppercase tracking-wide text-slate-500">{label}</div>
      <div className="font-mono text-sm text-slate-100">
        {value}
        {unit && <span className="ml-0.5 text-[10px] text-slate-400">{unit}</span>}
      </div>
    </div>
  );
}
