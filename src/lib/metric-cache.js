// Generic metric cache.
//
// Every cacheable /api/metrics/* route runs through `readOrCompute`. On
// a hit it returns the stored JSON blob (sub-millisecond SQLite read).
// On a miss it computes live, stores under a deterministic key, and
// returns the fresh payload. The cache is invalidated wholesale at the
// end of each sync (importer.js), so freshness is bounded by the sync
// interval (30 min auto-sync, or whenever the user clicks Import).
//
// Why SQLite and not an in-memory map: Next.js dev mode tears down the
// module graph on edit, and the user opens new tabs across processes
// (the API runs in a fresh worker on first hit). Cross-process means we
// need shared storage. The `summaries` table already exists for the
// wrapped cache + AI fun facts; we reuse it with a `metric:` kind
// prefix to avoid schema churn.
//
// Key shape: sha256("metric:" + kind + ":" + canonical(opts)). The
// canonical form drops undefined fields, lowercases source, and clamps
// to known opts keys so two callers with semantically identical filter
// state hit the same row.

import { SqlBatch, initDb, queryRows, sha256, sqlString, execSql } from "./sqlite.js";

const KIND_PREFIX = "metric:";

// Stable JSON form for the cache key. We pick the canonical set of opt
// keys explicitly so an accidental extra field on the request object
// doesn't fork the cache.
function canonicalOpts(opts) {
  const o = opts || {};
  const out = {};
  if (o.source && o.source !== "all") out.source = String(o.source).toLowerCase();
  if (o.from) out.from = String(o.from);
  if (o.to) out.to = String(o.to);
  if (o.project) out.project = String(o.project);
  if (typeof o.limit === "number") out.limit = o.limit;
  return out;
}

function keyFor(kind, opts) {
  return sha256(KIND_PREFIX + kind + ":" + JSON.stringify(canonicalOpts(opts)));
}

function nowIso() {
  return new Date().toISOString();
}

/**
 * Cache-aside read. Computes via `fn()` on miss and persists the
 * resulting object verbatim. The payload must be JSON-serialisable.
 *
 * Pass `force: true` to skip the read and rewrite the row from a fresh
 * computation — used by the precompute pass after sync.
 */
export function readOrCompute(kind, opts, fn, { force = false } = {}) {
  initDb();
  const key = keyFor(kind, opts);
  if (!force) {
    const rows = queryRows(
      `SELECT payload FROM summaries WHERE content_hash = ${sqlString(key)} LIMIT 1`
    );
    if (rows.length) {
      try {
        return { ...JSON.parse(rows[0].payload), cached: true };
      } catch {
        // Corrupt row — fall through and overwrite below.
      }
    }
  }
  const fresh = fn();
  const payload = { ...fresh, generated_at: nowIso() };
  const batch = new SqlBatch();
  batch.add(
    `INSERT OR REPLACE INTO summaries (content_hash, kind, model, generated_at, payload)
     VALUES (${sqlString(key)}, ${sqlString(KIND_PREFIX + kind)}, NULL,
             ${sqlString(payload.generated_at)},
             ${sqlString(JSON.stringify(payload))})`
  );
  batch.flush();
  return { ...payload, cached: false };
}

/**
 * Drop every row whose kind starts with `metric:`. Called at the top of
 * the post-sync revalidate pass so we never serve pre-sync data.
 */
export function invalidateAll() {
  initDb();
  execSql(`DELETE FROM summaries WHERE kind LIKE ${sqlString(KIND_PREFIX + "%")}`);
}

/**
 * Warm the cache with the variants users are most likely to hit. The
 * "no-filter" variant for every metric is essentially free to compute
 * and saves the first-load latency on every tab. Per-project variants
 * are precomputed only for the top metrics that drive the project-scope
 * UI (overview + cost-overview + skills); the rest populate lazily.
 *
 * `getKnownProjects` is injected to avoid a circular import — the
 * caller (importer.js) hands us a list of cwds discovered during sync.
 */
export async function precomputeAll({ getKnownProjects } = {}) {
  const metrics = await import("./metrics.js");

  // No-filter warm-up. One pass per metric kind. We use force=true so
  // a stale row from a prior sync doesn't survive when the underlying
  // numbers shifted (invalidateAll already wiped, but force is the
  // belt-and-braces version).
  const tasks = [
    ["overview", () => metrics.getOverviewMetrics({})],
    ["cost-overview", () => ({ ok: true, ...metrics.getCostOverview({}) })],
    ["comparison", () => metrics.getComparisonMetrics({})],
    ["errors", () => ({ errors: metrics.getErrorMetrics(200, {}) })],
    ["insights", () => metrics.getInsights({})],
    ["pricing", () => metrics.getPricingMetrics({})],
    // Skills isn't precomputed here — the route applies a categorize()
    // post-step that the metrics lib doesn't know about. Populates on
    // first request and stays cached until the next invalidateAll.
    ["timeline", () => ({ timeline: metrics.getTimelineMetrics({}) })],
    ["sparkline", () => ({ ok: true, ...metrics.getRecentSparkline() })],
  ];

  for (const [kind, fn] of tasks) {
    try {
      readOrCompute(kind, {}, fn, { force: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[metric-cache] precompute ${kind} failed:`, err?.message || err);
    }
  }

  // Per-project warm-up for the views that have a project picker. We
  // intentionally skip the long tail (insights/pricing/timeline) — they
  // populate on first scoped request and stay cached until next sync.
  const projects = typeof getKnownProjects === "function" ? getKnownProjects() : [];
  for (const project of projects) {
    if (!project) continue;
    const opts = { project };
    try {
      readOrCompute("overview", opts, () => metrics.getOverviewMetrics(opts), { force: true });
      readOrCompute("cost-overview", opts, () => ({ ok: true, ...metrics.getCostOverview(opts) }), { force: true });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[metric-cache] precompute project ${project} failed:`, err?.message || err);
    }
  }
}
