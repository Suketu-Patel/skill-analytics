// Smart session naming from the first ~3 user prompts of a transcript.
// Calls Haiku via `claude -p` to summarize into a short title, caches in
// the `summaries` table keyed by `session-name:${turn_id}` so the same
// session is only named once. The result is what we show in place of a
// UUID in the Top Sessions table and Wrapped.

import fs from "node:fs";
import { spawn } from "node:child_process";
import { SqlBatch, initDb, queryRows, sha256, sqlString } from "./sqlite.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_TIMEOUT_MS = 30_000;
const KIND = "session_name";
const MAX_PROMPTS = 3;
const MAX_PROMPT_CHARS = 600;

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
    child.stdout.on("data", (b) => (stdout += b.toString()));
    child.stderr.on("data", (b) => (stderr += b.toString()));
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

// ─── extract first N user prompts from a transcript ─────────────────────

function extractUserPrompts(filePath, source) {
  if (!filePath || !fs.existsSync(filePath)) return [];
  const lines = fs.readFileSync(filePath, "utf8").split(/\n/).filter(Boolean);
  const prompts = [];
  for (const raw of lines) {
    if (prompts.length >= MAX_PROMPTS) break;
    let row;
    try {
      row = JSON.parse(raw);
    } catch {
      continue;
    }
    // Claude transcripts: top-level type==='user' with message.content.
    // Codex transcripts: type==='response_item' with payload.role==='user'.
    let text = "";
    if (source === "claude" && row.type === "user") {
      const content = row?.message?.content;
      if (Array.isArray(content)) {
        const hasToolResult = content.some((p) => p?.type === "tool_result");
        if (hasToolResult) continue;
        text = content.map((c) => (c?.type === "text" ? c.text || "" : "")).join("\n").trim();
      } else if (typeof content === "string") {
        text = content;
      }
      if (text.startsWith("<system-reminder>") || text.startsWith("Base directory for this skill")) {
        continue;
      }
    } else if (source === "codex" && row.type === "response_item") {
      const p = row.payload || {};
      if (p.type === "message" && p.role === "user") {
        const content = p.content;
        if (Array.isArray(content)) {
          text = content
            .map((c) => (c?.type === "input_text" || c?.type === "text" ? c.text || "" : ""))
            .join("\n")
            .trim();
        }
        if (text.startsWith("<environment_context>") || text.startsWith("<permissions") || text.startsWith("<reminders")) {
          continue;
        }
      }
    }
    text = text.trim();
    if (text) prompts.push(text.slice(0, MAX_PROMPT_CHARS));
  }
  return prompts;
}

// ─── Haiku call ──────────────────────────────────────────────────────────

function extractJson(text) {
  if (!text) return null;
  for (let end = text.length - 1; end >= 0; end -= 1) {
    if (text[end] !== "}") continue;
    let depth = 0, inString = false, escape = false;
    for (let start = end; start >= 0; start -= 1) {
      const ch = text[start];
      if (escape) { escape = false; continue; }
      if (ch === "\\") { escape = true; continue; }
      if (ch === '"' && !escape) inString = !inString;
      if (inString) continue;
      if (ch === "}") depth += 1;
      else if (ch === "{") {
        depth -= 1;
        if (depth === 0) {
          try { return JSON.parse(text.slice(start, end + 1)); } catch { break; }
        }
      }
    }
  }
  return null;
}

async function summarizeSession(prompts) {
  if (!prompts.length) return null;
  const body = prompts.map((p, i) => `[turn ${i + 1}]\n${p}`).join("\n\n");
  const prompt = `Summarize this AI coding session into a short title (3-7 words). Be specific about the actual work, not generic ("Debug X" is good, "Coding session" is bad). Lowercase except acronyms. No quotes, no punctuation at the end.

Return STRICT JSON only:
{"name": "..."}

--- Session prompts ---
${body}`;

  const res = await runSubprocess(
    "claude",
    ["-p", "--model", HAIKU_MODEL, "--output-format", "json"],
    { input: prompt, timeoutMs: HAIKU_TIMEOUT_MS }
  );
  if (res.error || res.code !== 0) return null;
  let inner = res.stdout;
  try {
    const env = JSON.parse(res.stdout);
    if (env?.result) inner = typeof env.result === "string" ? env.result : JSON.stringify(env.result);
  } catch { /* */ }
  const parsed = extractJson(inner);
  return parsed?.name?.trim() || null;
}

// ─── cache layer ─────────────────────────────────────────────────────────

function cacheKey(turnId) {
  return sha256(`${KIND}:${turnId}`);
}

function readCached(turnId) {
  initDb();
  const rows = queryRows(
    `SELECT payload FROM summaries WHERE content_hash = ${sqlString(cacheKey(turnId))} LIMIT 1`
  );
  if (!rows.length) return null;
  try {
    return JSON.parse(rows[0].payload)?.name || null;
  } catch {
    return null;
  }
}

function writeCached(turnId, name) {
  initDb();
  const batch = new SqlBatch();
  batch.add(
    `INSERT OR REPLACE INTO summaries (content_hash, kind, model, generated_at, payload)
     VALUES (${sqlString(cacheKey(turnId))}, ${sqlString(KIND)}, ${sqlString(HAIKU_MODEL)},
             ${sqlString(new Date().toISOString())}, ${sqlString(JSON.stringify({ name }))})`
  );
  batch.flush();
}

// ─── public API ──────────────────────────────────────────────────────────

/**
 * Resolve names for a batch of turn_ids. Returns { [turn_id]: name }.
 * Cached hits return immediately; misses call Haiku in parallel
 * (capped to limit concurrent subprocesses).
 *
 * For a miss we look up the source transcript path via the turns table,
 * extract first 3 user prompts, then summarize.
 */
export async function namesFor(turnIds, { concurrency = 3 } = {}) {
  initDb();
  if (!turnIds?.length) return {};
  const out = {};
  const misses = [];
  for (const id of turnIds) {
    const cached = readCached(id);
    if (cached) out[id] = cached;
    else misses.push(id);
  }
  if (!misses.length) return out;

  // Look up turn metadata for each miss in one shot.
  const placeholders = misses.map((id) => sqlString(id)).join(",");
  const turnRows = queryRows(
    `SELECT turn_id, source, source_path FROM turns WHERE turn_id IN (${placeholders})`
  );
  const byTurn = new Map(turnRows.map((r) => [r.turn_id, r]));

  // Simple semaphore for concurrency control — don't spawn 100 claude
  // processes at once.
  let inFlight = 0;
  const queue = [...misses];
  return await new Promise((resolve) => {
    function pump() {
      while (inFlight < concurrency && queue.length) {
        const id = queue.shift();
        const meta = byTurn.get(id);
        if (!meta?.source_path) {
          out[id] = null;
          continue;
        }
        inFlight += 1;
        const prompts = extractUserPrompts(meta.source_path, meta.source);
        summarizeSession(prompts)
          .then((name) => {
            if (name) {
              writeCached(id, name);
              out[id] = name;
            } else {
              out[id] = null;
            }
          })
          .catch(() => { out[id] = null; })
          .finally(() => {
            inFlight -= 1;
            if (queue.length === 0 && inFlight === 0) resolve(out);
            else pump();
          });
      }
      if (queue.length === 0 && inFlight === 0) resolve(out);
    }
    pump();
  });
}
