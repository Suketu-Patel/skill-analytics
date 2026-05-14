import { NextResponse } from "next/server";
import { getUserAuthoredSkillsList } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/skills/authored — list of skills the user wrote themselves.
// Excludes vendor (gstack/), plugins, and .system. Power source for the
// "Skills you made" modal in Wrapped and the Skills tab.
export async function GET(req: Request) {
  try {
    const source = new URL(req.url).searchParams.get("source") || "all";
    const rows = getUserAuthoredSkillsList({ source });
    return NextResponse.json({ ok: true, items: rows });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
