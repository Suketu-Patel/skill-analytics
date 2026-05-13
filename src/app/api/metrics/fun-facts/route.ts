import { NextResponse } from "next/server";
import { getCostOverview } from "@/lib/metrics.js";
import { parseOpts } from "@/lib/route-opts";
import { getCostFunFacts } from "@/lib/summaries.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/metrics/fun-facts?source=&from=&to=&force=1
//
// Returns a small set of AI-generated 1-2 line "did you know" facts about
// the current cost/token overview. Cached by SHA-256 of the headline
// numbers so refreshes never re-prompt Haiku unless `force=1` is passed.
export async function GET(req: Request) {
  try {
    const opts = parseOpts(req.url);
    const force = new URL(req.url).searchParams.get("force") === "1";
    const overview = getCostOverview(opts);
    const summary = await getCostFunFacts(overview.headline, { force });
    return NextResponse.json({ ok: true, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), facts: [] },
      { status: 500 }
    );
  }
}
