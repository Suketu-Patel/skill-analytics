import { NextResponse } from "next/server";
import { getComparisonMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  // Comparison view ignores the global source filter — it's always both.
  const { from, to } = parseOpts(request.url);
  return NextResponse.json(getComparisonMetrics({ from, to }));
}
