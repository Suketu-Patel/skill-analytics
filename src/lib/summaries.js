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

// Region-flavored metaphor banks. The model gets concrete, locally
// resonant references rather than always defaulting to Costco chickens
// and NYC subway swipes. Currency stays USD (that's what the APIs bill
// in), but each region's prompt also includes the approximate local-
// currency conversion so "$50" lands as "₹4,200" for an Indian user.
const REGION_FLAVOR = {
  US: {
    name: "United States",
    currencyHint: "Keep all dollar figures in USD with no conversion.",
    metaphors:
      "Costco rotisserie chickens ($4.99 each), NYC subway swipes ($2.90), Empire State Buildings stacked, Yankee Stadium beers ($14), Olympic pools of coffee, Tesla Model 3s ($42k), Pop-Tart toaster cycles, Big Mac stacks ($5.69), Manhattan rent-months ($4.5k), Trader Joe's runs",
  },
  IN: {
    name: "India",
    currencyHint:
      "Show dollar figures AND their approximate INR equivalent in parentheses using ~83 INR per USD, e.g. \"$500 (~₹41,500)\". Round INR to the nearest hundred or thousand.",
    metaphors:
      "auto-rickshaw rides in Mumbai (~₹50), masala chai at a tapri (~₹15), Bengaluru metro fares (~₹25), Goa beach shacks, biryani plates from Paradise (~₹450), monthly Mumbai 1BHK rent (~₹35,000), Royal Enfield Classic 350 (~₹2.1L), Ola/Uber cab rides across Delhi, Big Basket grocery runs, IPL match tickets, weekend Goa flights from Bangalore",
  },
  UK: {
    name: "United Kingdom",
    currencyHint:
      "Show dollar figures AND their approximate GBP equivalent in parentheses using ~0.79 GBP per USD, e.g. \"$500 (~£395)\".",
    metaphors:
      "pints at a London pub (~£6), Tube rides (~£2.80), Greggs sausage rolls (£1.30), monthly Oyster cards, fish-and-chips dinners, Eurostar trips to Paris, a year of council tax, Premier League season tickets",
  },
  EU: {
    name: "Europe",
    currencyHint:
      "Show dollar figures AND their approximate EUR equivalent in parentheses using ~0.92 EUR per USD, e.g. \"$500 (~€460)\".",
    metaphors:
      "espressos at a Roman bar (~€1.20), Berlin U-Bahn rides (~€3), Paris baguettes (~€1.20), high-speed TGV tickets, Oktoberfest steins, monthly Amsterdam rent, a Ryanair weekend, IKEA meatball plates",
  },
  JP: {
    name: "Japan",
    currencyHint:
      "Show dollar figures AND their approximate JPY equivalent in parentheses using ~150 JPY per USD, e.g. \"$500 (~¥75,000)\".",
    metaphors:
      "Tokyo subway rides (~¥180), 7-Eleven onigiri (~¥150), Shinkansen Tokyo→Osaka (~¥14,000), ramen bowls in Shibuya, a Daiso shopping spree, gachapon spins, a single Pokémon card",
  },
  AU: {
    name: "Australia",
    currencyHint:
      "Show dollar figures AND their approximate AUD equivalent in parentheses using ~1.52 AUD per USD, e.g. \"$500 (~A$760)\".",
    metaphors:
      "flat whites at Melbourne cafés (~A$5), Opal card swipes (~A$4), meat pies, Bunnings sausages (A$3.50), Vegemite jars, a weekend in Byron Bay",
  },
  GLOBAL: {
    name: "Global",
    currencyHint: "Keep all figures in USD; avoid country-specific currency conversions.",
    metaphors:
      "Spotify Premium months ($11), Netflix subscriptions ($15), iPhone Pro Maxes ($1199), economy flights, a year of streaming, a barista's salary, AAA video games ($70), gym memberships",
  },
};

export function buildPrompt(h, region = "US") {
  const flavor = REGION_FLAVOR[region] || REGION_FLAVOR.US;
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

  return `Generate exactly 7 fun, snarky 1-2 line "did you know?" facts about my AI coding tool usage for a user based in ${flavor.name}. Use vivid, specific ${flavor.name}-resonant comparisons that make scale tangible — pick from things like: ${flavor.metaphors}. ${flavor.currencyHint} Vary the metaphor — never reuse one across the seven facts. Be slightly sarcastic but never mean. Each fact under 25 words. NO emoji. NO markdown. NO numbered list — just one fact per line.

REQUIRED coverage — produce exactly one fact for each of these angles, in this order:
  1. CACHE — what prompt-cache savings bought you
  2. BURN — the worst-spend day or a spike
  3. MODEL — Claude vs Codex split or model preference
  4. SESSION — average-cost-per-session reality check
  5. SCALE — total spend converted into something physical
  6. TOKENS — context-window scale (compare millions of tokens to something concrete: novels, encyclopedias, the Library of Congress, etc.)
  7. WILDCARD — a surprising ratio, oddity, or "you could have bought X instead" punchline drawn from any combination of the numbers

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
{"facts": ["fact 1", "fact 2", "fact 3", "fact 4", "fact 5", "fact 6", "fact 7"]}`;
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
export async function getCostFunFacts(headline, { force = false, region = "US" } = {}) {
  // Region rides into the prompt and therefore into the hash — different
  // regions get different cached responses so an Indian user never sees
  // the cached "Costco chicken" line generated for an American user.
  const prompt = buildPrompt(headline, region);
  const hash = sha256(`${KIND}:${region}:${prompt}`);

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
    .slice(0, 8);

  const payload = { facts };
  writeCached(hash, HAIKU_MODEL, payload);
  return {
    ...payload,
    generated_at: new Date().toISOString(),
    model: HAIKU_MODEL,
    cached: false,
  };
}
