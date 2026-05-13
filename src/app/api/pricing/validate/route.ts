import { NextResponse } from "next/server";
import {
  readPricingOverrides,
  validatePricing,
} from "@/lib/pricing-validator.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/pricing/validate — returns the current overrides + the age
// of the last validation. Used by the client to decide whether to
// auto-fire a fresh check on mount.
export async function GET() {
  const cur = readPricingOverrides();
  if (!cur) {
    return NextResponse.json({ ok: true, present: false });
  }
  return NextResponse.json({
    ok: true,
    present: true,
    last_validated_at: cur.last_validated_at,
    as_of: cur.as_of,
    sources_consulted: cur.sources_consulted || [],
    counts: {
      claude: Object.keys(cur.claude || {}).length,
      codex: Object.keys(cur.codex || {}).length,
    },
  });
}

// POST /api/pricing/validate?force=1
//
// Kicks the background validator. Without `force`, dedupes against any
// successful run from the last 24h — the dashboard fires this on every
// mount and we don't want to burn Haiku quota per page load.
export async function POST(req: Request) {
  try {
    const force = new URL(req.url).searchParams.get("force") === "1";
    const res = await validatePricing({ force });
    return NextResponse.json(res);
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
