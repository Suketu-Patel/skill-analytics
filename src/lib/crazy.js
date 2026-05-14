// Crazy-tab analytics. Eight metrics that turn raw JSONL session
// transcripts into uncomfortably honest charts. Every function returns
// plain JSON and reads only from the local SQLite DB, no external
// services. Heavy queries memoize via metric-cache if needed; for now
// they all run in <200ms on a ~200K-event corpus.
import fs from "node:fs";
import path from "node:path";
import { queryRows, sqlString } from "./sqlite.js";

// — Shared helpers ────────────────────────────────────────────────────

// Words/phrases the user types AFTER an assistant turn when the
// previous answer didn't land. Conservative on purpose, we'd rather
// undercount than over-flag every "thanks, but" as frustration.
const CORRECTION_RE =
  /\b(no|nope|wrong|actually|instead|that'?s not|try again|undo|revert|broken|fix this|redo|start over|didn'?t (?:work|finish|complete)|stop|don'?t|why (?:did|are) you)\b/i;

// Phrases the model says when it's stalling / over-apologizing /
// performing competence rather than demonstrating it. The literature
// calls this "obsequiousness" and "sycophancy"; we just call it the
// pep-talk index.
const PEPTALK_RE =
  /\b(great question|good (?:question|catch|point)|excellent|absolutely|i see what'?s happening|i understand|let me (?:help|fix|investigate)|i'?ll (?:fix|help|investigate|take a look)|perfect|exactly|happy to|of course|great idea|that makes sense)\b/i;

function parseRaw(json) {
  try { return JSON.parse(json); } catch { return null; }
}

// Pulls the textual body out of a raw_events row, regardless of which
// JSONL flavor (Codex's nested payload, Claude's message.content array).
function extractMessageText(row) {
  const j = parseRaw(row.raw_json);
  if (!j) return "";
  // Codex shape: {type: "event_msg", payload: {type: "user_message", message: "..."}}
  if (j.payload?.message && typeof j.payload.message === "string") return j.payload.message;
  // Claude shape: {message: {content: [{type: "text", text: "..."}]}}
  if (Array.isArray(j.message?.content)) {
    return j.message.content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  if (typeof j.message?.content === "string") return j.message.content;
  // Claude assistant shape: top-level content array
  if (Array.isArray(j.content)) {
    return j.content
      .filter((p) => p?.type === "text" && typeof p.text === "string")
      .map((p) => p.text)
      .join("\n");
  }
  return "";
}

function hourFromIso(iso) {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.getHours();
}

// — #2: Frustration curve (hour of day) ───────────────────────────────
//
// For each user message, hour-bucket the timestamp and flag if it
// contains a correction phrase. Output the correction-rate per hour
// so the user can see when in the day they push back the hardest.
export function frustrationByHour() {
  const rows = queryRows(`
    SELECT timestamp, raw_json
    FROM raw_events
    WHERE payload_type IN ('user_message', 'user')
       OR event_type = 'user'
    ORDER BY timestamp
  `);
  const buckets = Array.from({ length: 24 }, () => ({ total: 0, frustrated: 0 }));
  for (const r of rows) {
    const h = hourFromIso(r.timestamp);
    if (h == null) continue;
    buckets[h].total++;
    const text = extractMessageText(r);
    if (text && CORRECTION_RE.test(text)) buckets[h].frustrated++;
  }
  return {
    by_hour: buckets.map((b, h) => ({
      hour: h,
      total: b.total,
      frustrated: b.frustrated,
      rate: b.total > 0 ? b.frustrated / b.total : 0,
    })),
    total_messages: rows.length,
    total_frustrated: buckets.reduce((a, b) => a + b.frustrated, 0),
  };
}

// — #5: Cost per LOC kept (approximation) ─────────────────────────────
//
// For each cwd, sum the spend across turns that wrote there, divide by
// the current LOC of source files in that repo. Imperfect (counts cost
// that produced no code, ignores deleted lines, doesn't track AI vs
// human authorship line by line), but the ratio still surfaces the
// repos where you spent a fortune and have little to show.
function repoLineCount(cwd) {
  if (!cwd || !fs.existsSync(cwd)) return 0;
  // Only count source files we recognize, skip node_modules/.git/etc.
  // Bounded depth + extension whitelist keeps this snappy.
  const EXT = new Set([
    ".ts", ".tsx", ".js", ".jsx", ".mjs", ".cjs",
    ".py", ".go", ".rs", ".java", ".kt", ".swift",
    ".rb", ".php", ".c", ".cc", ".cpp", ".h", ".hpp",
    ".cs", ".scala", ".lua", ".sh", ".sql",
    ".html", ".css", ".scss", ".vue", ".svelte",
  ]);
  const SKIP = new Set(["node_modules", ".git", "dist", "build", ".next", "vendor", "target", ".venv", "__pycache__"]);
  let lines = 0;
  function walk(dir, depth) {
    if (depth > 8) return;
    let entries;
    try { entries = fs.readdirSync(dir, { withFileTypes: true }); } catch { return; }
    for (const e of entries) {
      if (SKIP.has(e.name)) continue;
      const full = path.join(dir, e.name);
      if (e.isDirectory()) {
        walk(full, depth + 1);
      } else if (EXT.has(path.extname(e.name))) {
        try {
          const data = fs.readFileSync(full, "utf8");
          lines += data.split("\n").length;
        } catch { /* unreadable, skip */ }
      }
    }
  }
  walk(cwd, 0);
  return lines;
}

export function costPerLOCKept(limit = 12) {
  const rows = queryRows(`
    SELECT t.cwd,
           COUNT(DISTINCT t.turn_id) AS turns,
           SUM(COALESCE(tu.input_tokens,0) + COALESCE(tu.output_tokens,0)
               + COALESCE(tu.reasoning_output_tokens,0)) AS billable_tokens
    FROM turns t
    LEFT JOIN token_usage tu ON tu.turn_id = t.turn_id
    WHERE t.cwd IS NOT NULL AND t.cwd <> ''
    GROUP BY t.cwd
    HAVING turns > 5
    ORDER BY billable_tokens DESC
    LIMIT ${limit}
  `);
  // Use the same crude $/MTok approximation cost-overview uses for
  // rough cost. We could pull pricing.js for per-model rates but the
  // ratio is what matters here, not absolute dollar accuracy.
  const ROUGH_USD_PER_MTOK = 8;
  return rows.map((r) => {
    const tokens = Number(r.billable_tokens || 0);
    const usd = (tokens / 1_000_000) * ROUGH_USD_PER_MTOK;
    const loc = repoLineCount(r.cwd);
    return {
      cwd: r.cwd,
      cwd_short: r.cwd.replace(/^.*?\/([^/]+\/[^/]+)$/, "$1"),
      turns: Number(r.turns),
      tokens,
      cost: usd,
      loc,
      cost_per_loc: loc > 0 ? usd / loc : null,
      exists: loc > 0,
    };
  });
}

// — #6: Context-broke-the-camel's-back ────────────────────────────────
//
// For each session, walk turns in order, accumulate billable tokens.
// For each turn, check if the very next user message contains a
// correction. Bucket turns by cumulative-token band and report the
// correction-rate per band. Reveals at what context length the model's
// answers stop landing for you.
export function contextDegradationCurve() {
  const turns = queryRows(`
    SELECT t.turn_id, t.session_id, t.started_at, t.source,
           COALESCE(tu.input_tokens,0) + COALESCE(tu.output_tokens,0)
             + COALESCE(tu.reasoning_output_tokens,0) AS toks
    FROM turns t
    LEFT JOIN token_usage tu ON tu.turn_id = t.turn_id
    WHERE t.session_id IS NOT NULL AND t.started_at IS NOT NULL
    ORDER BY t.session_id, t.started_at
  `);
  const userMsgs = queryRows(`
    SELECT timestamp, raw_json, source
    FROM raw_events
    WHERE payload_type IN ('user_message', 'user') OR event_type = 'user'
    ORDER BY timestamp
  `);
  // Sort user msgs into per-session timelines via source_path proximity.
  // We index by timestamp and scan for "is there a frustrated user msg
  // within 5 minutes after the turn ended". Cheap and good enough.
  const corrTimes = [];
  for (const m of userMsgs) {
    if (!m.timestamp) continue;
    const text = extractMessageText(m);
    if (text && CORRECTION_RE.test(text)) {
      corrTimes.push(new Date(m.timestamp).getTime());
    }
  }
  corrTimes.sort((a, b) => a - b);
  function hasCorrectionShortlyAfter(iso) {
    if (!iso) return false;
    const start = new Date(iso).getTime();
    if (Number.isNaN(start)) return false;
    // Binary search the lower bound, then scan forward.
    let lo = 0, hi = corrTimes.length;
    while (lo < hi) {
      const mid = (lo + hi) >>> 1;
      if (corrTimes[mid] < start) lo = mid + 1; else hi = mid;
    }
    const t = corrTimes[lo];
    return t != null && t - start < 5 * 60 * 1000;
  }

  // Per-session cumulative.
  let lastSession = null;
  let cumulative = 0;
  const BUCKETS = [
    [0, 10_000, "0-10k"],
    [10_000, 25_000, "10-25k"],
    [25_000, 50_000, "25-50k"],
    [50_000, 100_000, "50-100k"],
    [100_000, 200_000, "100-200k"],
    [200_000, Infinity, "200k+"],
  ];
  const out = BUCKETS.map(([, , label]) => ({ band: label, turns: 0, corrected: 0, rate: 0 }));
  for (const t of turns) {
    if (t.session_id !== lastSession) {
      lastSession = t.session_id;
      cumulative = 0;
    }
    cumulative += Number(t.toks || 0);
    const idx = BUCKETS.findIndex(([lo, hi]) => cumulative >= lo && cumulative < hi);
    if (idx < 0) continue;
    out[idx].turns++;
    if (hasCorrectionShortlyAfter(t.started_at)) out[idx].corrected++;
  }
  out.forEach((b) => { b.rate = b.turns > 0 ? b.corrected / b.turns : 0; });
  return { by_band: out };
}

// — #8: Phantom edit graveyard ────────────────────────────────────────
//
// Files Claude/Codex wrote that don't exist on disk anymore. Either
// you renamed them, you deleted them in disgust, or the AI hallucinated
// the path. The query pulls Edit/Write/apply_patch tool calls and the
// loop just stat()s each unique target.
export function phantomEdits(limit = 50) {
  const rows = queryRows(`
    SELECT tool_name, command, status, cwd, turn_id, source
    FROM tool_events
    WHERE tool_name IN ('Edit', 'Write', 'apply_patch')
       OR tool_name = 'MultiEdit'
    ORDER BY rowid DESC
    LIMIT 5000
  `);
  // Extract file_path from tool command JSON (Claude) or unified diff
  // body (Codex apply_patch). Keep it best-effort.
  function pathFromCommand(toolName, command) {
    if (!command) return null;
    // Claude Edit/Write/MultiEdit: command is JSON-ish args text.
    try {
      const j = JSON.parse(command);
      if (j.file_path) return j.file_path;
      if (j.path) return j.path;
    } catch { /* not JSON, keep going */ }
    // Codex apply_patch: look for "*** Update File:" / "*** Add File:"
    const m = command.match(/\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(\S+)/);
    if (m) return m[1];
    return null;
  }
  const seen = new Map();
  for (const r of rows) {
    const p = pathFromCommand(r.tool_name, r.command);
    if (!p) continue;
    const abs = path.isAbsolute(p) ? p : (r.cwd ? path.join(r.cwd, p) : p);
    if (seen.has(abs)) {
      const e = seen.get(abs);
      e.edits++;
    } else {
      seen.set(abs, {
        path: abs,
        cwd: r.cwd || null,
        edits: 1,
        last_source: r.source,
      });
    }
  }
  const out = [];
  for (const entry of seen.values()) {
    let exists = false;
    try { exists = fs.existsSync(entry.path); } catch { exists = false; }
    if (!exists) out.push(entry);
  }
  out.sort((a, b) => b.edits - a.edits);
  return out.slice(0, limit);
}

// — #9: Tool-call transitions (Sankey-ish) ────────────────────────────
//
// Sequential tool calls within the same turn, paired up: tool_i ->
// tool_{i+1}. Top N pairs by frequency surface your real workflows
// (Read -> Edit -> Bash is iterating; Read -> Read -> Read is wandering).
export function toolTransitions(limit = 15) {
  const rows = queryRows(`
    SELECT turn_id, tool_name
    FROM tool_events
    WHERE turn_id IS NOT NULL AND tool_name IS NOT NULL
    ORDER BY turn_id, rowid
  `);
  const counts = new Map();
  let lastTurn = null;
  let lastTool = null;
  for (const r of rows) {
    if (r.turn_id !== lastTurn) {
      lastTurn = r.turn_id;
      lastTool = null;
    }
    if (lastTool) {
      const key = `${lastTool}→${r.tool_name}`;
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    lastTool = r.tool_name;
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, limit)
    .map(([k, v]) => {
      const [from, to] = k.split("→");
      return { from, to, count: v };
    });
}

// — #18: Pep-talk index ───────────────────────────────────────────────
//
// How often the assistant says encouraging-but-empty things, and
// whether those sessions ended in user corrections. High pep-talk +
// high correction rate is the model bullshitting.
export function pepTalkIndex() {
  const rows = queryRows(`
    SELECT timestamp, raw_json, source
    FROM raw_events
    WHERE payload_type = 'assistant' OR event_type = 'assistant'
    ORDER BY timestamp
    LIMIT 10000
  `);
  let total = 0;
  let pepCount = 0;
  const topPhrases = new Map();
  for (const r of rows) {
    const text = extractMessageText(r);
    if (!text) continue;
    total++;
    const matches = text.match(new RegExp(PEPTALK_RE.source, "gi"));
    if (matches && matches.length > 0) {
      pepCount++;
      for (const m of matches) {
        const norm = m.toLowerCase().trim();
        topPhrases.set(norm, (topPhrases.get(norm) || 0) + 1);
      }
    }
  }
  return {
    total_assistant_msgs: total,
    pep_msgs: pepCount,
    rate: total > 0 ? pepCount / total : 0,
    top_phrases: [...topPhrases.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10)
      .map(([phrase, count]) => ({ phrase, count })),
  };
}

// — #19: Session replay (timeline) ────────────────────────────────────
//
// Returns a list of sessions for the picker, plus a way to fetch one
// session's full event stream ordered by timestamp. The UI plays it
// back. We cap message bodies at ~600 chars so the response is fast
// and the UI doesn't choke on a single 80k-token assistant turn.
export function listReplayableSessions(limit = 50) {
  return queryRows(`
    SELECT t.session_id,
           MIN(t.cwd) AS cwd,
           MIN(t.started_at) AS started_at,
           MAX(t.completed_at) AS ended_at,
           COUNT(*) AS turns,
           SUM(COALESCE(tu.input_tokens,0) + COALESCE(tu.output_tokens,0)
               + COALESCE(tu.reasoning_output_tokens,0)) AS tokens,
           MIN(t.source) AS source
    FROM turns t
    LEFT JOIN token_usage tu ON tu.turn_id = t.turn_id
    WHERE t.session_id IS NOT NULL
    GROUP BY t.session_id
    HAVING turns >= 3
    ORDER BY started_at DESC
    LIMIT ${limit}
  `);
}

export function sessionReplay(sessionId) {
  if (!sessionId) return { events: [] };
  // We pull from raw_events filtered to the source_paths in this session.
  // turns.source_path is per-turn, so we look up the distinct paths first.
  const paths = queryRows(`
    SELECT DISTINCT source_path FROM turns WHERE session_id = ${sqlString(sessionId)}
  `).map((r) => r.source_path).filter(Boolean);
  if (paths.length === 0) return { events: [] };
  const pathList = paths.map((p) => sqlString(p)).join(",");
  const rows = queryRows(`
    SELECT timestamp, event_type, payload_type, raw_json
    FROM raw_events
    WHERE source_path IN (${pathList})
      AND payload_type IN ('user_message', 'user', 'assistant', 'function_call', 'tool_use')
    ORDER BY timestamp
    LIMIT 500
  `);
  const events = rows.map((r) => {
    let kind = "other";
    if (r.payload_type === "assistant") kind = "assistant";
    else if (r.payload_type === "user_message" || r.payload_type === "user" || r.event_type === "user") kind = "user";
    else if (r.payload_type === "function_call" || r.payload_type === "tool_use") kind = "tool";
    const text = extractMessageText({ raw_json: r.raw_json });
    return {
      timestamp: r.timestamp,
      kind,
      text: text ? text.slice(0, 600) : "",
    };
  });
  return { events };
}

// — #21: AI fingerprint ───────────────────────────────────────────────
//
// One-page personality profile. Aggregates the existing tables into
// "things that would feel uncomfortably specific if a coworker said
// them about you".
export function aiFingerprint() {
  const topModel = queryRows(`
    SELECT model, COUNT(*) AS n
    FROM turns
    WHERE model IS NOT NULL AND model <> ''
    GROUP BY model
    ORDER BY n DESC
    LIMIT 3
  `);
  const peakHour = queryRows(`
    SELECT strftime('%H', started_at) AS h, COUNT(*) AS n
    FROM turns
    WHERE started_at IS NOT NULL
    GROUP BY h
    ORDER BY n DESC
    LIMIT 1
  `);
  const topProject = queryRows(`
    SELECT cwd, COUNT(*) AS n
    FROM turns
    WHERE cwd IS NOT NULL AND cwd <> ''
    GROUP BY cwd
    ORDER BY n DESC
    LIMIT 1
  `);
  const mostLovedTool = queryRows(`
    SELECT tool_name, COUNT(*) AS n
    FROM tool_events
    WHERE tool_name IS NOT NULL
    GROUP BY tool_name
    ORDER BY n DESC
    LIMIT 1
  `);
  const mostHatedTool = queryRows(`
    SELECT tool_name,
           SUM(CASE WHEN exit_code IS NOT NULL AND exit_code <> 0 THEN 1 ELSE 0 END) AS errs,
           COUNT(*) AS total
    FROM tool_events
    WHERE tool_name IS NOT NULL
    GROUP BY tool_name
    HAVING total >= 50
    ORDER BY (CAST(errs AS REAL) / total) DESC
    LIMIT 1
  `);
  const sessionStats = queryRows(`
    SELECT AVG(c) AS avg_turns
    FROM (SELECT COUNT(*) AS c FROM turns WHERE session_id IS NOT NULL GROUP BY session_id)
  `);
  // Top correction phrase the user types most.
  const userMsgs = queryRows(`
    SELECT raw_json FROM raw_events
    WHERE payload_type IN ('user_message', 'user') OR event_type = 'user'
    LIMIT 5000
  `);
  const phraseCounts = new Map();
  for (const m of userMsgs) {
    const text = extractMessageText(m);
    if (!text) continue;
    const matches = text.match(new RegExp(CORRECTION_RE.source, "gi"));
    if (matches) for (const x of matches) {
      const norm = x.toLowerCase().trim();
      phraseCounts.set(norm, (phraseCounts.get(norm) || 0) + 1);
    }
  }
  const topCorrection = [...phraseCounts.entries()].sort((a, b) => b[1] - a[1])[0];

  return {
    top_models: topModel.map((r) => ({ model: r.model, count: Number(r.n) })),
    peak_hour: peakHour[0] ? Number(peakHour[0].h) : null,
    peak_hour_count: peakHour[0] ? Number(peakHour[0].n) : 0,
    top_project: topProject[0]?.cwd || null,
    top_project_turns: topProject[0] ? Number(topProject[0].n) : 0,
    most_loved_tool: mostLovedTool[0]?.tool_name || null,
    most_loved_count: mostLovedTool[0] ? Number(mostLovedTool[0].n) : 0,
    most_hated_tool: mostHatedTool[0]?.tool_name || null,
    most_hated_error_rate: mostHatedTool[0]
      ? Number(mostHatedTool[0].errs) / Number(mostHatedTool[0].total)
      : 0,
    avg_turns_per_session: sessionStats[0]?.avg_turns
      ? Math.round(Number(sessionStats[0].avg_turns) * 10) / 10
      : 0,
    top_correction_phrase: topCorrection
      ? { phrase: topCorrection[0], count: topCorrection[1] }
      : null,
  };
}
