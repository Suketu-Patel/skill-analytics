import { NextResponse } from "next/server";
import { getOverviewMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  return NextResponse.json(getOverviewMetrics(parseOpts(request.url)));
}
