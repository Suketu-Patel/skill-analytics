// AI-generated fun facts for the cost overview. Calls Haiku via the
// `claude -p` CLI (no API key needed; uses the user's existing auth).
//
// Aggressively cached by SHA-256 of the headline numbers: same numbers
// always produce the same prompt, so the same cached summary is returned
// without spending another cent. Force-regenerate via `force=true` to
// pay for a fresh take.

import { spawn } from "node:child_process";
import {
  SqlBatch,
  execSql,
  initDb,
  queryRows,
  sha256,
  sqlString,
} from "./sqlite.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
const HAIKU_TIMEOUT_MS = 60_000;
const KIND = "cost_fun_facts";

// ─── prompt ──────────────────────────────────────────────────────────────

function buildPrompt(h) {
  // Round figures so the prompt hash doesn't change for trivial cent-level
  // jitter. Keeps cache hits warm across import runs.
  const spend = Math.round(h.spend_total);
  const saved = Math.round(h.cache_savings);
  const sessions = Number(h.sessions_total);
  const tokensTotal = Math.round((h.tokens_total || 0) / 1_000_000); // M
  const tokensCached = Math.round((h.tokens_cached || 0) / 1_000_000);
  const tokensOutput = Math.round((h.tokens_output || 0) / 1_000_000);
  const tokensReasoning = Math.round((h.tokens_reasoning || 0) / 1_000_000);
  const avgSession = Number(h.avg_session_cost || 0).toFixed(2);
  const cacheHit = (Number(h.cache_hit_rate || 0) * 100).toFixed(1);
  const claudeSpend = Math.round(h.source_split?.claude || 0);
  const codexSpend = Math.round(h.source_split?.codex || 0);
  const burnDay = h.most_expensive_day;

  return `Generate exactly 5 fun, snarky 1-2 line "did you know?" facts about my AI coding tool usage. Use vivid American comparisons that make the scale tangible — Empire State Buildings stacked, football fields, Costco rotisserie chickens, NYC subway swipes, Yankee Stadium seats, Olympic swimming pools of coffee, Tesla Model 3s, lifetime supplies of Pop-Tarts, etc. Be slightly sarcastic but never mean. Keep each fact under 25 words. NO emoji. NO markdown. NO numbered list — just one fact per line.

My usage:
  - total spend: $${spend.toLocaleString()}
  - avg cost per session: $${avgSession}
  - sessions: ${sessions.toLocaleString()}
  - tokens consumed (millions): ${tokensTotal.toLocaleString()}M total — ${tokensCached.toLocaleString()}M cached, ${tokensOutput.toLocaleString()}M output${tokensReasoning ? `, ${tokensReasoning.toLocaleString()}M reasoning` : ""}
  - prompt cache hit rate: ${cacheHit}%
  - saved by caching: $${saved.toLocaleString()}
  - Claude spend: $${claudeSpend.toLocaleString()}  |  Codex spend: $${codexSpend.toLocaleString()}
  ${burnDay ? `- worst burn day: ${burnDay.day} at $${Math.round(burnDay.cost).toLocaleString()}` : ""}

Return STRICT JSON only:
{"facts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5"]}`;
}

// ─── subprocess helper (mirrors the one in judge.js) ────────────────────

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
          try {
            return JSON.parse(text.slice(start, end + 1));
          } catch {
            break;
          }
        }
      }
    }
  }
  return null;
}

// ─── cache ───────────────────────────────────────────────────────────────

function readCached(hash) {
  initDb();
  const rows = queryRows(
    `SELECT payload, generated_at, model FROM summaries WHERE content_hash = ${sqlString(hash)} LIMIT 1`
  );
  if (!rows.length) return null;
  try {
    const payload = JSON.parse(rows[0].payload);
    return {
      ...payload,
      generated_at: rows[0].generated_at,
      model: rows[0].model,
      cached: true,
    };
  } catch {
    return null;
  }
}

function writeCached(hash, model, payload) {
  initDb();
  const batch = new SqlBatch();
  batch.add(
    `INSERT OR REPLACE INTO summaries (content_hash, kind, model, generated_at, payload)
     VALUES (${sqlString(hash)}, ${sqlString(KIND)}, ${sqlString(model)},
             ${sqlString(new Date().toISOString())}, ${sqlString(JSON.stringify(payload))})`
  );
  batch.flush();
}

// ─── main entry ──────────────────────────────────────────────────────────

/**
 * Get fun-fact summaries for the given headline. Returns immediately from
 * cache if the same numbers were summarized before; otherwise calls Haiku.
 *
 * Returns:
 *   { facts: string[], generated_at, model, cached: boolean }
 *   { error: "...", facts: [] } on failure
 */
export async function getCostFunFacts(headline, { force = false } = {}) {
  const prompt = buildPrompt(headline);
  const hash = sha256(`${KIND}:${prompt}`);

  if (!force) {
    const cached = readCached(hash);
    if (cached && Array.isArray(cached.facts) && cached.facts.length) {
      return cached;
    }
  }

  const res = await runSubprocess(
    "claude",
    ["-p", "--model", HAIKU_MODEL, "--output-format", "json"],
    { input: prompt, timeoutMs: HAIKU_TIMEOUT_MS }
  );
  if (res.error) return { error: res.error, facts: [] };
  if (res.code !== 0) {
    return { error: `claude rc=${res.code}: ${String(res.stderr).slice(0, 200)}`, facts: [] };
  }

  // claude --output-format json wraps the assistant reply in an envelope
  let inner = res.stdout;
  try {
    const env = JSON.parse(res.stdout);
    if (env && typeof env === "object" && env.result != null) {
      inner = typeof env.result === "string" ? env.result : JSON.stringify(env.result);
    }
  } catch {
    /* not JSON envelope; treat as plain */
  }
  const parsed = extractJson(inner);
  if (!parsed || !Array.isArray(parsed.facts)) {
    return {
      error: "model returned no usable facts array",
      raw: String(inner).slice(0, 500),
      facts: [],
    };
  }

  const facts = parsed.facts
    .filter((f) => typeof f === "string" && f.trim())
    .slice(0, 6);

  const payload = { facts };
  writeCached(hash, HAIKU_MODEL, payload);
  return {
    ...payload,
    generated_at: new Date().toISOString(),
    model: HAIKU_MODEL,
    cached: false,
  };
}
