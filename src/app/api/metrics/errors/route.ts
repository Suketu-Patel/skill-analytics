import { NextResponse } from "next/server";
import { getErrorMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const limit = Number(url.searchParams.get("limit") || 200);
  return NextResponse.json({
    errors: getErrorMetrics(Math.min(Math.max(limit, 1), 500), parseOpts(request.url))
  });
}
