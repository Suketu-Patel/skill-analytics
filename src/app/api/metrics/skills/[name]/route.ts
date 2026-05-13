import { NextResponse } from "next/server";
import { getSkillDetail } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const decoded = decodeURIComponent(name);
  const detail = getSkillDetail(decoded);
  if (!detail) {
    return NextResponse.json({ error: "Skill not found" }, { status: 404 });
  }
  return NextResponse.json(detail);
}
