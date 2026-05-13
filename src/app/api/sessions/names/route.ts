import { NextResponse } from "next/server";
import { namesFor } from "@/lib/session-names.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/sessions/names  body: { ids: ["turn_id1", "turn_id2", ...] }
// Returns { names: { turn_id1: "refactor token math", ... } }
// Cached hits return instantly; misses call Haiku at most 3 in parallel.
export async function POST(req: Request) {
  try {
    const body = await req.json();
    const ids: string[] = Array.isArray(body?.ids) ? body.ids.filter((s: unknown) => typeof s === "string") : [];
    if (!ids.length) return NextResponse.json({ ok: true, names: {} });
    // Hard cap so a malicious / overzealous client can't trigger 1000
    // Haiku calls in one shot.
    const capped = ids.slice(0, 50);
    const names = await namesFor(capped);
    return NextResponse.json({ ok: true, names });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
