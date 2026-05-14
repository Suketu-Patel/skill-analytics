import { NextResponse } from "next/server";
import {
  frustrationByHour,
  costPerLOCKept,
  contextDegradationCurve,
  phantomEdits,
  toolTransitions,
  pepTalkIndex,
  listReplayableSessions,
  aiFingerprint,
} from "@/lib/crazy";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/metrics/crazy — bundled response for the Crazy tab.
// All 8 panels fetch with one round-trip; the session-replay payload
// (per-session events) is lazy-loaded from /api/metrics/crazy/replay.
export async function GET() {
  try {
    return NextResponse.json({
      ok: true,
      frustration: frustrationByHour(),
      cost_per_loc: costPerLOCKept(),
      context_degradation: contextDegradationCurve(),
      phantom_edits: phantomEdits(),
      tool_transitions: toolTransitions(),
      pep_talk: pepTalkIndex(),
      sessions: listReplayableSessions(),
      fingerprint: aiFingerprint(),
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }
}
