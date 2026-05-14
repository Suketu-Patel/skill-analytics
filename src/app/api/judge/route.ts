import { NextResponse } from "next/server";
import {
  codexTiebreakerCandidates,
  judgeInvocation,
  unjudgedInvocations,
} from "@/lib/judge.js";
import { clearJobs, finishJob, listJobs, newJob, progressJob } from "@/lib/jobs.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/judge — list recent judge jobs (with lazy stale-job reaping)
export async function GET() {
  return NextResponse.json({ ok: true, jobs: listJobs() });
}

// DELETE /api/judge — wipe the in-memory job log. Useful when stale
// "running" jobs (orphaned subprocesses, server restarts) clutter the
// view. Does NOT delete persisted judgments from SQLite — those are the
// real verdicts and shouldn't be lost from a single button click.
export async function DELETE() {
  clearJobs();
  return NextResponse.json({ ok: true });
}

// POST /api/judge?judge=haiku|codex&limit=10&skill=foo
//   Starts a background sweep; returns the new job record immediately.
//   The UI polls /api/judge/job/<id> for progress.
const DEFAULT_LIMITS = { haiku: 10, codex: 5 } as const;
const MAX_LIMIT = 100; // hard cap to bound cost; raise deliberately if needed

export async function POST(req: Request) {
  const url = new URL(req.url);
  const judge = (url.searchParams.get("judge") || "haiku").toLowerCase();
  if (judge !== "haiku" && judge !== "codex") {
    return NextResponse.json(
      { ok: false, error: "judge must be 'haiku' or 'codex'" },
      { status: 400 }
    );
  }
  // Validate + clamp limit. `Number("abc")` is NaN; NaN propagated to SQL
  // LIMIT was "NULL" which SQLite treats as unbounded — a runaway-cost
  // bug. Clamp to [1, MAX_LIMIT] and reject obviously bogus input.
  const limitRaw = url.searchParams.get("limit");
  const defaultLimit = DEFAULT_LIMITS[judge as "haiku" | "codex"];
  // Explicit `number` type — without it TS infers `5 | 10` from the
  // literal-typed DEFAULT_LIMITS table, and the Math.min clamp below
  // (a regular number) won't fit. Production build catches this; dev
  // doesn't type-check API routes the same way.
  let limit: number = defaultLimit;
  if (limitRaw != null) {
    const parsed = Number(limitRaw);
    if (!Number.isFinite(parsed) || parsed <= 0) {
      return NextResponse.json(
        { ok: false, error: `invalid limit: ${limitRaw!}` },
        { status: 400 }
      );
    }
    limit = Math.min(MAX_LIMIT, Math.floor(parsed));
  }
  // Treat "" / "all" as no filter — otherwise these become literal SQL
  // equality checks for skill_name and silently return zero candidates.
  const skillRaw = url.searchParams.get("skill");
  const skill = skillRaw && skillRaw !== "" && skillRaw.toLowerCase() !== "all" ? skillRaw : null;
  let candidates;
  try {
    candidates =
      judge === "codex"
        ? codexTiebreakerCandidates({ limit, skill })
        : unjudgedInvocations({ limit, skill, judge });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e) },
      { status: 500 }
    );
  }

  const job = newJob(`judge-${judge}`, candidates.length);

  // Fire-and-forget background sweep. We intentionally do not await so
  // the response returns immediately; errors are recorded on the job.
  (async () => {
    try {
      for (const inv of candidates) {
        try {
          const { error } = await judgeInvocation(inv, { judge });
          progressJob(job.id, {
            skill_event_key: inv.event_key,
            skill: inv.skill_name,
            ok: !error,
            error: error || null,
          });
        } catch (e) {
          progressJob(job.id, {
            skill_event_key: inv.event_key,
            skill: inv.skill_name,
            ok: false,
            error: e instanceof Error ? e.message : String(e),
          });
        }
      }
      finishJob(job.id, { status: "done" });
    } catch (e) {
      finishJob(job.id, {
        status: "error",
        error: e instanceof Error ? e.message : String(e),
      });
    }
  })();

  return NextResponse.json({ ok: true, job });
}
