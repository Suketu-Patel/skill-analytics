import { NextResponse } from "next/server";
import { getEvidence } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const params = await context.params;
  const evidence = getEvidence(params.id);
  if (!evidence) {
    return NextResponse.json({ error: "Evidence not found" }, { status: 404 });
  }
  // Parse raw_json so the UI renders structured fields instead of escaped JSON.
  let parsed: any = null;
  try {
    parsed = evidence.raw_json ? JSON.parse(evidence.raw_json) : null;
  } catch {
    parsed = null;
  }
  const payload = parsed?.payload ?? {};
  let parsedArgs: unknown = null;
  if (typeof payload?.arguments === "string") {
    try {
      parsedArgs = JSON.parse(payload.arguments);
    } catch {
      parsedArgs = payload.arguments;
    }
  } else if (payload?.arguments) {
    parsedArgs = payload.arguments;
  }
  const summary = {
    event_id: evidence.event_id,
    source_path: evidence.source_path,
    source_line: evidence.source_line,
    timestamp: evidence.timestamp ?? parsed?.timestamp ?? null,
    event_type: evidence.event_type,
    payload_type: evidence.payload_type ?? payload?.type ?? null,
    turn_id: payload?.turn_id ?? null,
    call_id: payload?.call_id ?? null,
    cwd: payload?.cwd ?? null,
    exit_code: payload?.exit_code ?? null,
    duration_ms: payload?.duration?.secs != null ? Number(payload.duration.secs) * 1000 : null,
    command: Array.isArray(payload?.command)
      ? payload.command.join(" ")
      : typeof payload?.command === "string"
        ? payload.command
        : payload?.parsed_cmd?.[0]?.cmd ?? null,
    stdout: payload?.stdout ?? null,
    stderr: payload?.stderr ?? null,
    aggregated_output: payload?.aggregated_output ?? null,
    output: typeof payload?.output === "string" ? payload.output : null,
    message: payload?.message ?? null,
    tool_name: payload?.name ?? null,
    arguments: parsedArgs
  };
  return NextResponse.json({ evidence: summary, raw: parsed ?? evidence.raw_json });
}
