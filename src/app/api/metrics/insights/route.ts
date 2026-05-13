import { NextResponse } from "next/server";
import { getInsights } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";
import { readOrCompute } from "@/lib/metric-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const opts = parseOpts(request.url);
  return NextResponse.json(readOrCompute("insights", opts, () => getInsights(opts)));
}
