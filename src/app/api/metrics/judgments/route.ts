import { NextResponse } from "next/server";
import { queryRows, initDb, sqlString } from "@/lib/sqlite.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  initDb();
  const u = new URL(req.url);
  const skill = u.searchParams.get("skill");

  const skillClause = skill ? `WHERE skill_name = ${sqlString(skill)}` : "";

  // Per-skill rollup of judge results
  const perSkill = queryRows(`
    SELECT skill_name,
           judge,
           COUNT(*)                                    AS n,
           AVG(fit)                                    AS avg_fit,
           AVG(value)                                  AS avg_value,
           AVG(corrections)                            AS avg_corrections,
           SUM(CASE WHEN error IS NOT NULL THEN 1 ELSE 0 END) AS errors
      FROM judgments
      ${skillClause}
     GROUP BY skill_name, judge
     ORDER BY skill_name, judge
  `);

  // Drift watch: invocations where Haiku and Codex disagree on value.
  // (Where we have both judges' verdicts.)
  const drift = queryRows(`
    SELECT h.skill_event_key,
           h.skill_name,
           h.turn_id,
           h.value  AS haiku_value,
           h.fit    AS haiku_fit,
           c.value  AS codex_value,
           c.fit    AS codex_fit,
           (h.value - c.value) AS delta_value,
           h.poorly AS haiku_poorly,
           c.poorly AS codex_poorly
      FROM judgments h
      JOIN judgments c
        ON c.skill_event_key = h.skill_event_key
       AND c.judge = 'codex'
     WHERE h.judge = 'haiku'
       AND h.value IS NOT NULL
       AND c.value IS NOT NULL
       ${skill ? `AND h.skill_name = ${sqlString(skill)}` : ""}
     ORDER BY ABS(h.value - c.value) DESC
     LIMIT 50
  `);

  // Correction-correlated low scores: invocations where Haiku scored
  // value <= 4 AND there was a correction event on the same turn.
  const corroborated = queryRows(`
    SELECT j.skill_event_key, j.skill_name, j.turn_id,
           j.fit, j.value, j.corrections, j.poorly, j.judged_at
      FROM judgments j
     WHERE j.judge = 'haiku'
       AND j.value IS NOT NULL
       AND j.value <= 4
       AND EXISTS (
         SELECT 1 FROM skill_events se
          WHERE se.skill_name = j.skill_name
            AND se.turn_id = j.turn_id
            AND se.event_type = 'correction'
            AND se.source = 'claude'
       )
       ${skill ? `AND j.skill_name = ${sqlString(skill)}` : ""}
     ORDER BY j.judged_at DESC
     LIMIT 50
  `);

  // Headline counts. "Invocations" includes both Skill and Agent (subagent)
  // invocations since both go through the judge.
  const counts = queryRows(`
    SELECT
      (SELECT COUNT(*) FROM skill_events
        WHERE event_type IN ('skill_invocation', 'agent_invocation')
          AND source = 'claude') AS total_invocations,
      (SELECT COUNT(*) FROM skill_events
        WHERE event_type = 'skill_invocation' AND source = 'claude') AS skill_invocations,
      (SELECT COUNT(*) FROM skill_events
        WHERE event_type = 'agent_invocation' AND source = 'claude') AS agent_invocations,
      (SELECT COUNT(DISTINCT skill_event_key) FROM judgments
        WHERE judge = 'haiku' AND error IS NULL) AS haiku_judged,
      (SELECT COUNT(DISTINCT skill_event_key) FROM judgments
        WHERE judge = 'codex' AND error IS NULL) AS codex_judged,
      (SELECT COUNT(*) FROM skill_events
        WHERE event_type = 'correction' AND source = 'claude') AS corrections,
      (SELECT COUNT(*)
         FROM skill_events se
         JOIN judgments hj
           ON hj.skill_event_key = se.event_key
          AND hj.judge = 'haiku'
          AND hj.error IS NULL
        WHERE se.event_type IN ('skill_invocation', 'agent_invocation')
          AND se.source = 'claude'
          AND NOT EXISTS (
            SELECT 1 FROM judgments j2
             WHERE j2.skill_event_key = se.event_key
               AND j2.judge = 'codex'
          )) AS codex_candidates
  `)[0] || {
    total_invocations: 0, skill_invocations: 0, agent_invocations: 0,
    haiku_judged: 0, codex_judged: 0, corrections: 0, codex_candidates: 0,
  };

  return NextResponse.json({
    ok: true,
    counts,
    perSkill,
    drift,
    corroborated,
  });
}
