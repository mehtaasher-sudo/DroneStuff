import { NextResponse } from "next/server";

export function fail(e: unknown, status = 502) {
  const message = e instanceof Error ? e.message : String(e);
  return NextResponse.json({ error: message }, { status });
}

export function num(v: string | null, name: string) {
  const n = Number(v);
  if (v === null || !Number.isFinite(n)) throw new Error(`Missing or invalid ${name}`);
  return n;
}
