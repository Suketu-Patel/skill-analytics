import { NextResponse } from "next/server";
import {
  precomputeWrappedSnapshot,
  readWrappedSnapshot,
} from "@/lib/wrapped-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/metrics/wrapped?force=1
//
// Serves the pre-computed Wrapped snapshot built after the last sync.
// Falls back to computing live if no snapshot exists yet. `force=1`
// rebuilds the snapshot inline (rare — auto-rebuilds on every sync).
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (force) {
      const fresh = precomputeWrappedSnapshot();
      return NextResponse.json({ ok: true, ...fresh, cached: false });
    }
    const cached = readWrappedSnapshot();
    if (cached) return NextResponse.json({ ok: true, ...cached });
    // No snapshot yet — compute on demand so the tab works even before
    // the first sync completes.
    const fresh = precomputeWrappedSnapshot();
    return NextResponse.json({ ok: true, ...fresh, cached: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
