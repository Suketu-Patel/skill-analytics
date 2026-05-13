import { NextResponse } from "next/server";
import {
  precomputeContributorsSnapshot,
  readContributorsSnapshot,
} from "@/lib/contributors-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/contributors?force=1
//
// Serves the contributors snapshot cached during the last sync (instant
// SQLite read). Falls back to a live compute only when no cache exists
// yet — `gh pr list` is the slow part, ~1–3s.
//
// `force=1` recomputes inline and overwrites the cache. The Settings
// → Pricing-style "Refresh now" UX could wire to this if we ever want
// it, but normally the importer keeps the snapshot fresh.
export async function GET(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    if (force) {
      const fresh = await precomputeContributorsSnapshot();
      if (!fresh) {
        return NextResponse.json({
          ok: false,
          error: "skill-analytics repo not found near this checkout.",
          contributors: [],
        });
      }
      return NextResponse.json({ ok: true, ...fresh, cached: false });
    }
    const snap = readContributorsSnapshot();
    if (snap) return NextResponse.json({ ok: true, ...snap });
    // Cold start — no sync has run since the cache was added. Compute
    // once now so the modal is usable; the next sync will pre-warm.
    const fresh = await precomputeContributorsSnapshot();
    if (!fresh) {
      return NextResponse.json({
        ok: false,
        error: "skill-analytics repo not found near this checkout.",
        contributors: [],
      });
    }
    return NextResponse.json({ ok: true, ...fresh, cached: false });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), contributors: [] },
      { status: 200 }
    );
  }
}
