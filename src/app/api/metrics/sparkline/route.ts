import { NextResponse } from "next/server";
import { getRecentSparkline } from "@/lib/metrics.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Last 24h cost+token activity for the header sparkline. No filters —
// always reflects current activity.
export async function GET() {
  try {
    return NextResponse.json({ ok: true, ...getRecentSparkline() });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
