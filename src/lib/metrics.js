import { queryRows, sqlNumber, sqlString } from "./sqlite.js";
import { aggregate, aggregateBy } from "./tokens.js";

// Canonical billable-token aggregator. Every endpoint that wants to
// report "total tokens" should route through here so the numbers match
// across tabs. Internally pulls (source, raw_token_fields) rows from
// token_usage and runs them through the tokens.js normalizer.
// Project-scope helper. When set, we join token_usage to turns and
// filter by cwd. Skipped (left join) otherwise so the cheap path stays
// cheap when no scope is active.
function tokenRowsForOpts(opts = {}) {
  const tuWhere = whereFilter(opts, "tu");
  const needJoin = !!opts?.project;
  const projectAnd = opts?.project ? ` AND t.cwd = ${sqlString(opts.project)}` : "";
  const where = [tuWhere].filter(Boolean).join(" AND ");
  const whereClause = where ? `WHERE ${where}${projectAnd}` : projectAnd ? `WHERE 1=1${projectAnd}` : "";
  if (needJoin) {
    return queryRows(`
      SELECT tu.source, tu.input_tokens, tu.cached_input_tokens, tu.output_tokens, tu.reasoning_output_tokens
      FROM token_usage tu
      JOIN turns t ON t.turn_id = tu.turn_id
      ${whereClause}
    `);
  }
  return queryRows(`
    SELECT source, input_tokens, cached_input_tokens, output_tokens, reasoning_output_tokens
    FROM token_usage tu ${where ? `WHERE ${where}` : ""}
  `);
}

function billableTokensTotal(opts = {}) {
  return aggregate(tokenRowsForOpts(opts)).billable;
}

function billableTokensBySource(opts = {}) {
  const groups = aggregateBy(tokenRowsForOpts(opts), (r) => r.source);
  const out = {};
  for (const [k, v] of groups) out[k] = v.billable;
  return out;
}

function one(sql, fallback = {}) {
  return queryRows(sql)[0] || fallback;
}

// Compose a SQL fragment that restricts a table alias's rows by source and
// optional timestamp range. Pass an alias plus the table's timestamp column.
// All filters are optional; if none are set, returns "".
export function whereFilter(opts, alias = "e", tsCol = "timestamp") {
  const clauses = [];
  if (opts?.source && opts.source !== "all") {
    clauses.push(`${alias}.source = ${sqlString(opts.source)}`);
  }
  if (opts?.from) {
    clauses.push(`${alias}.${tsCol} >= ${sqlString(opts.from)}`);
  }
  if (opts?.to) {
    clauses.push(`${alias}.${tsCol} <= ${sqlString(opts.to)}`);
  }
  return clauses.length ? clauses.join(" AND ") : "";
}

// Convenience for queries that already have a WHERE clause.
function andFilter(opts, alias, tsCol) {
  const f = whereFilter(opts, alias, tsCol);
  return f ? ` AND ${f}` : "";
}

// Convenience for queries that need a fresh WHERE.
function whereOnly(opts, alias, tsCol) {
  const f = whereFilter(opts, alias, tsCol);
  return f ? ` WHERE ${f}` : "";
}

export function getOverviewMetrics(opts = {}) {
  const turnsWhere = whereOnly(opts, "t", "started_at");
  const errEventsWhere = whereOnly(opts, "se");
  const errWhere = whereOnly(opts, "e");
  const tokenWhere = whereOnly(opts, "tu");
  const totals = one(`
    SELECT
      (SELECT COUNT(*) FROM turns t ${turnsWhere}) AS turns,
      (SELECT COUNT(*) FROM skills s ${opts?.source && opts.source !== "all" ? `WHERE s.source = ${sqlString(opts.source)}` : ""}) AS skills,
      (SELECT COUNT(*) FROM skill_events se ${errEventsWhere}) AS skill_events,
      (SELECT COUNT(DISTINCT skill_name) FROM skill_events se ${errEventsWhere}) AS active_skills,
      (SELECT COUNT(*) FROM errors e ${errWhere}) AS errors,
      (SELECT COUNT(*) FROM errors e ${errWhere ? errWhere + " AND" : "WHERE"} e.severity = 'error') AS hard_errors,
      -- total_tokens here is BILLABLE only (fresh_input + output + reasoning),
      -- normalized per provider via the tokens.js semantics. We compute it
      -- in JS below so it always agrees with cost-overview and pricing.
      0 AS total_tokens,
      (SELECT COALESCE(AVG(duration_ms), 0) FROM turns t WHERE duration_ms IS NOT NULL ${andFilter(opts, "t", "started_at")}) AS avg_duration_ms
  `);

  const confidence = queryRows(`
    SELECT confidence, COUNT(*) AS count
    FROM skill_events se ${errEventsWhere}
    GROUP BY confidence
    ORDER BY count DESC
  `);

  const topSkills = queryRows(`
    SELECT
      se.skill_name,
      s.kind,
      s.source,
      COUNT(*) AS events,
      SUM(CASE WHEN se.confidence = 'explicit' THEN 1 ELSE 0 END) AS explicit_events,
      SUM(CASE WHEN se.confidence = 'mentioned' THEN 1 ELSE 0 END) AS mentioned_events,
      MAX(se.timestamp) AS last_seen,
      COALESCE(err.error_count, 0) AS errors
    FROM skill_events se
    LEFT JOIN skills s ON s.name = se.skill_name
    LEFT JOIN (
      SELECT skill_name, COUNT(*) AS error_count
      FROM errors e
      WHERE skill_name IS NOT NULL ${andFilter(opts, "e")}
      GROUP BY skill_name
    ) err ON err.skill_name = se.skill_name
    ${errEventsWhere}
    GROUP BY se.skill_name, s.kind, s.source, err.error_count
    ORDER BY events DESC
    LIMIT 12
  `);

  const topErrors = queryRows(`
    SELECT category, severity, COUNT(*) AS count
    FROM errors e ${errWhere}
    GROUP BY category, severity
    ORDER BY count DESC
    LIMIT 10
  `);

  const recentErrors = queryRows(`
    SELECT e.error_key, e.timestamp, e.severity, e.category, e.message,
           e.skill_name, e.turn_id, e.evidence_id, e.source
    FROM errors e ${errWhere}
    ORDER BY COALESCE(e.timestamp, '') DESC
    LIMIT 12
  `);

  // Replace the SQL-zero total_tokens with the canonical billable count.
  // Doing this in JS after the totals query keeps the SQL portable and
  // guarantees the same normalizer everywhere.
  totals.total_tokens = billableTokensTotal(opts);
  const userSkills = getUserSkillCounts(opts);
  totals.user_skills = userSkills.total;
  totals.user_skills_by_source = userSkills.by_source;
  return { totals, confidence, topSkills, topErrors, recentErrors };
}

/**
 * Count skills the user wrote themselves vs ones that came from vendor
 * bundles (Codex plugin cache, gstack, .system installers, plus the
 * built-in Claude agents that arrive with no on-disk path).
 *
 * Heuristic: must have a real path; exclude anything under /.system/,
 * /plugins/, or /gstack/. That maps to per-project .codex/agents/ files
 * and user-installed skills under ~/.codex/skills/ or ~/.claude/skills/.
 * The numbers are approximate — there's no metadata flag for authorship.
 */
/**
 * Return the actual list of user-authored skills, ordered by source then
 * name. Same filter as getUserSkillCounts. Used by the "Skills you made"
 * modal so the user can see exactly which ones the count refers to.
 */
export function getUserAuthoredSkillsList(opts = {}) {
  const sourceFilter =
    opts?.source && opts.source !== "all"
      ? ` AND source = ${sqlString(opts.source)}`
      : "";
  return queryRows(`
    SELECT name, kind, source, path, description
    FROM skills
    WHERE kind IN ('skill','agent','claude_skill','claude_agent')
      AND path IS NOT NULL
      AND path != ''
      AND path NOT LIKE '%/.system/%'
      AND path NOT LIKE '%/plugins/%'
      AND path NOT LIKE '%/gstack/%'
      ${sourceFilter}
    ORDER BY source, name
  `);
}

export function getUserSkillCounts(opts = {}) {
  const sourceFilter =
    opts?.source && opts.source !== "all"
      ? ` AND source = ${sqlString(opts.source)}`
      : "";
  const rows = queryRows(`
    SELECT source, COUNT(*) AS n
    FROM skills
    WHERE kind IN ('skill','agent','claude_skill','claude_agent')
      AND path IS NOT NULL
      AND path != ''
      AND path NOT LIKE '%/.system/%'
      AND path NOT LIKE '%/plugins/%'
      AND path NOT LIKE '%/gstack/%'
      ${sourceFilter}
    GROUP BY source
  `);
  const by_source = { claude: 0, codex: 0 };
  let total = 0;
  for (const r of rows) {
    const n = Number(r.n) || 0;
    if (r.source === "claude" || r.source === "codex") by_source[r.source] = n;
    total += n;
  }
  return { total, by_source };
}

/**
 * Last 24 hours of cost activity bucketed by hour, for the header
 * sparkline. Returns 24 datapoints (oldest → newest) with cost + token
 * counts per bucket. Always computed against the latest data — never
 * filtered by date range so the indicator is "current activity," not
 * "spend in the brushed window."
 */
export function getRecentSparkline() {
  // 24 buckets, each 1h wide, ending at the timestamp of the latest
  // token_usage row. Anchoring on data-latest (not wall-clock now) means
  // we keep showing meaningful activity even if you haven't used either
  // CLI in the last few hours.
  const latestRow = queryRows(
    `SELECT MAX(timestamp) AS latest FROM token_usage WHERE timestamp IS NOT NULL`
  )[0] || {};
  const latest = latestRow.latest;
  if (!latest) return { points: [], end_iso: null, total_cost: 0 };

  const endMs = Date.parse(latest);
  const startMs = endMs - 23 * 3600 * 1000;
  const startIso = new Date(startMs).toISOString();
  const rows = queryRows(`
    SELECT tu.timestamp, tu.source, tu.input_tokens, tu.cached_input_tokens,
           tu.output_tokens, tu.reasoning_output_tokens,
           COALESCE(t.model, '(unknown)') AS model
      FROM token_usage tu
      LEFT JOIN turns t ON t.turn_id = tu.turn_id
     WHERE tu.timestamp >= ${sqlString(startIso)}
       AND tu.timestamp <= ${sqlString(latest)}
  `);

  const buckets = Array.from({ length: 24 }, (_, i) => {
    const bucketStartMs = startMs + i * 3600 * 1000;
    return {
      hour_iso: new Date(bucketStartMs).toISOString(),
      cost: 0,
      tokens: 0,
    };
  });
  for (const r of rows) {
    const ts = Date.parse(r.timestamp);
    const idx = Math.floor((ts - startMs) / 3600_000);
    if (idx < 0 || idx >= 24) continue;
    const c = computeCost(r.source, r.model, r);
    buckets[idx].cost += c.cost;
    buckets[idx].tokens += c.billable_tokens;
  }
  const total_cost = buckets.reduce((a, b) => a + b.cost, 0);
  return { points: buckets, end_iso: latest, total_cost };
}

export function getSkillMetrics(opts = {}) {
  const seWhere = whereFilter(opts, "se");
  const seJoinCond = seWhere ? `se.skill_name = s.name AND ${seWhere}` : `se.skill_name = s.name`;
  const errWhere = whereFilter(opts, "e");
  const errJoinCond = errWhere ? `WHERE skill_name IS NOT NULL AND ${errWhere}` : `WHERE skill_name IS NOT NULL`;
  const skillWhere = opts?.source && opts.source !== "all" ? `WHERE s.source = ${sqlString(opts.source)}` : "";
  return queryRows(`
    SELECT
      s.name,
      s.kind,
      s.path,
      s.description,
      s.source AS source,
      COUNT(se.event_key) AS events,
      SUM(CASE WHEN se.confidence = 'explicit' THEN 1 ELSE 0 END) AS explicit_events,
      SUM(CASE WHEN se.confidence = 'inferred' THEN 1 ELSE 0 END) AS inferred_events,
      SUM(CASE WHEN se.confidence = 'mentioned' THEN 1 ELSE 0 END) AS mentioned_events,
      COALESCE(err.error_count, 0) AS errors,
      COALESCE(tok.total_tokens, 0) AS total_tokens,
      COALESCE(avg_turn.avg_duration_ms, 0) AS avg_duration_ms,
      MAX(se.timestamp) AS last_seen,
      tools.tool_calls,
      tools.tool_failed,
      tools.tool_completed
    FROM skills s
    LEFT JOIN skill_events se ON ${seJoinCond}
    LEFT JOIN (
      SELECT skill_name, COUNT(*) AS error_count
      FROM errors e
      ${errJoinCond}
      GROUP BY skill_name
    ) err ON err.skill_name = s.name
    LEFT JOIN (
      SELECT st.skill_name, SUM(tt.max_tokens) AS total_tokens FROM (
        SELECT DISTINCT skill_name, turn_id
        FROM skill_events se
        WHERE turn_id IS NOT NULL ${andFilter(opts, "se")}
      ) st JOIN (
        SELECT turn_id, MAX(total_tokens) AS max_tokens
        FROM token_usage tu
        WHERE turn_id IS NOT NULL ${andFilter(opts, "tu")}
        GROUP BY turn_id
      ) tt ON tt.turn_id = st.turn_id
      GROUP BY st.skill_name
    ) tok ON tok.skill_name = s.name
    LEFT JOIN (
      SELECT se.skill_name, AVG(t.duration_ms) AS avg_duration_ms
      FROM skill_events se
      JOIN turns t ON t.turn_id = se.turn_id
      WHERE t.duration_ms IS NOT NULL ${andFilter(opts, "se")}
      GROUP BY se.skill_name
    ) avg_turn ON avg_turn.skill_name = s.name
    LEFT JOIN (
      -- Distinct (skill_name, turn_id) first → join tool_events. ~14x faster
      -- than COUNT(DISTINCT te.event_key) over the cartesian product.
      WITH st AS (
        SELECT DISTINCT skill_name, turn_id FROM skill_events se
        WHERE turn_id IS NOT NULL ${andFilter(opts, "se")}
      )
      SELECT st.skill_name,
             COUNT(*) AS tool_calls,
             SUM(CASE WHEN te.status = 'failed' THEN 1 ELSE 0 END) AS tool_failed,
             SUM(CASE WHEN te.status = 'completed' THEN 1 ELSE 0 END) AS tool_completed
      FROM st JOIN tool_events te ON te.turn_id = st.turn_id
      ${opts?.source && opts.source !== "all" ? `WHERE te.source = ${sqlString(opts.source)}` : ""}
      GROUP BY st.skill_name
    ) tools ON tools.skill_name = s.name
    ${skillWhere}
    GROUP BY s.name, s.kind, s.path, s.description, s.source, err.error_count,
             tok.total_tokens, avg_turn.avg_duration_ms,
             tools.tool_calls, tools.tool_failed, tools.tool_completed
    ORDER BY events DESC, errors DESC, s.name ASC
  `).map((row) => {
    const calls = Number(row.tool_calls || 0);
    const failed = Number(row.tool_failed || 0);
    const completed = Number(row.tool_completed || 0);
    const resolved = failed + completed;
    return {
      ...row,
      tool_calls: calls,
      tool_failed: failed,
      tool_completed: completed,
      // success_rate is a percentage of resolved (completed+failed) tool calls.
      // null when no resolved calls so the UI can render "—" instead of 100%.
      success_rate: resolved > 0 ? Math.round((completed / resolved) * 100) : null
    };
  });
}

export function getInsights(opts = {}) {
  const skillWhere = opts?.source && opts.source !== "all" ? `WHERE s.source = ${sqlString(opts.source)}` : "";
  const seCond = whereFilter(opts, "se");
  const seJoinCond = seCond ? `se.skill_name = s.name AND ${seCond}` : `se.skill_name = s.name`;

  const staleSkills = queryRows(`
    SELECT s.name, s.kind, s.path, s.source, MAX(se.timestamp) AS last_seen,
           COUNT(se.event_key) AS events
    FROM skills s
    LEFT JOIN skill_events se ON ${seJoinCond}
    ${skillWhere}
    GROUP BY s.name, s.kind, s.path, s.source
    HAVING events = 0
       OR (MAX(se.timestamp) IS NOT NULL
           AND julianday('now') - julianday(MAX(se.timestamp)) > 30)
    ORDER BY events ASC, last_seen ASC NULLS FIRST
  `);

  const hourlyActivity = queryRows(`
    SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour,
           COUNT(*) AS events
    FROM skill_events se
    WHERE timestamp IS NOT NULL ${andFilter(opts, "se")}
    GROUP BY hour
    ORDER BY hour ASC
  `);

  const topFailingCommands = queryRows(`
    SELECT command, COUNT(*) AS failures, MAX(timestamp) AS last_failure
    FROM tool_events te
    WHERE status = 'failed' AND command IS NOT NULL AND command <> '' ${andFilter(opts, "te")}
    GROUP BY command
    ORDER BY failures DESC
    LIMIT 10
  `);

  const failureLeaders = queryRows(`
    WITH st AS (
      SELECT DISTINCT skill_name, turn_id FROM skill_events se
      WHERE turn_id IS NOT NULL ${andFilter(opts, "se")}
    )
    SELECT st.skill_name,
           COUNT(*) AS calls,
           SUM(CASE WHEN te.status = 'failed' THEN 1 ELSE 0 END) AS failed,
           SUM(CASE WHEN te.status = 'completed' THEN 1 ELSE 0 END) AS completed
    FROM st JOIN tool_events te ON te.turn_id = st.turn_id
    ${opts?.source && opts.source !== "all" ? `WHERE te.source = ${sqlString(opts.source)}` : ""}
    GROUP BY st.skill_name
    HAVING (failed + completed) >= 5
    ORDER BY (CAST(failed AS REAL) / NULLIF(failed + completed, 0)) DESC, failed DESC
    LIMIT 8
  `).map((r) => {
    const f = Number(r.failed || 0);
    const c = Number(r.completed || 0);
    const total = f + c;
    return { ...r, failure_rate: total > 0 ? Math.round((f / total) * 100) : 0 };
  });

  return { staleSkills, hourlyActivity, topFailingCommands, failureLeaders };
}

export function getSkillDetail(name) {
  const skill = one(
    `SELECT name, kind, path, description FROM skills WHERE name = ${sqlString(name)}`,
    null
  );
  if (!skill) return null;

  const recentEvents = queryRows(`
    SELECT event_key, event_type, confidence, timestamp, source_kind,
           source_path, source_line, evidence_id, notes
    FROM skill_events
    WHERE skill_name = ${sqlString(name)}
    ORDER BY COALESCE(timestamp, '') DESC
    LIMIT 25
  `);

  const recentErrors = queryRows(`
    SELECT error_key, timestamp, severity, category, message, evidence_id
    FROM errors
    WHERE skill_name = ${sqlString(name)}
    ORDER BY COALESCE(timestamp, '') DESC
    LIMIT 20
  `);

  const tools = queryRows(`
    SELECT te.tool_name,
           COUNT(*) AS calls,
           SUM(CASE WHEN te.status = 'failed' THEN 1 ELSE 0 END) AS failed
    FROM skill_events se
    JOIN tool_events te ON te.turn_id = se.turn_id
    WHERE se.skill_name = ${sqlString(name)} AND se.turn_id IS NOT NULL
    GROUP BY te.tool_name
    ORDER BY calls DESC
    LIMIT 10
  `);

  const daily = queryRows(`
    SELECT DATE(timestamp) AS day, COUNT(*) AS events
    FROM skill_events
    WHERE skill_name = ${sqlString(name)} AND timestamp IS NOT NULL
    GROUP BY day
    ORDER BY day ASC
  `);

  return { skill, recentEvents, recentErrors, tools, daily };
}

export function getErrorMetrics(limit = 200, opts = {}) {
  return queryRows(`
    SELECT e.error_key, e.timestamp, e.severity, e.category, e.message,
           e.skill_name, e.turn_id, e.source_path, e.source_line, e.evidence_id,
           e.source, r.raw_json
    FROM errors e
    LEFT JOIN raw_events r ON r.event_id = e.evidence_id
    ${whereOnly(opts, "e")}
    ORDER BY COALESCE(e.timestamp, '') DESC, e.source_path DESC, e.source_line DESC
    LIMIT ${sqlNumber(limit)}
  `);
}

export function getTimelineMetrics(opts = {}) {
  return queryRows(`
    WITH days AS (
      SELECT substr(se.timestamp, 1, 10) AS day, COUNT(*) AS skill_events, 0 AS errors, 0 AS tokens
      FROM skill_events se
      WHERE timestamp IS NOT NULL ${andFilter(opts, "se")}
      GROUP BY substr(se.timestamp, 1, 10)
      UNION ALL
      SELECT substr(e.timestamp, 1, 10) AS day, 0 AS skill_events, COUNT(*) AS errors, 0 AS tokens
      FROM errors e
      WHERE timestamp IS NOT NULL ${andFilter(opts, "e")}
      GROUP BY substr(e.timestamp, 1, 10)
      UNION ALL
      SELECT day, 0 AS skill_events, 0 AS errors,
             COALESCE(SUM(max_tokens), 0) AS tokens
      FROM (
        SELECT substr(tu.timestamp, 1, 10) AS day, turn_id, MAX(total_tokens) AS max_tokens
        FROM token_usage tu
        WHERE timestamp IS NOT NULL AND turn_id IS NOT NULL ${andFilter(opts, "tu")}
        GROUP BY substr(tu.timestamp, 1, 10), turn_id
      )
      GROUP BY day
    )
    SELECT day,
           SUM(skill_events) AS skill_events,
           SUM(errors) AS errors,
           SUM(tokens) AS tokens
    FROM days
    WHERE day IS NOT NULL AND day != ''
    GROUP BY day
    ORDER BY day ASC
  `);
}

// Side-by-side aggregates for codex vs claude vs cursor. Used by the Comparison tab.
export function getComparisonMetrics(opts = {}) {
  const fromAnd = opts?.from ? ` AND timestamp >= ${sqlString(opts.from)}` : "";
  const toAnd = opts?.to ? ` AND timestamp <= ${sqlString(opts.to)}` : "";
  const sources = ["codex", "claude", "cursor"];
  const rows = sources.map((src) => {
    const totals = one(`
      SELECT
        (SELECT COUNT(*) FROM turns WHERE source = ${sqlString(src)}${opts?.from ? ` AND started_at >= ${sqlString(opts.from)}` : ""}${opts?.to ? ` AND started_at <= ${sqlString(opts.to)}` : ""}) AS turns,
        (SELECT COUNT(*) FROM skills WHERE source = ${sqlString(src)}) AS skills,
        (SELECT COUNT(*) FROM skill_events WHERE source = ${sqlString(src)}${fromAnd}${toAnd}) AS skill_events,
        (SELECT COUNT(DISTINCT skill_name) FROM skill_events WHERE source = ${sqlString(src)}${fromAnd}${toAnd}) AS active_skills,
        (SELECT COUNT(*) FROM tool_events WHERE source = ${sqlString(src)}${fromAnd}${toAnd}) AS tool_calls,
        (SELECT COUNT(*) FROM tool_events WHERE source = ${sqlString(src)} AND status='failed'${fromAnd}${toAnd}) AS tool_failed,
        (SELECT COUNT(*) FROM errors WHERE source = ${sqlString(src)}${fromAnd}${toAnd}) AS errors,
        -- total_tokens replaced below with the canonical billable value
        -- so this column always agrees with cost-overview + pricing.
        0 AS total_tokens
    `);
    // Per-source billable: pull rows for THIS source only and normalize.
    totals.total_tokens = billableTokensBySource({ ...opts, source: src })[src] || 0;
    const topTools = queryRows(`
      SELECT tool_name, COUNT(*) AS calls,
             SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS failed
      FROM tool_events
      WHERE source = ${sqlString(src)} AND tool_name IS NOT NULL${fromAnd}${toAnd}
      GROUP BY tool_name
      ORDER BY calls DESC
      LIMIT 8
    `);
    const topModels = queryRows(`
      SELECT model, COUNT(*) AS turns
      FROM turns
      WHERE source = ${sqlString(src)} AND model IS NOT NULL${opts?.from ? ` AND started_at >= ${sqlString(opts.from)}` : ""}${opts?.to ? ` AND started_at <= ${sqlString(opts.to)}` : ""}
      GROUP BY model
      ORDER BY turns DESC
      LIMIT 5
    `);
    const daily = queryRows(`
      SELECT substr(timestamp,1,10) AS day, COUNT(*) AS events
      FROM skill_events
      WHERE source = ${sqlString(src)} AND timestamp IS NOT NULL${fromAnd}${toAnd}
      GROUP BY day ORDER BY day ASC
    `);

    // Daily token usage. Take the max total_tokens per turn (turns get
    // cumulative usage on each message), then sum per day.
    const dailyTokens = queryRows(`
      SELECT day, COALESCE(SUM(max_tokens), 0) AS tokens
      FROM (
        SELECT substr(timestamp,1,10) AS day, turn_id, MAX(total_tokens) AS max_tokens
        FROM token_usage
        WHERE source = ${sqlString(src)} AND turn_id IS NOT NULL AND timestamp IS NOT NULL${fromAnd}${toAnd}
        GROUP BY substr(timestamp,1,10), turn_id
      )
      GROUP BY day ORDER BY day ASC
    `);

    // Input vs output vs cached token split, single aggregate.
    const tokenBreakdown = one(`
      SELECT COALESCE(SUM(input_tokens),0) AS input_tokens,
             COALESCE(SUM(cached_input_tokens),0) AS cached_input_tokens,
             COALESCE(SUM(output_tokens),0) AS output_tokens,
             COALESCE(SUM(reasoning_output_tokens),0) AS reasoning_tokens
      FROM token_usage
      WHERE source = ${sqlString(src)}${fromAnd}${toAnd}
    `, { input_tokens: 0, cached_input_tokens: 0, output_tokens: 0, reasoning_tokens: 0 });

    // Hourly cadence — useful to see when each tool is actually used.
    const hourly = queryRows(`
      SELECT CAST(strftime('%H', timestamp) AS INTEGER) AS hour, COUNT(*) AS events
      FROM skill_events
      WHERE source = ${sqlString(src)} AND timestamp IS NOT NULL${fromAnd}${toAnd}
      GROUP BY hour ORDER BY hour ASC
    `);

    return { source: src, totals, topTools, topModels, daily, dailyTokens, tokenBreakdown, hourly };
  });
  return { sources: rows };
}

export function getEvidence(id) {
  return one(
    `SELECT event_id, source_path, source_line, timestamp, event_type, payload_type, raw_json
     FROM raw_events WHERE event_id = ${sqlString(id)}`,
    null
  );
}

// ---- Pricing ------------------------------------------------------------
import { computeCost } from "./pricing.js";

// Aggregates per-(source, model) token sums, then applies the pricing table
// from pricing.js to produce dollar costs. Respects source + date range.
export function getPricingMetrics(opts = {}) {
  const tuWhere = whereFilter(opts, "tu");
  const tuJoinAnd = tuWhere ? ` AND ${tuWhere}` : "";

  // Per-(source, model) token aggregates. Joins token_usage → turns to attach
  // the model string, then sums each token bucket per (source, model).
  const modelRows = queryRows(`
    SELECT
      tu.source AS source,
      COALESCE(t.model, '(unknown)') AS model,
      COUNT(DISTINCT tu.turn_id) AS sessions,
      COALESCE(SUM(tu.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(tu.cached_input_tokens), 0) AS cached_input_tokens,
      COALESCE(SUM(tu.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(tu.reasoning_output_tokens), 0) AS reasoning_output_tokens
    FROM token_usage tu
    LEFT JOIN turns t ON t.turn_id = tu.turn_id
    WHERE 1=1 ${tuJoinAnd}
    GROUP BY tu.source, COALESCE(t.model, '(unknown)')
    ORDER BY sessions DESC
  `);

  // Daily spend: aggregate tokens per (day, source, model), price each bucket,
  // then sum back up to one row per (day, source).
  const dailyRows = queryRows(`
    SELECT
      substr(tu.timestamp, 1, 10) AS day,
      tu.source AS source,
      COALESCE(t.model, '(unknown)') AS model,
      COALESCE(SUM(tu.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(tu.cached_input_tokens), 0) AS cached_input_tokens,
      COALESCE(SUM(tu.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(tu.reasoning_output_tokens), 0) AS reasoning_output_tokens
    FROM token_usage tu
    LEFT JOIN turns t ON t.turn_id = tu.turn_id
    WHERE tu.timestamp IS NOT NULL ${tuJoinAnd}
    GROUP BY day, tu.source, COALESCE(t.model, '(unknown)')
    ORDER BY day ASC
  `);

  // Per-skill spend: skill_events → turns → token_usage, summed and priced.
  // A turn can attribute tokens to multiple skills (mentions etc.), so we
  // distinct (skill, turn) first to avoid double-counting tokens.
  const skillRows = queryRows(`
    WITH skill_turns AS (
      SELECT DISTINCT se.skill_name, se.turn_id, se.source
      FROM skill_events se
      WHERE turn_id IS NOT NULL ${andFilter(opts, "se")}
    )
    SELECT
      st.skill_name,
      st.source,
      COALESCE(t.model, '(unknown)') AS model,
      COALESCE(SUM(tu.input_tokens), 0) AS input_tokens,
      COALESCE(SUM(tu.cached_input_tokens), 0) AS cached_input_tokens,
      COALESCE(SUM(tu.output_tokens), 0) AS output_tokens,
      COALESCE(SUM(tu.reasoning_output_tokens), 0) AS reasoning_output_tokens
    FROM skill_turns st
    JOIN turns t ON t.turn_id = st.turn_id
    JOIN token_usage tu ON tu.turn_id = st.turn_id
    GROUP BY st.skill_name, st.source, COALESCE(t.model, '(unknown)')
  `);

  // Apply pricing in JS for clarity.
  const models = modelRows.map((r) => {
    const c = computeCost(r.source, r.model, r);
    return {
      source: r.source,
      model: r.model,
      sessions: Number(r.sessions || 0),
      input_tokens: Number(r.input_tokens || 0),
      // Normalize "fresh input" across providers (see freshInputTokens docs).
      // This is what the UI should display; raw input_tokens has different
      // semantics between Codex and Claude.
      fresh_input_tokens: c.fresh_input_tokens,
      cached_input_tokens: Number(r.cached_input_tokens || 0),
      output_tokens: Number(r.output_tokens || 0),
      reasoning_output_tokens: Number(r.reasoning_output_tokens || 0),
      cost: c.cost,
      input_cost: c.input_cost,
      cached_cost: c.cached_cost,
      output_cost: c.output_cost,
      saved_by_caching: c.saved_by_caching,
      priced: c.priced
    };
  }).sort((a, b) => b.cost - a.cost);

  const totals = {
    overall: 0,
    codex: 0,
    claude: 0,
    saved_by_caching: 0,
    unpriced_tokens: 0,
    // Provider-normalized totals — sum the per-model fresh figures so we don't
    // mix Codex's (total) and Claude's (already-fresh) input fields.
    total_fresh_input: 0,
    total_cached: 0,
    total_output: 0
  };
  for (const m of models) {
    totals.overall += m.cost;
    totals[m.source] = (totals[m.source] || 0) + m.cost;
    totals.saved_by_caching += m.saved_by_caching;
    totals.total_fresh_input += m.fresh_input_tokens;
    totals.total_cached += m.cached_input_tokens;
    totals.total_output += m.output_tokens + m.reasoning_output_tokens;
    if (!m.priced) {
      totals.unpriced_tokens += m.input_tokens + m.output_tokens;
    }
  }

  // Merge daily rows into one record per (day, source) by summing model costs.
  const dailyMap = new Map();
  for (const r of dailyRows) {
    const c = computeCost(r.source, r.model, r);
    const key = `${r.day}|${r.source}`;
    const existing = dailyMap.get(key) || { day: r.day, source: r.source, cost: 0 };
    existing.cost += c.cost;
    dailyMap.set(key, existing);
  }
  // Pivot to one row per day with codex + claude columns for the chart.
  const dailyByDay = new Map();
  for (const entry of dailyMap.values()) {
    const row = dailyByDay.get(entry.day) || { day: entry.day, codex: 0, claude: 0 };
    row[entry.source] = (row[entry.source] || 0) + entry.cost;
    dailyByDay.set(entry.day, row);
  }
  const daily = [...dailyByDay.values()].sort((a, b) => a.day.localeCompare(b.day));

  // Per-skill: bucket by skill name, summing cost across its (model, turn) tuples.
  const perSkillMap = new Map();
  for (const r of skillRows) {
    const c = computeCost(r.source, r.model, r);
    const key = r.skill_name;
    const existing = perSkillMap.get(key) || {
      skill_name: r.skill_name,
      source: r.source,
      cost: 0,
      sessions: 0
    };
    existing.cost += c.cost;
    existing.sessions += 1;
    perSkillMap.set(key, existing);
  }
  const perSkill = [...perSkillMap.values()]
    .filter((r) => r.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 12);

  return { totals, models, daily, perSkill };
}

// ---- Cost & Tokens overview (the new dashboard center stage) -----------
// One endpoint, many cuts of the same fundamental data: every token_usage row
// joined to its turn, priced via the model rate card, then sliced by day,
// hour, day-of-week, project (cwd), model, and source. Plus headline counters
// and outlier surfacing for "where did the money actually go."

function safeBasename(cwd) {
  if (!cwd || typeof cwd !== "string") return "(unknown)";
  // Strip trailing slash, take last 2 path components for context — gives
  // ".../skill-analytics" rather than just "skill-analytics" when there are
  // multiple projects with similar leaf names.
  const trimmed = cwd.replace(/\/$/, "");
  const parts = trimmed.split("/").filter(Boolean);
  if (parts.length === 0) return "(unknown)";
  if (parts.length === 1) return parts[0];
  return `…/${parts[parts.length - 2]}/${parts[parts.length - 1]}`;
}

export function getCostOverview(opts = {}) {
  const tuWhere = whereFilter(opts, "tu");
  const tuJoinAnd = tuWhere ? ` AND ${tuWhere}` : "";
  // Project scope filters to one cwd. Applied on the joined turns row,
  // not token_usage (token_usage doesn't carry cwd). When set, the
  // entire payload — headline, byDay, byModel, etc. — is implicitly
  // about that one project. Useful for "what did iLit cost me last
  // month" type questions from the ⌘K palette.
  const projectAnd = opts?.project
    ? ` AND t.cwd = ${sqlString(opts.project)}`
    : "";

  // Raw per-(day, source, model, cwd, turn) aggregates — we'll price these in
  // JS and then re-aggregate along whichever dimension each card needs.
  const rows = queryRows(`
    SELECT
      tu.timestamp AS ts,
      substr(tu.timestamp, 1, 10) AS day,
      strftime('%H', tu.timestamp) AS hour,
      strftime('%w', tu.timestamp) AS dow,
      tu.turn_id AS turn_id,
      tu.source AS source,
      COALESCE(t.model, '(unknown)') AS model,
      COALESCE(t.cwd, '(unknown)') AS cwd,
      t.started_at AS started_at,
      t.completed_at AS completed_at,
      t.duration_ms AS duration_ms,
      COALESCE(tu.input_tokens, 0) AS input_tokens,
      COALESCE(tu.cached_input_tokens, 0) AS cached_input_tokens,
      COALESCE(tu.output_tokens, 0) AS output_tokens,
      COALESCE(tu.reasoning_output_tokens, 0) AS reasoning_output_tokens
    FROM token_usage tu
    LEFT JOIN turns t ON t.turn_id = tu.turn_id
    WHERE tu.timestamp IS NOT NULL ${tuJoinAnd}${projectAnd}
  `);

  // Price every row up-front. Each priced row carries cost_total + the
  // per-bucket breakdown so the slice aggregators below stay simple.
  const priced = rows.map((r) => {
    const c = computeCost(r.source, r.model, r);
    return {
      ts: r.ts,
      day: r.day,
      hour: Number(r.hour),
      dow: Number(r.dow),
      turn_id: r.turn_id,
      source: r.source,
      model: r.model,
      cwd: r.cwd,
      started_at: r.started_at,
      completed_at: r.completed_at,
      duration_ms: r.duration_ms,
      input_tokens: Number(r.input_tokens),
      cached_input_tokens: Number(r.cached_input_tokens),
      output_tokens: Number(r.output_tokens),
      reasoning_output_tokens: Number(r.reasoning_output_tokens),
      cost: c.cost,
      input_cost: c.input_cost,
      cached_cost: c.cached_cost,
      output_cost: c.output_cost,
      saved_by_caching: c.saved_by_caching,
      fresh_input_tokens: c.fresh_input_tokens
    };
  });

  // ─── slice 1: by-day ───────────────────────────────────────────────────
  const byDayMap = new Map();
  for (const r of priced) {
    const d = byDayMap.get(r.day) || {
      day: r.day,
      cost: 0,
      cost_input: 0,
      cost_cached: 0,
      cost_output: 0,
      tokens_input: 0,
      tokens_cached: 0,
      tokens_output: 0,
      tokens_reasoning: 0,
      sessions: new Set(),
    };
    d.cost += r.cost;
    d.cost_input += r.input_cost;
    d.cost_cached += r.cached_cost;
    d.cost_output += r.output_cost;
    d.tokens_input += r.fresh_input_tokens;
    d.tokens_cached += r.cached_input_tokens;
    d.tokens_output += r.output_tokens;
    d.tokens_reasoning += r.reasoning_output_tokens;
    if (r.turn_id) d.sessions.add(r.turn_id);
    byDayMap.set(r.day, d);
  }
  const byDay = [...byDayMap.values()]
    .map((d) => ({ ...d, sessions: d.sessions.size }))
    .sort((a, b) => a.day.localeCompare(b.day));

  // ─── slice 2: by-model (source-aware) ──────────────────────────────────
  const byModelMap = new Map();
  for (const r of priced) {
    const key = `${r.source}::${r.model}`;
    const m = byModelMap.get(key) || {
      source: r.source,
      model: r.model,
      sessions: new Set(),
      tokens_total: 0,
      cost: 0,
    };
    m.sessions.add(r.turn_id);
    m.tokens_total += r.fresh_input_tokens + r.cached_input_tokens + r.output_tokens + r.reasoning_output_tokens;
    m.cost += r.cost;
    byModelMap.set(key, m);
  }
  const totalSpend = byDay.reduce((acc, d) => acc + d.cost, 0);
  const byModel = [...byModelMap.values()]
    .map((m) => ({
      source: m.source,
      model: m.model,
      sessions: m.sessions.size,
      tokens_total: m.tokens_total,
      cost: m.cost,
      pct_of_total: totalSpend > 0 ? (m.cost / totalSpend) * 100 : 0,
    }))
    .sort((a, b) => b.cost - a.cost);

  // ─── slice 3: by-project (cwd) ─────────────────────────────────────────
  const byProjectMap = new Map();
  for (const r of priced) {
    const m = byProjectMap.get(r.cwd) || {
      cwd: r.cwd,
      cwd_short: safeBasename(r.cwd),
      sessions: new Set(),
      cost: 0,
      tokens: 0,
    };
    m.sessions.add(r.turn_id);
    m.cost += r.cost;
    m.tokens += r.fresh_input_tokens + r.cached_input_tokens + r.output_tokens + r.reasoning_output_tokens;
    byProjectMap.set(r.cwd, m);
  }
  const byProject = [...byProjectMap.values()]
    .map((m) => ({ ...m, sessions: m.sessions.size }))
    .filter((m) => m.cost > 0)
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15);

  // ─── slice 4: by-hour (0–23, UTC; user works in roughly one TZ so this
  //                       still surfaces daily rhythm) ─────────────────────
  const hourBuckets = Array.from({ length: 24 }, (_, h) => ({
    hour: h,
    sessions: new Set(),
    cost: 0,
    tokens: 0,
  }));
  for (const r of priced) {
    if (Number.isInteger(r.hour) && r.hour >= 0 && r.hour < 24) {
      const b = hourBuckets[r.hour];
      b.sessions.add(r.turn_id);
      b.cost += r.cost;
      b.tokens += r.fresh_input_tokens + r.output_tokens;
    }
  }
  const byHour = hourBuckets.map((b) => ({
    hour: b.hour,
    sessions: b.sessions.size,
    cost: b.cost,
    tokens: b.tokens,
  }));

  // ─── slice 5: by-day-of-week (0=Sun..6=Sat) ────────────────────────────
  const dowNames = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const dowBuckets = Array.from({ length: 7 }, (_, d) => ({
    dow: d,
    label: dowNames[d],
    sessions: new Set(),
    cost: 0,
  }));
  for (const r of priced) {
    if (Number.isInteger(r.dow) && r.dow >= 0 && r.dow < 7) {
      const b = dowBuckets[r.dow];
      b.sessions.add(r.turn_id);
      b.cost += r.cost;
    }
  }
  const byDayOfWeek = dowBuckets.map((b) => ({
    dow: b.dow,
    label: b.label,
    sessions: b.sessions.size,
    cost: b.cost,
  }));

  // ─── slice 6: top sessions by cost ─────────────────────────────────────
  const bySessionMap = new Map();
  for (const r of priced) {
    if (!r.turn_id) continue;
    const s = bySessionMap.get(r.turn_id) || {
      turn_id: r.turn_id,
      source: r.source,
      model: r.model,
      cwd: r.cwd,
      cwd_short: safeBasename(r.cwd),
      started_at: r.started_at,
      duration_ms: r.duration_ms,
      cost: 0,
      tokens_total: 0,
    };
    s.cost += r.cost;
    s.tokens_total += r.fresh_input_tokens + r.cached_input_tokens + r.output_tokens + r.reasoning_output_tokens;
    bySessionMap.set(r.turn_id, s);
  }
  const topSessions = [...bySessionMap.values()]
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 15);

  // ─── headline counters ────────────────────────────────────────────────
  const totalCachedTokens = priced.reduce((a, r) => a + r.cached_input_tokens, 0);
  const totalFreshInput = priced.reduce((a, r) => a + r.fresh_input_tokens, 0);
  const totalOutput = priced.reduce((a, r) => a + r.output_tokens, 0);
  const totalReasoning = priced.reduce((a, r) => a + r.reasoning_output_tokens, 0);
  const totalSaved = priced.reduce((a, r) => a + r.saved_by_caching, 0);
  const allTokensInput = totalFreshInput + totalCachedTokens;
  const cacheHitRate = allTokensInput > 0 ? totalCachedTokens / allTokensInput : 0;

  // Today / 7d / 30d windows relative to the data's latest day so the panel
  // is meaningful even when the user hasn't run anything in the last hour.
  const sortedDays = byDay.map((d) => d.day).sort();
  const latestDay = sortedDays[sortedDays.length - 1];
  const isoNDaysBefore = (n) => {
    if (!latestDay) return null;
    const d = new Date(latestDay + "T00:00:00Z");
    d.setUTCDate(d.getUTCDate() - n);
    return d.toISOString().slice(0, 10);
  };
  const sumSince = (cutoff) =>
    cutoff
      ? byDay.filter((d) => d.day >= cutoff).reduce((a, d) => a + d.cost, 0)
      : 0;

  const spend7d = sumSince(isoNDaysBefore(6));
  const spend30d = sumSince(isoNDaysBefore(29));
  const spendToday = byDay.find((d) => d.day === latestDay)?.cost || 0;

  // Most expensive single day
  const mostExpensiveDay = byDay.reduce(
    (best, d) => (d.cost > (best?.cost || 0) ? d : best),
    null
  );

  // Burn alerts: days where spend > 3x the median daily spend in the window.
  // Useful for spotting "oh wait, what happened on the 4th."
  const costs = byDay.map((d) => d.cost).filter((c) => c > 0).sort((a, b) => a - b);
  const medianDailyCost = costs.length ? costs[Math.floor(costs.length / 2)] : 0;
  const burnAlerts = byDay
    .filter((d) => medianDailyCost > 0 && d.cost > medianDailyCost * 3)
    .map((d) => ({
      day: d.day,
      cost: d.cost,
      multiple: d.cost / medianDailyCost,
    }))
    .sort((a, b) => b.cost - a.cost)
    .slice(0, 10);

  // Concurrency: did Claude and Codex run on the same day? Tells the user
  // whether they've genuinely been using both or just one.
  const claudeDays = new Set();
  const codexDays = new Set();
  for (const r of priced) {
    if (r.source === "claude") claudeDays.add(r.day);
    if (r.source === "codex") codexDays.add(r.day);
  }
  const overlapDays = [...claudeDays].filter((d) => codexDays.has(d)).length;

  // Per-source totals for the headline split. Track both cost and
  // billable tokens (fresh input + output + reasoning) per source so the
  // Wrapped cards don't have to derive them from comparison's
  // total_tokens (which leaks cached tokens into the headline number).
  const sourceTotals = { claude: 0, codex: 0 };
  const sourceBillableTokens = { claude: 0, codex: 0 };
  const sourceSessions = { claude: new Set(), codex: new Set() };
  for (const r of priced) {
    sourceTotals[r.source] = (sourceTotals[r.source] || 0) + r.cost;
    sourceBillableTokens[r.source] =
      (sourceBillableTokens[r.source] || 0) +
      r.fresh_input_tokens +
      r.output_tokens +
      r.reasoning_output_tokens;
    if (r.turn_id) sourceSessions[r.source].add(r.turn_id);
  }
  const sourceSessionCounts = {
    claude: sourceSessions.claude.size,
    codex: sourceSessions.codex.size,
  };

  return {
    headline: {
      spend_total: totalSpend,
      spend_today: spendToday,
      spend_7d: spend7d,
      spend_30d: spend30d,
      sessions_total: bySessionMap.size,
      active_days: byDay.filter((d) => d.cost > 0).length,
      tokens_input: totalFreshInput,
      tokens_cached: totalCachedTokens,
      tokens_output: totalOutput,
      tokens_reasoning: totalReasoning,
      // "Billable tokens" — what Claude / Codex actually charge against
      // your quota. Excludes cache reads (priced near zero). This is the
      // number we surface as the headline "Tokens" figure everywhere
      // except the Cache Effectiveness panel; including cached read
      // tokens here would make the dashboard 95%+ "cached" and bury the
      // useful signal.
      tokens_billable: totalFreshInput + totalOutput + totalReasoning,
      tokens_total: totalFreshInput + totalCachedTokens + totalOutput + totalReasoning,
      cache_hit_rate: cacheHitRate,
      cache_savings: totalSaved,
      avg_session_cost: bySessionMap.size > 0 ? totalSpend / bySessionMap.size : 0,
      most_expensive_day: mostExpensiveDay
        ? { day: mostExpensiveDay.day, cost: mostExpensiveDay.cost }
        : null,
      median_daily_cost: medianDailyCost,
      overlap_days: overlapDays,
      claude_only_days: [...claudeDays].filter((d) => !codexDays.has(d)).length,
      codex_only_days: [...codexDays].filter((d) => !claudeDays.has(d)).length,
      source_split: sourceTotals,
      source_billable_tokens: sourceBillableTokens,
      source_sessions: sourceSessionCounts,
      latest_day: latestDay,
    },
    byDay,
    byModel,
    byProject,
    byHour,
    byDayOfWeek,
    topSessions,
    burnAlerts,
  };
}
