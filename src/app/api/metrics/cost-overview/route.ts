import { NextResponse } from "next/server";
import { getCostOverview } from "@/lib/metrics.js";
import { parseOpts } from "@/lib/route-opts";
import { readOrCompute } from "@/lib/metric-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  try {
    const opts = parseOpts(req.url);
    const data = readOrCompute("cost-overview", opts, () => ({
      ok: true,
      ...getCostOverview(opts),
    }));
    return NextResponse.json(data);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
