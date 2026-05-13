// Live API pricing (May 2026), in dollars per 1M tokens.
// Sources: claude.com/pricing, devtk.ai pricing guide, openai docs.
//
// Each entry is { input, output, cache_read, cache_write }.
// `cache_write` is only meaningful for Claude (Anthropic charges a 25% surcharge
// over base input for cache writes). For OpenAI we collapse `cache_write` into
// `input` because the cached-input price already covers reads and there is no
// separate write surcharge.

export const PRICING = {
  claude: {
    "claude-opus-4-7":            { input: 5.0,  output: 25.0, cache_read: 0.50, cache_write: 6.25 },
    "claude-opus-4-6":            { input: 5.0,  output: 25.0, cache_read: 0.50, cache_write: 6.25 },
    "claude-opus-4-5-20251101":   { input: 15.0, output: 75.0, cache_read: 1.50, cache_write: 18.75 },
    "claude-sonnet-4-6":          { input: 3.0,  output: 15.0, cache_read: 0.30, cache_write: 3.75 },
    "claude-haiku-4-5-20251001":  { input: 1.0,  output: 5.0,  cache_read: 0.10, cache_write: 1.25 }
  },
  codex: {
    "gpt-5.5":             { input: 5.0,  output: 30.0, cache_read: 0.50, cache_write: 5.0 },
    "gpt-5":               { input: 1.25, output: 10.0, cache_read: 0.125, cache_write: 1.25 },
    "gpt-5-mini":          { input: 0.25, output: 2.0,  cache_read: 0.025, cache_write: 0.25 },
    "gpt-5-nano":          { input: 0.05, output: 0.40, cache_read: 0.005, cache_write: 0.05 },
    "gpt-5.2-codex":       { input: 1.75, output: 14.0, cache_read: 0.175, cache_write: 1.75 },
    "gpt-5-codex":         { input: 1.75, output: 14.0, cache_read: 0.175, cache_write: 1.75 },
    // codex-auto-review is Codex's review subagent — same family as gpt-5-codex.
    "codex-auto-review":   { input: 1.75, output: 14.0, cache_read: 0.175, cache_write: 1.75 }
  }
};

// Subscription anchors, used by the "subscription vs API" callout.
// Picks the cheapest tier whose monthly equivalent ≥ user's API spend.
export const SUBSCRIPTIONS = {
  claude: [
    { name: "Claude Pro",  monthly: 20 },
    { name: "Claude Max 5x",  monthly: 100 },
    { name: "Claude Max 20x", monthly: 200 }
  ],
  codex: [
    { name: "ChatGPT Plus", monthly: 20 },
    { name: "ChatGPT Pro",  monthly: 200 }
  ]
};

// When a model isn't in the table we fall back to the safest assumption per
// source so spend doesn't silently drop to $0.
const FALLBACK = {
  claude: PRICING.claude["claude-opus-4-7"],
  codex:  PRICING.codex["gpt-5.2-codex"]
};

// Resolution order for a given (source, model):
//   1. Validated overrides from `data/pricing-overrides.json` if present
//      (populated by the background WebSearch validator — see
//      src/lib/pricing-validator.js).
//   2. The hardcoded PRICING table in this file.
//   3. The source's FALLBACK entry.
//
// Reading from disk on every call would be wasteful, so we cache the
// JSON and refresh on a 30s timer keyed by file mtime — cheap, and
// catches updates from the validator without a restart.
import fs from "node:fs";
import path from "node:path";
import { dataDir } from "./paths.js";

let overridesCache = { mtime: 0, claude: {}, codex: {}, checkedAt: 0 };

function loadOverrides() {
  // Throttle the stat-then-read pattern to once every 30 seconds. The
  // validator only updates the file once per ~24h so this is plenty.
  const now = Date.now();
  if (now - overridesCache.checkedAt < 30_000) return overridesCache;
  overridesCache.checkedAt = now;
  try {
    const p = path.join(dataDir(), "pricing-overrides.json");
    const stat = fs.statSync(p);
    if (stat.mtimeMs === overridesCache.mtime) return overridesCache;
    const parsed = JSON.parse(fs.readFileSync(p, "utf8"));
    overridesCache = {
      mtime: stat.mtimeMs,
      checkedAt: now,
      claude: parsed?.claude || {},
      codex: parsed?.codex || {},
    };
  } catch {
    // Missing or unreadable → fall back to PRICING. Don't poison the cache.
  }
  return overridesCache;
}

export function priceFor(source, model) {
  const overrides = loadOverrides();
  const overrideTable = (source === "claude" ? overrides.claude : overrides.codex) || {};
  if (model && overrideTable[model]) {
    return { priced: true, source: "override", ...overrideTable[model] };
  }
  const table = PRICING[source] || {};
  if (model && table[model]) return { priced: true, source: "hardcoded", ...table[model] };
  return { priced: false, source: "fallback", ...(FALLBACK[source] || FALLBACK.codex) };
}

// Normalize the "fresh input tokens" semantics across providers.
//
// OpenAI / Codex convention: `input_tokens` is the TOTAL prompt size, and
// `cached_input_tokens` is the cached SUBSET → fresh = input - cached.
//
// Anthropic / Claude convention: `input_tokens` is ALREADY the fresh portion;
// `cache_read_input_tokens` + `cache_creation_input_tokens` are reported
// SEPARATELY and add on top → fresh = input (no subtraction).
//
// Without this branch Claude shows negative "fresh input" because cached
// dwarfs the raw input field.
export function freshInputTokens(source, tokens) {
  const input = Number(tokens?.input_tokens || 0);
  const cached = Number(tokens?.cached_input_tokens || 0);
  if (source === "claude") return input;
  return Math.max(0, input - cached);
}

// Cost is derived from token counts via the canonical normalizer in
// `tokens.js` — same fields, same semantics as every display in the UI.
// If you find yourself summing input_tokens directly anywhere outside
// this file, route it through normalizeRow() instead.
import { normalizeRow } from "./tokens.js";

export function computeCost(source, model, tokens) {
  const p = priceFor(source, model);
  const n = normalizeRow(source, tokens);

  // Reasoning tokens are billed at output rate by both providers.
  const inputCost = (n.fresh_input / 1_000_000) * p.input;
  const cachedCost = (n.cached_input / 1_000_000) * p.cache_read;
  const outputCost = ((n.output + n.reasoning) / 1_000_000) * p.output;

  // What the cached chunk would have cost without caching, for the savings KPI.
  const savedByCaching = (n.cached_input / 1_000_000) * (p.input - p.cache_read);

  return {
    cost: inputCost + cachedCost + outputCost,
    input_cost: inputCost,
    cached_cost: cachedCost,
    output_cost: outputCost,
    // Expose the normalized count so callers don't recompute it.
    fresh_input_tokens: n.fresh_input,
    cached_input_tokens: n.cached_input,
    output_tokens: n.output,
    reasoning_output_tokens: n.reasoning,
    billable_tokens: n.billable,
    saved_by_caching: savedByCaching,
    priced: p.priced,
    price: p
  };
}

export function knownModels(source) {
  return Object.keys(PRICING[source] || {});
}
