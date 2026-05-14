import { NextResponse } from "next/server";
import { getAllPrefs, setPrefs } from "@/lib/prefs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/prefs     → returns the full prefs blob (defaults merged in)
// POST /api/prefs    → body is a partial { key: value } patch; merged
//                      into the DB and the new full blob is returned.
//
// The client treats this as the authoritative source. localStorage is
// retained only for theme (FOUC-pre-paint) and as an offline-only
// fallback for the very first paint when the prefs fetch is still
// in flight.

export async function GET() {
  try {
    return NextResponse.json({ ok: true, prefs: getAllPrefs() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}

export async function POST(req: Request) {
  try {
    const body = await req.json().catch(() => ({}));
    const prefs = setPrefs(body && typeof body === "object" ? body : {});
    return NextResponse.json({ ok: true, prefs });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
