// Pre-computed Wrapped snapshot cache.
//
// Wrapped pulls together cost-overview + comparison + fun-facts every
// time a user opens the tab. That's slow on a fresh DB (~300ms+).
// Instead we compute it once per sync (after importAll), store in
// SQLite, and serve from cache on read. The Wrapped tab becomes instant.

import { SqlBatch, initDb, queryRows, sha256, sqlString } from "./sqlite.js";
import {
  getComparisonMetrics,
  getCostOverview,
  getUserSkillCounts,
} from "./metrics.js";

const KIND = "wrapped_snapshot";
// One canonical row keyed "latest" — we only care about the most recent
// snapshot. Older snapshots get overwritten via INSERT OR REPLACE.
const SNAPSHOT_KEY = sha256("wrapped:latest:v1");

function nowIso() {
  return new Date().toISOString();
}

/**
 * Compute the entire Wrapped payload (everything the tab needs except
 * AI fun facts, which have their own cache layer) and store it as a
 * single JSON blob in `summaries`. Safe to call repeatedly — the row is
 * replaced atomically.
 */
export function precomputeWrappedSnapshot() {
  initDb();
  // No filter — Wrapped always shows the full lifetime view. If the
  // user filters via the date brush, the live endpoint serves a custom
  // payload outside this cache.
  //
  // We wrap each sub-payload in {ok: true, ...} so the cached shape is
  // byte-identical to what the live /api/metrics/* endpoints return.
  // Without this wrapper the view's `snap.cost_overview?.ok` check
  // silently fails and the user sees "No data. Run Import first." even
  // when the snapshot is fresh.
  const cost = getCostOverview({});
  const comparison = getComparisonMetrics({});
  const userSkills = getUserSkillCounts({});
  const payload = {
    generated_at: nowIso(),
    cost_overview: { ok: true, ...cost },
    comparison: { ok: true, ...comparison },
    user_skills: { ok: true, ...userSkills },
  };
  const batch = new SqlBatch();
  batch.add(
    `INSERT OR REPLACE INTO summaries (content_hash, kind, model, generated_at, payload)
     VALUES (${sqlString(SNAPSHOT_KEY)}, ${sqlString(KIND)}, NULL,
             ${sqlString(payload.generated_at)},
             ${sqlString(JSON.stringify(payload))})`
  );
  batch.flush();
  return payload;
}

/**
 * Read the cached snapshot, or null if no sync has run yet. Callers
 * should fall back to computing live when null.
 */
export function readWrappedSnapshot() {
  initDb();
  const rows = queryRows(
    `SELECT payload, generated_at FROM summaries WHERE content_hash = ${sqlString(SNAPSHOT_KEY)} LIMIT 1`
  );
  if (!rows.length) return null;
  try {
    const payload = JSON.parse(rows[0].payload);
    return { ...payload, cached: true };
  } catch {
    return null;
  }
}
