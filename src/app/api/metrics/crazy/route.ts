import { NextResponse } from "next/server";
import { precomputeCrazySnapshot, readCrazySnapshot } from "@/lib/crazy-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/metrics/crazy?force=1
//
// Serves the pre-computed Crazy snapshot built after the last sync.
// Falls back to computing live if no snapshot exists yet (first run
// before an import has completed). `force=1` rebuilds inline; rare,
// auto-rebuilds on every sync.
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (force) {
      const fresh = precomputeCrazySnapshot();
      return NextResponse.json({ ok: true, ...fresh, cached: false });
    }
    const cached = readCrazySnapshot();
    if (cached) return NextResponse.json({ ok: true, ...cached });
    const fresh = precomputeCrazySnapshot();
    return NextResponse.json({ ok: true, ...fresh, cached: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
