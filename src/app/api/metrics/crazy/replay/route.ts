import { NextResponse } from "next/server";
import { sessionReplay } from "@/lib/crazy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/metrics/crazy/replay?session=<id>
// Returns the ordered event stream for one session. Loaded lazily
// when the user picks a session in the replay panel.
export async function GET(req: Request) {
  try {
    const id = new URL(req.url).searchParams.get("session");
    if (!id) return NextResponse.json({ ok: false, error: "session required" }, { status: 400 });
    const { events } = sessionReplay(id);
    return NextResponse.json({ ok: true, events });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
