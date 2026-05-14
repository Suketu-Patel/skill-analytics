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
// 180s. Haiku does extended reasoning on the honesty rules + math
// (measured 70-90s when grounding the comparisons). The route runs
// async, the cost-overview view shows a "Thinking…" pill while it
// works, and the result is cached for 24h, so a longer timeout is
// cheap insurance against false errors.
const HAIKU_TIMEOUT_MS = 180_000;
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
      "Show dollar figures AND their approximate INR equivalent in parentheses using ~83 INR per USD, e.g. \"$500 (~₹41,500)\". Round INR to the nearest hundred, thousand, or lakh (use \"L\" for lakhs, \"Cr\" for crores).",
    // Anchored to typical urban-India spending, not luxury. Each entry has
    // a real price so the model can do the math without making up "a year
    // of Mumbai 1BHK rent" when the number is 10x too high.
    metaphors:
      "masala chai at a tapri (~₹15), auto rides (~₹50), Bengaluru/Delhi metro fares (~₹30), Mumbai local-train monthly pass (~₹240), Zomato dinner orders (~₹350), biryani plates (~₹450), monthly Mumbai 1BHK rent (~₹35,000), Big Basket weekly grocery (~₹2,000), iPhone 16 (~₹80,000), Royal Enfield Classic 350 (~₹2.1L), Maruti Swift on-road (~₹8L), an IPL match ticket (~₹2,500), a weekend Goa flight from Bangalore (~₹6,000), a year of Netflix (~₹6,500), a year of Amazon Prime (~₹1,500), a Bangalore software engineer's monthly salary (~₹1.2L). Don't claim something equals X months of rent or X salaries without doing the math; if you make a comparison, the rupee figure must actually divide evenly into the anchor.",
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

  return `Generate exactly 5 short "did you know?" facts about a developer's AI coding tool usage. The reader is in ${flavor.name}. Each fact must be one tight sentence, max 22 words. Dry, observational, occasionally funny. Never preachy, never hype.

VOICE
  Sound like a senior engineer who notices things, not a copywriter. "$971 in one day. That's 200 Costco chickens or one airline ticket you didn't take." Drop the bow. No "you might be surprised", no "fun fact!", no "wow", no "honestly".

CURRENCY
  ${flavor.currencyHint}

ANCHORS (use these prices; never invent new ones)
  ${flavor.metaphors}

TOKEN-SCALE ANCHORS (use these for any tokens-related fact)
  - 1 chat message: ~200 tokens
  - 1 typical novel: ~120,000 tokens
  - The Lord of the Rings full trilogy: ~700,000 tokens
  - Wikipedia (English text only): ~6 billion tokens
  - All books published in a year worldwide (~2M books): ~250 billion tokens
  Do NOT say "all human knowledge", "every book ever written", "all of human writing", or anything that implies infinity or totality. Stay bounded.

HARD RULES (a violation gets the response rejected and re-rolled)
  - Show the arithmetic implicitly: every "X = N anchors" claim must be within 15% when you divide. Compute before you write.
  - Round to integers. No "1.4 iPhones", no "0.6 years". "8 phones", "5 months", "twice".
  - One anchor per fact. Don't pile up "X iPhones or Y rotisserie chickens or Z subway swipes".
  - No hyperbole / universals: never "infinite", "endless", "all of", "every", "the entire", "humanity", "civilization".
  - No emoji. No markdown. No numbered list. One fact per line.
  - No em dashes ("—"). Use commas, colons, parentheses, periods.
  - Don't recycle anchors across the five facts.

COVERAGE (one fact per angle, this order)
  1. CACHE: what the prompt-cache savings bought you in concrete terms
  2. BURN: the worst-spend day or a sharp spike, with one anchor
  3. MODEL: Claude vs Codex tilt, framed as a preference, not a number dump
  4. SCALE: total spend translated into ONE physical purchase from the anchor list
  5. TOKENS: total billable tokens vs the token-scale anchors above, bounded

USAGE NUMBERS
  - total spend: $${spend.toLocaleString()}
  - avg cost per session: $${avgSession}
  - sessions: ${sessions.toLocaleString()}
  - tokens (millions): ${tokensTotal.toLocaleString()}M total, ${tokensCached.toLocaleString()}M cached, ${tokensOutput.toLocaleString()}M output${tokensReasoning ? `, ${tokensReasoning.toLocaleString()}M reasoning` : ""}
  - cache hit rate: ${cacheHit}%
  - cache savings: $${saved.toLocaleString()}
  - Claude spend: $${claudeSpend.toLocaleString()} | Codex spend: $${codexSpend.toLocaleString()}
  ${burnDay ? `- worst day: ${burnDay.day} at $${Math.round(burnDay.cost).toLocaleString()}` : ""}

Return STRICT JSON only, no prose:
{"facts": ["...", "...", "...", "...", "..."]}`;
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
 * Coarse "fast" cache key — built from (region, filter query-string).
 * Lets the route serve cached facts WITHOUT computing the cost-overview
 * headline first. The cache is invalidated on every sync by the
 * importer (kind = cost_fun_facts), so freshness is bounded by sync
 * cadence, not by headline-number changes.
 *
 * The original headline-content hash is kept as a secondary write so
 * an identical-headline-different-filter call still hits cache after
 * an invalidation that happens to not have re-warmed the coarse key.
 */
export function fastFunFactsKey({ region, filterQS = "" }) {
  return sha256(`${KIND}:fast:${region || "US"}:${filterQS}`);
}

/** Public fast-path read used by /api/metrics/fun-facts. Returns null
 *  when no cached row exists; never calls Haiku. */
export function readFastFunFacts({ region, filterQS = "" }) {
  return readCached(fastFunFactsKey({ region, filterQS }));
}

/**
 * Get fun-fact summaries for the given headline. Returns immediately from
 * cache if the same numbers were summarized before; otherwise calls Haiku.
 *
 * Returns:
 *   { facts: string[], generated_at, model, cached: boolean }
 *   { error: "...", facts: [] } on failure
 */
export async function getCostFunFacts(headline, { force = false, region = "US", filterQS = "" } = {}) {
  // Two cache rows are written per Haiku call:
  //   1. A coarse "fast" row keyed by (region, filterQS) — the one the
  //      route looks up first, no headline needed.
  //   2. The original headline-content hash row, kept for back-compat
  //      and as a per-headline dedupe.
  // Region rides into the prompt — different regions get different
  // cached responses so an Indian user never sees Costco-chicken lines.
  const prompt = buildPrompt(headline, region);
  const hash = sha256(`${KIND}:${region}:${prompt}`);
  const fastHash = fastFunFactsKey({ region, filterQS });

  // Defense in depth. Strip em dashes on every code path that emits
  // facts (cached or fresh). The user explicitly banned the character;
  // older cached rows generated before that rule still need scrubbing.
  const stripEmDashes = (s) =>
    s.replace(/\s*—\s*/g, ", ").replace(/\s{2,}/g, " ").trim();
  const scrubFacts = (arr) =>
    (Array.isArray(arr) ? arr : [])
      .filter((f) => typeof f === "string" && f.trim())
      .map(stripEmDashes)
      .filter(Boolean);

  if (!force) {
    const cached = readCached(fastHash) || readCached(hash);
    if (cached && Array.isArray(cached.facts) && cached.facts.length) {
      return { ...cached, facts: scrubFacts(cached.facts) };
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

  // stripEmDashes / scrubFacts are defined above (so the cache-hit
  // path also scrubs). Apply on the fresh path too. Models drift; even
  // with the prompt rule one will sneak through eventually.
  const facts = scrubFacts(parsed.facts).slice(0, 8);

  const payload = { facts };
  // Write both rows so subsequent calls can fast-path on either key.
  writeCached(hash, HAIKU_MODEL, payload);
  writeCached(fastHash, HAIKU_MODEL, payload);
  return {
    ...payload,
    generated_at: new Date().toISOString(),
    model: HAIKU_MODEL,
    cached: false,
  };
}
