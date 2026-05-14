// Pre-computed Crazy snapshot cache.
//
// The eight Crazy panels do real work: scanning ~24K user messages,
// walking the filesystem for cost-per-LOC, building bigram/trigram
// counts, running the frustration regex over every body. Cold compute
// is ~600ms-2s. We don't want to pay that on every tab open.
//
// Same flow as wrapped-cache.js: compute once after each importAll,
// store the full payload as a single JSON blob in `summaries`, serve
// from cache on read. Invalidates implicitly because every sync
// rebuilds the snapshot. No filter dimension here, Crazy is always
// a lifetime view.
import { SqlBatch, initDb, queryRows, sha256, sqlString } from "./sqlite.js";
import {
  frustrationByHour,
  costPerLOCKept,
  contextDegradationCurve,
  phantomEdits,
  toolTransitions,
  pepTalkIndex,
  aiFingerprint,
} from "./crazy.js";

const KIND = "crazy_snapshot";
const SNAPSHOT_KEY = sha256("crazy:latest:v1");

function nowIso() {
  return new Date().toISOString();
}

/**
 * Compute the full Crazy payload and stash it in `summaries`. Safe to
 * call repeatedly — INSERT OR REPLACE keeps a single canonical row.
 * Shape is byte-identical to what the live API returns so the route
 * just spreads the cached object into its response.
 */
export function precomputeCrazySnapshot() {
  initDb();
  const payload = {
    generated_at: nowIso(),
    frustration: frustrationByHour(),
    cost_per_loc: costPerLOCKept(),
    context_degradation: contextDegradationCurve(),
    phantom_edits: phantomEdits(),
    tool_transitions: toolTransitions(),
    pep_talk: pepTalkIndex(),
    fingerprint: aiFingerprint(),
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
 * Read the cached snapshot, or null if no sync has run since the
 * cache schema was added. Callers fall back to live compute when null.
 */
export function readCrazySnapshot() {
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
