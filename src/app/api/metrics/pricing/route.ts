import { NextResponse } from "next/server";
import { getPricingMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(getPricingMetrics(parseOpts(request.url)));
}
