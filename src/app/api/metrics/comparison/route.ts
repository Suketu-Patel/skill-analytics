import { NextResponse } from "next/server";
import { getComparisonMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";
import { readOrCompute } from "@/lib/metric-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Comparison view ignores the global source filter — it's always both.
  const { from, to } = parseOpts(request.url);
  const opts = { from, to };
  return NextResponse.json(readOrCompute("comparison", opts, () => getComparisonMetrics(opts)));
}
