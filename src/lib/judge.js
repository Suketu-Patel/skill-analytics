// Layer 3 — LLM-as-judge for Skill invocations.
//
// Reads candidate Skill invocations from the existing schema, fetches a
// short transcript window around each (user prompt before / what happened
// inside / user's first turn after), and asks an LLM to rate the
// invocation on three dimensions: fit (was this the right skill?),
// value (did it actually advance the user's goal?), and corrections
// (count of pushbacks).
//
// Two judges:
//   - "haiku"  via `claude -p --model claude-haiku-4-5-20251001` — cheap,
//              used as primary judge on unjudged invocations.
//   - "codex"  via `codex exec --skip-git-repo-check --json -` — slower,
//              used as a tiebreaker on cases where the haiku judge's
//              `value` rating diverges from the skill's self-reported
//              confidence (when available) by >= MIN_DRIFT.

import fs from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";
import {
  SqlBatch,
  initDb,
  queryRows,
  sha256,
  sqlNumber,
  sqlString,
} from "./sqlite.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_TIMEOUT_MS = 120_000;
const CODEX_TIMEOUT_MS = 300_000;
const MAX_PROMPT_CHARS = 20_000;
const MAX_INSIDE_CHARS = 6_000;

const JUDGE_PROMPT_TEMPLATE = ({
  skill,
  args,
  kind,                 // "skill" or "subagent"
  promptBefore,
  insideSummary,
  promptAfter,
  toolCalls,
  toolErrors,
}) => {
  const noun = kind === "subagent" ? "subagent" : "skill";
  return `You are evaluating whether a Claude Code ${noun} invocation actually helped the user.

You will see:
 (1) the user's prompt right before the ${noun} ran
 (2) a compressed log of what happened inside the ${noun} window
 (3) the user's first turn after the ${noun} returned

Rate three dimensions, then return STRICT JSON only (no markdown, no prose around it):

{
  "fit": <0-10 integer>,        // was this the right ${noun} for what the user asked?
  "value": <0-10 integer>,      // did the ${noun}'s work materially advance the user's goal?
  "corrections": <integer>,     // count of corrections/pushbacks the user made in their next turn (0 if satisfied)
  "well": "<one short sentence: what the ${noun} did well>",
  "poorly": "<one short sentence: what the ${noun} did poorly, or 'nothing notable'>"
}

Calibration: 7-8 = "this worked." 9-10 = "excellent, clearly the right move." 4-6 = "mixed." 0-3 = "wrong ${noun} or actively unhelpful." If the user's next turn is a correction or restart, value cannot be >= 7.

--- INVOCATION ---
${noun}: ${skill}
args: ${args || "(none)"}

--- USER PROMPT BEFORE ---
${promptBefore || "(none)"}

--- INSIDE WINDOW (${toolCalls} tool calls, ${toolErrors} errors) ---
${insideSummary || "(empty)"}

--- USER FIRST TURN AFTER ---
${promptAfter || "(none — session ended or no follow-up)"}

Return JSON only.`;
};

function truncatePrompt(prompt) {
  if (prompt.length <= MAX_PROMPT_CHARS) return prompt;
  const keep = MAX_PROMPT_CHARS / 2 - 50;
  return (
    prompt.slice(0, keep) +
    "\n\n... [prompt truncated] ...\n\n" +
    prompt.slice(-keep)
  );
}

function runSubprocess(cmd, args, { input, timeoutMs }) {
  return new Promise((resolve) => {
    const child = spawn(cmd, args, { stdio: ["pipe", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    let settled = false;
    const timer = setTimeout(() => {
      if (settled) return;
      settled = true;
      child.kill("SIGKILL");
      resolve({ error: `timeout after ${timeoutMs}ms`, stdout, stderr });
    }, timeoutMs);
    child.stdout.on("data", (b) => {
      stdout += b.toString();
    });
    child.stderr.on("data", (b) => {
      stderr += b.toString();
    });
    child.on("error", (e) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ error: String(e), stdout, stderr });
    });
    child.on("close", (code) => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      resolve({ code, stdout, stderr });
    });
    if (input != null) child.stdin.end(input);
    else child.stdin.end();
  });
}

/**
 * Find the LAST brace-balanced JSON object in `text` that parses. Previous
 * impl used a greedy /\{[\s\S]*\}/ regex which captured from the first `{`
 * to the last `}` — that fails on outputs like "Some intro {note} Final: {verdict}"
 * because the union isn't valid JSON.
 *
 * We scan from the right: for each `}`, walk back to its matching `{`
 * (respecting strings and escapes) and try JSON.parse. First success wins.
 */
function extractJson(text) {
  if (!text) return null;
  for (let end = text.length - 1; end >= 0; end -= 1) {
    if (text[end] !== "}") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
    for (let start = end; start >= 0; start -= 1) {
      const ch = text[start];
      if (escape) {
        escape = false;
        continue;
      }
      if (ch === "\\") {
        escape = true;
        continue;
      }
      if (ch === '"' && !escape) inString = !inString;
      if (inString) continue;
      if (ch === "}") depth += 1;
      else if (ch === "{") {
        depth -= 1;
        if (depth === 0) {
          const candidate = text.slice(start, end + 1);
          try {
            return JSON.parse(candidate);
          } catch {
            // brace-balanced but not valid JSON — keep scanning further left
          }
          break;
        }
      }
    }
  }
  return null;
}

export async function callHaiku(prompt) {
  const truncated = truncatePrompt(prompt);
  const res = await runSubprocess(
    "claude",
    ["-p", "--model", HAIKU_MODEL, "--output-format", "json"],
    { input: truncated, timeoutMs: HAIKU_TIMEOUT_MS }
  );
  if (res.error) return { _error: res.error, stderr: res.stderr };
  if (res.code !== 0) return { _error: `rc=${res.code}`, stderr: res.stderr };
  // claude --output-format json wraps the assistant reply in an envelope
  // shaped like {"result": "...assistant text..."}. The `result` field may
  // be a string OR an already-parsed object containing fit/value/etc.
  let inner = res.stdout;
  try {
    const env = JSON.parse(res.stdout);
    if (env && typeof env === "object" && env.result != null) {
      if (typeof env.result === "string") {
        inner = env.result;
      } else if (typeof env.result === "object") {
        // The model returned structured output directly — skip the
        // extractJson scrape and use it as-is.
        return env.result;
      }
    }
  } catch {
    /* not JSON envelope; treat as plain */
  }
  return (
    extractJson(inner) || {
      _error: "no JSON in haiku response",
      raw: String(inner).slice(0, 500),
    }
  );
}

export async function callCodex(prompt) {
  const truncated = truncatePrompt(prompt);
  const res = await runSubprocess(
    "codex",
    ["exec", "--skip-git-repo-check", "--json", "-"],
    { input: truncated, timeoutMs: CODEX_TIMEOUT_MS }
  );
  if (res.error) return { _error: res.error, stderr: res.stderr };
  if (res.code !== 0) return { _error: `rc=${res.code}`, stderr: res.stderr };
  // codex exec --json emits NDJSON events. The final assistant text lives
  // in the last `item.completed` of type `agent_message`.
  let finalText = null;
  for (const line of res.stdout.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      const row = JSON.parse(trimmed);
      if (row?.type === "item.completed" && row.item?.type === "agent_message" && row.item.text) {
        finalText = row.item.text;
      }
    } catch {
      /* skip non-json line */
    }
  }
  if (!finalText) {
    // Fallback: try to scrape a {...} containing "fit" anywhere in stdout
    const fallback = res.stdout.match(/\{[^{}]*"fit"[^{}]*\}/);
    if (fallback) {
      try { return JSON.parse(fallback[0]); } catch { /* */ }
    }
    return { _error: "no agent_message in codex output", raw: res.stdout.slice(0, 500) };
  }
  return extractJson(finalText) || { _error: "no JSON in codex final message", raw: finalText.slice(0, 500) };
}

// ─── candidate selection ──────────────────────────────────────────────

/**
 * Return Skill invocations (event_type='skill_invocation', source='claude')
 * that have NOT yet been judged by `judge` (default "haiku").
 *
 * Anomaly priority: invocations with a "correction" event in the same
 * (skill_name, turn_id) win over the rest, so the cheap judge is spent
 * where it's most informative.
 *
 * @param {{ judge?: "haiku" | "codex", limit?: number, skill?: string | null }} [opts]
 */
export function unjudgedInvocations({ judge = "haiku", limit = 10, skill = null } = {}) {
  initDb();
  const skillClause = skill ? `AND se.skill_name = ${sqlString(skill)}` : "";
  // Judge both Skill-tool invocations and Agent-tool (subagent) invocations.
  // In practice most Claude Code work routes through subagents like
  // general-purpose / Explore — judging only `skill_invocation` left 99%
  // of the rich activity uncovered.
  return queryRows(`
    SELECT se.event_key, se.skill_name, se.event_type, se.turn_id, se.timestamp,
           se.notes, se.source_path, se.source_line, se.evidence_id,
           EXISTS (
             SELECT 1 FROM skill_events se2
             WHERE se2.skill_name = se.skill_name
               AND se2.turn_id = se.turn_id
               AND se2.event_type = 'correction'
               AND se2.source = 'claude'
           ) AS has_correction
      FROM skill_events se
     WHERE se.event_type IN ('skill_invocation', 'agent_invocation')
       AND se.source = 'claude'
       ${skillClause}
       AND NOT EXISTS (
         SELECT 1 FROM judgments j
          WHERE j.skill_event_key = se.event_key
            AND j.judge = ${sqlString(judge)}
            AND j.error IS NULL
       )
     ORDER BY has_correction DESC, se.timestamp DESC
     LIMIT ${sqlNumber(limit)}
  `);
}

/**
 * Codex second-opinion candidates: any Haiku-judged invocation that
 * codex hasn't weighed in on yet. We rank by "how much do we need a
 * second opinion?" so a small codex budget hits the most useful cases:
 *
 *   priority 0: user corrected on the next turn — strongest disagreement signal
 *   priority 1: Haiku rated value <= 3 — possible misuse or failure
 *   priority 2: Haiku rated value >= 9 — suspiciously high; possible self-praise
 *   priority 3: everything else (random sample)
 *
 * Inside a priority bucket, prefer the most recent invocations so codex
 * weighs in on current behavior, not stale history.
 *
 * @param {{ limit?: number, skill?: string | null }} [opts]
 */
export function codexTiebreakerCandidates({ limit = 5, skill = null } = {}) {
  initDb();
  const skillClause = skill ? `AND se.skill_name = ${sqlString(skill)}` : "";
  return queryRows(`
    SELECT se.event_key, se.skill_name, se.event_type, se.turn_id, se.timestamp,
           se.notes, se.source_path, se.source_line, se.evidence_id,
           hj.fit AS haiku_fit, hj.value AS haiku_value,
           CASE
             WHEN EXISTS (
               SELECT 1 FROM skill_events se2
                WHERE se2.skill_name = se.skill_name
                  AND se2.turn_id = se.turn_id
                  AND se2.event_type = 'correction'
                  AND se2.source = 'claude'
             ) THEN 0
             WHEN hj.value <= 3 THEN 1
             WHEN hj.value >= 9 THEN 2
             ELSE 3
           END AS priority
      FROM skill_events se
      JOIN judgments hj
        ON hj.skill_event_key = se.event_key
       AND hj.judge = 'haiku'
       AND hj.error IS NULL
     WHERE se.event_type IN ('skill_invocation', 'agent_invocation')
       AND se.source = 'claude'
       ${skillClause}
       AND NOT EXISTS (
         SELECT 1 FROM judgments j2
          WHERE j2.skill_event_key = se.event_key
            AND j2.judge = 'codex'
       )
     ORDER BY priority ASC, se.timestamp DESC
     LIMIT ${sqlNumber(limit)}
  `);
}

// ─── transcript window extraction ─────────────────────────────────────

function partText(part) {
  if (typeof part === "string") return part;
  if (part?.type === "text") return part.text || "";
  if (part?.type === "input_text") return part.text || "";
  return "";
}

// Per-process parsed-transcript cache. transcriptWindow() is called once
// per invocation judged; repeatedly reading + JSON-parsing 64K-line
// transcripts for sequential invocations in the same session was the
// dominant cost. Cache the parsed rows array, invalidating on mtime.
const _transcriptCache = new Map();

function readTranscriptRows(filePath) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  let st;
  try {
    st = fs.statSync(filePath);
  } catch {
    return [];
  }
  const cached = _transcriptCache.get(filePath);
  if (cached && cached.mtimeMs === st.mtimeMs && cached.size === st.size) {
    return cached.rows;
  }
  const raw = fs.readFileSync(filePath, "utf8");
  const rows = [];
  for (const line of raw.split(/\n/)) {
    if (!line) continue;
    try {
      rows.push(JSON.parse(line));
    } catch {
      rows.push(null);
    }
  }
  // Cap cache to avoid OOM if many large transcripts are touched.
  if (_transcriptCache.size > 32) _transcriptCache.clear();
  _transcriptCache.set(filePath, { mtimeMs: st.mtimeMs, size: st.size, rows });
  return rows;
}

/**
 * Locate prompt-before / inside-summary / prompt-after for one Skill
 * invocation, reading the source transcript file recorded on the
 * skill_event row.
 */
export function transcriptWindow(invocation) {
  const sourcePath = invocation.source_path;
  const sourceLine = invocation.source_line || 0;
  // Parsed rows include null placeholders for unparseable lines so
  // sourceLine indexing (1-based on input) maps to rows[sourceLine - 1].
  const rows = readTranscriptRows(sourcePath);
  if (!rows.length) return { promptBefore: "", inside: "", promptAfter: "" };

  let promptBefore = "";
  let promptAfter = "";
  const insideChunks = [];
  let toolUseId = null;

  // The skill_invocation event was inserted from a tool_use row; that
  // row's index is sourceLine - 1 (1-indexed in DB, 0-indexed in array).
  const skillRow = rows[Math.max(0, sourceLine - 1)];
  if (skillRow) {
    const msg = skillRow.message || {};
    const content = Array.isArray(msg.content) ? msg.content : [];
    for (const part of content) {
      if (part?.type === "tool_use" && part.name === "Skill") {
        toolUseId = part.id;
        break;
      }
    }
  }

  // Walk backward to find the latest user message before the skill row.
  for (let i = Math.max(0, sourceLine - 2); i >= 0; i -= 1) {
    const r = rows[i];
    if (!r || r.type !== "user") continue;
    const msg = r.message || {};
    const content = Array.isArray(msg.content) ? msg.content : [];
    const hasToolResult = content.some((p) => p?.type === "tool_result");
    if (hasToolResult) continue; // tool result echo, not a real prompt
    const text = content.map(partText).join("\n").trim();
    if (text && !text.startsWith("<system-reminder>")) {
      promptBefore = text.slice(0, 1500);
      break;
    }
  }

  // Walk forward from the skill row, collecting assistant turns and tool
  // results until we see the skill's tool_result; then capture the next
  // real user message as promptAfter.
  let sawSkillReturn = false;
  for (let i = sourceLine; i < rows.length; i += 1) {
    const r = rows[i];
    if (!r) continue;
    const msg = r.message || {};
    const content = Array.isArray(msg.content) ? msg.content : [];

    if (!sawSkillReturn) {
      // Capture activity inside the skill window
      if (r.type === "assistant") {
        for (const part of content) {
          if (part?.type === "text" && part.text) {
            insideChunks.push(`[assistant] ${part.text.slice(0, 400)}`);
          } else if (part?.type === "tool_use") {
            insideChunks.push(`[tool_use: ${part.name} ${JSON.stringify(part.input || {}).slice(0, 200)}]`);
          }
        }
      } else if (r.type === "user") {
        for (const part of content) {
          if (part?.type === "tool_result" && toolUseId && part.tool_use_id === toolUseId) {
            sawSkillReturn = true;
            // include the tool result text in inside summary
            const resText = Array.isArray(part.content)
              ? part.content.map(partText).join("\n")
              : (typeof part.content === "string" ? part.content : "");
            if (resText) insideChunks.push(`[skill returned] ${resText.slice(0, 300)}`);
          }
        }
      }
      continue;
    }

    // After skill returned: first real user message is promptAfter. But
    // if the assistant immediately fires ANOTHER Skill tool_use before
    // the user speaks again, promptAfter belongs to *that* skill — not
    // ours. Bail out so we don't mis-attribute it.
    if (r.type === "assistant") {
      const startsAnotherSkill = content.some(
        (p) => p?.type === "tool_use" && p.name === "Skill"
      );
      if (startsAnotherSkill) break;
    }
    if (r.type === "user") {
      const hasToolResult = content.some((p) => p?.type === "tool_result");
      if (hasToolResult) continue;
      const text = content.map(partText).join("\n").trim();
      if (text && !text.startsWith("<system-reminder>")) {
        promptAfter = text.slice(0, 1500);
        break;
      }
    }
  }

  let inside = insideChunks.join("\n");
  if (inside.length > MAX_INSIDE_CHARS) {
    inside =
      inside.slice(0, MAX_INSIDE_CHARS / 2) +
      "\n... [truncated] ...\n" +
      inside.slice(-MAX_INSIDE_CHARS / 2);
  }
  return { promptBefore, inside, promptAfter };
}

// ─── persist verdicts ─────────────────────────────────────────────────

export function recordJudgment({
  skillEventKey,
  skillName,
  turnId,
  judge,
  model,
  verdict,
  durationMs,
  promptChars,
}) {
  initDb();
  const judgmentKey = sha256(`${skillEventKey}:${judge}`);
  const isErr = !!(verdict && verdict._error);
  const fit = !isErr && Number.isInteger(verdict?.fit) ? verdict.fit : null;
  const value = !isErr && Number.isInteger(verdict?.value) ? verdict.value : null;
  const corrections = !isErr && Number.isInteger(verdict?.corrections) ? verdict.corrections : null;
  const well = !isErr && typeof verdict?.well === "string" ? verdict.well : null;
  const poorly = !isErr && typeof verdict?.poorly === "string" ? verdict.poorly : null;
  const rawResp = JSON.stringify(verdict || {});
  const error = isErr ? String(verdict._error) : null;
  const batch = new SqlBatch();
  batch.add(`INSERT OR REPLACE INTO judgments
    (judgment_key, skill_event_key, skill_name, turn_id, judge, model,
     fit, value, corrections, well, poorly, raw_response, error,
     prompt_chars, judged_at, duration_ms, source)
    VALUES (${sqlString(judgmentKey)}, ${sqlString(skillEventKey)},
    ${sqlString(skillName)}, ${sqlString(turnId)}, ${sqlString(judge)},
    ${sqlString(model)}, ${sqlNumber(fit)}, ${sqlNumber(value)},
    ${sqlNumber(corrections)}, ${sqlString(well)}, ${sqlString(poorly)},
    ${sqlString(rawResp)}, ${sqlString(error)}, ${sqlNumber(promptChars)},
    ${sqlString(new Date().toISOString())}, ${sqlNumber(durationMs)},
    ${sqlString("claude")})`);
  batch.flush();
  return { judgmentKey, error };
}

// ─── judge orchestration ──────────────────────────────────────────────

export async function judgeInvocation(invocation, { judge = "haiku" } = {}) {
  const win = transcriptWindow(invocation);
  // Pull tool stats for this turn so the prompt mentions them
  const stats = queryRows(`
    SELECT
      SUM(CASE WHEN status='completed' THEN 1 ELSE 0 END) AS calls,
      SUM(CASE WHEN status='failed' THEN 1 ELSE 0 END) AS errors
      FROM tool_events
     WHERE turn_id = ${sqlString(invocation.turn_id)}
       AND source = 'claude'
  `)[0] || { calls: 0, errors: 0 };

  const prompt = JUDGE_PROMPT_TEMPLATE({
    skill: invocation.skill_name,
    args: invocation.notes,
    kind: invocation.event_type === "agent_invocation" ? "subagent" : "skill",
    promptBefore: win.promptBefore,
    insideSummary: win.inside,
    promptAfter: win.promptAfter,
    toolCalls: stats.calls || 0,
    toolErrors: stats.errors || 0,
  });

  const started = Date.now();
  const verdict =
    judge === "codex" ? await callCodex(prompt) : await callHaiku(prompt);
  const durationMs = Date.now() - started;
  const model = judge === "codex" ? "codex" : HAIKU_MODEL;

  return recordJudgment({
    skillEventKey: invocation.event_key,
    skillName: invocation.skill_name,
    turnId: invocation.turn_id,
    judge,
    model,
    verdict,
    durationMs,
    promptChars: prompt.length,
  });
}
