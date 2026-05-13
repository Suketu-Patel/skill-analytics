import { NextResponse } from "next/server";
import { getCostOverview } from "@/lib/metrics.js";
import { parseOpts } from "@/lib/route-opts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const opts = parseOpts(req.url);
    const data = getCostOverview(opts);
    return NextResponse.json({ ok: true, ...data });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
