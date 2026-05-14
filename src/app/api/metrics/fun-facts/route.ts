import { NextResponse } from "next/server";
import { getCostOverview } from "@/lib/metrics.js";
import { parseOpts } from "@/lib/route-opts";
import { getCostFunFacts, readFastFunFacts } from "@/lib/summaries.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Whitelist of region keys understood by the prompt's metaphor banks.
// Anything outside this set falls back to US (the model's lowest-risk
// default) instead of being shoved into the cache key verbatim.
const REGIONS = new Set(["US", "IN", "UK", "EU", "JP", "AU", "GLOBAL"]);

// GET /api/metrics/fun-facts?source=&from=&to=&region=IN&force=1
//
// Fast-path: a (region, filterQS) cached row is checked BEFORE we even
// call getCostOverview. On a cache hit we return immediately — no
// Haiku call, no metric recompute. The cache is wiped by the importer
// on every sync (alongside metric-cache.invalidateAll) so freshness is
// bounded by sync cadence, not page loads.
export async function GET(req: Request) {
  try {
    const url = new URL(req.url);
    const opts = parseOpts(req.url);
    const force = url.searchParams.get("force") === "1";
    const rawRegion = (url.searchParams.get("region") || "US").toUpperCase();
    const region = REGIONS.has(rawRegion) ? rawRegion : "US";
    // Build a normalised filter signature so two callers with the same
    // semantic filter share a cache row. Drops the region param itself
    // (already part of the cache key) and `force`.
    const filterParams = new URLSearchParams();
    for (const [k, v] of url.searchParams.entries()) {
      if (k === "region" || k === "force") continue;
      filterParams.set(k, v);
    }
    const filterQS = filterParams.toString();

    if (!force) {
      const fast = readFastFunFacts({ region, filterQS });
      if (fast && Array.isArray(fast.facts) && fast.facts.length) {
        return NextResponse.json({ ok: true, region, ...fast });
      }
    }

    const overview = getCostOverview(opts);
    const summary = await getCostFunFacts(overview.headline, {
      force,
      region,
      filterQS,
    });
    return NextResponse.json({ ok: true, region, ...summary });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), facts: [] },
      { status: 500 }
    );
  }
}
