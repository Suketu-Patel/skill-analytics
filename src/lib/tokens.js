// SINGLE SOURCE OF TRUTH for token-count semantics.
//
// Every endpoint that reports a token number MUST go through `normalizeRow()`
// (per token_usage row) or `aggregate()` (per array of rows). Bypassing this
// — e.g. summing raw `input_tokens` directly — will produce numbers that
// disagree with the rest of the dashboard.
//
// The whole point of this file: Claude and Codex disagree on what
// `input_tokens` means. Without normalization at read time, every
// aggregator has to remember the branch on its own, and they will drift.
//
// ─── provider conventions ───────────────────────────────────────────────
//
// Anthropic (claude):
//   - input_tokens                  = fresh prompt tokens (already excludes cached)
//   - cache_read_input_tokens       = tokens served from prompt cache
//   - cache_creation_input_tokens   = tokens written to cache (priced ~1.25x input)
//   - output_tokens                 = model output
//   The importer stores cache_read + cache_creation in `cached_input_tokens`.
//   No reasoning tokens (Anthropic doesn't expose them separately).
//
// OpenAI (codex):
//   - input_tokens                  = TOTAL prompt size (INCLUDES cached subset)
//   - cached_input_tokens           = cached subset of input
//   - output_tokens                 = visible model output
//   - reasoning_output_tokens       = hidden reasoning tokens (priced like output)
//
// ─── normalized fields we expose ────────────────────────────────────────
//
//   fresh_input    : prompt tokens that were NOT cached (priced at input rate)
//   cached_input   : prompt tokens served from cache (priced at cache_read rate)
//   output         : visible output (priced at output rate)
//   reasoning      : hidden reasoning output (priced at output rate)
//   billable       : fresh_input + output + reasoning
//                    → this is the headline "Tokens" number everywhere
//   grand_total    : fresh_input + cached_input + output + reasoning
//                    → only useful for "we processed N tokens of context" framing,
//                      almost never the right number to surface as a headline

const NUMERIC_FIELDS = [
  "input_tokens",
  "cached_input_tokens",
  "output_tokens",
  "reasoning_output_tokens",
];

function toNum(v) {
  const n = Number(v);
  return Number.isFinite(n) && n >= 0 ? n : 0;
}

/**
 * Convert one row from the `token_usage` table (or anything with the same
 * shape) into normalized counts. `source` MUST be "claude" or "codex" —
 * the per-provider input semantics differ.
 */
export function normalizeRow(source, row) {
  const r = row || {};
  // Validate inputs cheaply — keep silent zeros rather than NaN propagation.
  for (const f of NUMERIC_FIELDS) {
    if (r[f] != null && !Number.isFinite(Number(r[f]))) {
      // bad data → treat as zero; importer should have caught this but
      // we'd rather show $0 in one place than NaN everywhere.
      r[f] = 0;
    }
  }
  const inputRaw = toNum(r.input_tokens);
  const cached = toNum(r.cached_input_tokens);
  const output = toNum(r.output_tokens);
  const reasoning = toNum(r.reasoning_output_tokens);

  // Provider-specific fresh-input semantics.
  const fresh =
    source === "claude" ? inputRaw : Math.max(0, inputRaw - cached);

  const billable = fresh + output + reasoning;
  const grandTotal = fresh + cached + output + reasoning;

  return {
    fresh_input: fresh,
    cached_input: cached,
    output,
    reasoning,
    billable,
    grand_total: grandTotal,
  };
}

const EMPTY = {
  fresh_input: 0,
  cached_input: 0,
  output: 0,
  reasoning: 0,
  billable: 0,
  grand_total: 0,
};

/**
 * Sum normalized counts across an array of (source, row) tuples. Pass
 * rows that already include a `source` field, or shape them in.
 *
 * Example:
 *   const rows = queryRows("SELECT source, input_tokens, ... FROM token_usage WHERE ...");
 *   const totals = aggregate(rows);
 *   // totals.billable, totals.cached_input, etc.
 */
export function aggregate(rows) {
  const acc = { ...EMPTY };
  if (!rows || !rows.length) return acc;
  for (const row of rows) {
    const n = normalizeRow(row.source, row);
    acc.fresh_input += n.fresh_input;
    acc.cached_input += n.cached_input;
    acc.output += n.output;
    acc.reasoning += n.reasoning;
    acc.billable += n.billable;
    acc.grand_total += n.grand_total;
  }
  return acc;
}

/**
 * Group + aggregate by an arbitrary key extractor.
 *
 * Example:
 *   const perSource = aggregateBy(rows, (r) => r.source);
 *   // → Map { "claude" → {billable: ..., ...}, "codex" → {...} }
 */
export function aggregateBy(rows, keyFn) {
  const groups = new Map();
  for (const row of rows || []) {
    const key = keyFn(row);
    if (key == null) continue;
    const bucket = groups.get(key) || { ...EMPTY };
    const n = normalizeRow(row.source, row);
    bucket.fresh_input += n.fresh_input;
    bucket.cached_input += n.cached_input;
    bucket.output += n.output;
    bucket.reasoning += n.reasoning;
    bucket.billable += n.billable;
    bucket.grand_total += n.grand_total;
    groups.set(key, bucket);
  }
  return groups;
}

export { EMPTY as EMPTY_TOTALS };
