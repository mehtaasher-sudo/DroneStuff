import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { prisma } from "@/lib/db";
import { fail } from "../_util";

const Body = z.object({
  name: z.string().min(1).max(120),
  area: z.unknown().optional(),
  waypoints: z.array(z.record(z.string(), z.unknown())),
  altAglFt: z.number().int().min(0).max(400),
  pattern: z.string().optional(),
  notes: z.string().optional(),
  laancStatus: z.string().optional(),
  laancId: z.string().optional(),
});

export async function GET() {
  const missions = await prisma.mission.findMany({ orderBy: { updatedAt: "desc" }, take: 50 });
  return NextResponse.json(
    missions.map((m) => ({ ...m, waypoints: JSON.parse(m.waypoints), area: m.areaGeoJson ? JSON.parse(m.areaGeoJson) : null })),
  );
}

export async function POST(req: NextRequest) {
  const parsed = Body.safeParse(await req.json().catch(() => null));
  if (!parsed.success) return fail(parsed.error.message, 400);
  const { area, waypoints, ...rest } = parsed.data;
  const m = await prisma.mission.create({
    data: { ...rest, waypoints: JSON.stringify(waypoints), areaGeoJson: area ? JSON.stringify(area) : null },
  });
  return NextResponse.json({ id: m.id }, { status: 201 });
}
