import { NextResponse } from "next/server";
import { getCostOverview } from "@/lib/metrics.js";
import { parseOpts } from "@/lib/route-opts";
import { getCostFunFacts } from "@/lib/summaries.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whitelist of region keys understood by the prompt's metaphor banks.
// Anything outside this set falls back to US (the model's lowest-risk
// default) instead of being shoved into the cache key verbatim.
const REGIONS = new Set(["US", "IN", "UK", "EU", "JP", "AU", "GLOBAL"]);

// GET /api/metrics/fun-facts?source=&from=&to=&region=IN&force=1
//
// Returns a small set of AI-generated 1-2 line "did you know" facts about
// the current cost/token overview. Cached by SHA-256 of the headline
// numbers + region so refreshes never re-prompt Haiku unless `force=1`
// is passed. Region drives the metaphor bank (Costco chickens for US,
// auto-rickshaw rides for IN, pints for UK, …) so the snark lands.
export async function GET(req: Request) {
  try {
    const opts = parseOpts(req.url);
    const url = new URL(req.url);
    const force = url.searchParams.get("force") === "1";
    const rawRegion = (url.searchParams.get("region") || "US").toUpperCase();
    const region = REGIONS.has(rawRegion) ? rawRegion : "US";
    const overview = getCostOverview(opts);
    const summary = await getCostFunFacts(overview.headline, { force, region });
    return NextResponse.json({ ok: true, region, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), facts: [] },
      { status: 500 }
    );
  }
}
