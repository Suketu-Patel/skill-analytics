import { NextResponse } from "next/server";
import { getErrorMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";
import { readOrCompute } from "@/lib/metric-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Math.min(Math.max(Number(url.searchParams.get("limit") || 200), 1), 500);
  const opts = { ...parseOpts(request.url), limit };
  return NextResponse.json(
    readOrCompute("errors", opts, () => ({
      errors: getErrorMetrics(limit, opts),
    }))
  );
}
