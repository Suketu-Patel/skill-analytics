// Background pricing validator.
//
// On app start (rate-limited to ~24h) we ask Haiku via `claude -p
// --allowed-tools WebSearch` to look up current Anthropic / OpenAI /
// Cursor model prices and emit a JSON table. Result lands in
// `data/pricing-overrides.json` as a side-table that the runtime
// pricing layer reads BEFORE falling back to the hardcoded `PRICING`
// table in src/lib/pricing.js.
//
// Why a side-table instead of patching pricing.js: source files are
// versioned and read-only at runtime — mutating them at the agent's
// request is hostile. The overrides file lives in `data/` alongside
// the SQLite DB, gitignored by default.

import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";
import { PRICING } from "./pricing.js";

const HAIKU_MODEL = "claude-haiku-4-5-20251001";
// Web search occasionally takes a while; cap the whole call at 3 min.
const HAIKU_TIMEOUT_MS = 180_000;
// Skip auto-validation if the last successful run was less than this
// long ago. Manual refresh from Settings always runs regardless.
export const REVALIDATE_AFTER_MS = 24 * 60 * 60 * 1000;

function overridesPath() {
  return path.join(dataDir(), "pricing-overrides.json");
}

/** Reads the side-table. Returns null if it's missing or malformed. */
export function readPricingOverrides() {
  try {
    const raw = fs.readFileSync(overridesPath(), "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    return parsed;
  } catch {
    return null;
  }
}

function writePricingOverrides(payload) {
  fs.mkdirSync(path.dirname(overridesPath()), { recursive: true });
  fs.writeFileSync(overridesPath(), JSON.stringify(payload, null, 2));
}

// Prompt: list the exact model IDs we already know about and ask the
// model to fill in current prices. Keeping the IDs explicit means the
// shape of the response is stable and we don't accept hallucinated
// model names.
function buildPrompt() {
  const claudeIds = Object.keys(PRICING.claude);
  const codexIds = Object.keys(PRICING.codex);
  return `Look up the CURRENT public pricing for the following AI coding models, as of today.
Use WebSearch — check the official Anthropic pricing page (claude.com/pricing) and the official OpenAI API pricing page (platform.openai.com/docs/pricing).

For each model, report the input price, output price, and prompt-cache prices in USD per 1 MILLION tokens.

Models to look up:
- Anthropic Claude: ${claudeIds.join(", ")}
- OpenAI (used by Codex CLI): ${codexIds.join(", ")}

For Anthropic models, "cache_read" is the cached-input price, "cache_write" is the cache-write surcharge (typically 25% above input).
For OpenAI models, "cache_read" is the cached-input price; set "cache_write" equal to "input" if OpenAI doesn't publish a separate write price.

Return STRICT JSON only, no markdown, in EXACTLY this shape (numbers in USD per million tokens):
{
  "as_of": "YYYY-MM-DD",
  "sources_consulted": ["url1", "url2"],
  "claude": {
    "claude-opus-4-7": { "input": 0, "output": 0, "cache_read": 0, "cache_write": 0 },
    ...
  },
  "codex": {
    "gpt-5": { "input": 0, "output": 0, "cache_read": 0, "cache_write": 0 },
    ...
  }
}

If you cannot confirm a model's current price from an official source, OMIT it from the response — better to fall back to the hardcoded default than ship a guess.`;
}

// Subprocess wrapper mirrors the one used by summaries.js / judge.js.
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

// Same JSON-scrape used in summaries.js — finds the last balanced
// {...} block in the output (handles the `claude --output-format json`
// envelope as well as raw model output).
function extractJson(text) {
  if (!text) return null;
  for (let end = text.length - 1; end >= 0; end -= 1) {
    if (text[end] !== "}") continue;
    let depth = 0;
    let inString = false;
    let escape = false;
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
          try { return JSON.parse(text.slice(start, end + 1)); }
          catch { break; }
        }
      }
    }
  }
  return null;
}

// In-flight guard. Process-local; that's fine — we only ever have one
// dev server / API worker running against this DB at a time.
let inFlight = false;

/**
 * Run the validator. Skips when a recent successful run exists unless
 * `force: true`. Returns:
 *   { ok: true, updated: bool, payload, last_validated_at }
 *   { ok: false, error: "..." }
 */
export async function validatePricing({ force = false } = {}) {
  if (inFlight) {
    return { ok: false, error: "validation already in flight" };
  }
  if (!force) {
    const existing = readPricingOverrides();
    if (existing?.last_validated_at) {
      const age = Date.now() - new Date(existing.last_validated_at).getTime();
      if (Number.isFinite(age) && age < REVALIDATE_AFTER_MS) {
        return { ok: true, updated: false, cached: true, payload: existing };
      }
    }
  }

  inFlight = true;
  try {
    const prompt = buildPrompt();
    const res = await runSubprocess(
      "claude",
      [
        "-p",
        "--model",
        HAIKU_MODEL,
        "--allowed-tools",
        "WebSearch",
        "--output-format",
        "json",
      ],
      { input: prompt, timeoutMs: HAIKU_TIMEOUT_MS }
    );
    if (res.error) return { ok: false, error: res.error };
    if (res.code !== 0) {
      return { ok: false, error: `claude rc=${res.code}: ${String(res.stderr).slice(0, 200)}` };
    }

    // claude --output-format json wraps the assistant reply in an envelope
    let inner = res.stdout;
    try {
      const env = JSON.parse(res.stdout);
      if (env && typeof env === "object" && env.result != null) {
        inner = typeof env.result === "string" ? env.result : JSON.stringify(env.result);
      }
    } catch { /* not JSON envelope; treat as plain */ }

    const parsed = extractJson(inner);
    if (!parsed || typeof parsed !== "object") {
      return { ok: false, error: "model returned no usable JSON" };
    }

    // Sanity-check the shape before persisting. Reject if both source
    // tables are missing or empty — better to keep the previous
    // overrides than overwrite them with garbage.
    const hasClaude = parsed.claude && Object.keys(parsed.claude).length > 0;
    const hasCodex = parsed.codex && Object.keys(parsed.codex).length > 0;
    if (!hasClaude && !hasCodex) {
      return { ok: false, error: "no claude or codex pricing in response" };
    }

    // Detect whether prices actually changed vs the existing overrides
    // (or, if there are none yet, vs the hardcoded PRICING table). This
    // drives the small "prices updated" toast the client surfaces.
    const previous = readPricingOverrides() || { claude: PRICING.claude, codex: PRICING.codex };
    const updated = JSON.stringify(previous.claude || {}) !== JSON.stringify(parsed.claude || {}) ||
                    JSON.stringify(previous.codex || {})  !== JSON.stringify(parsed.codex || {});

    const payload = {
      last_validated_at: new Date().toISOString(),
      as_of: parsed.as_of || null,
      sources_consulted: Array.isArray(parsed.sources_consulted) ? parsed.sources_consulted : [],
      claude: parsed.claude || {},
      codex: parsed.codex || {},
    };
    writePricingOverrides(payload);

    return { ok: true, updated, cached: false, payload };
  } finally {
    inFlight = false;
  }
}
