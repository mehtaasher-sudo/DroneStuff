import { NextRequest, NextResponse } from "next/server";
import { prisma } from "@/lib/db";

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.mission.delete({ where: { id } }).catch(() => null);
  return new NextResponse(null, { status: 204 });
}
