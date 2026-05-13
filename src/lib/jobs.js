// In-process job registry. Long-running tasks (judge sweeps that call
// Haiku or codex over many invocations) run in the background so the
// API request can return immediately. The UI polls /api/judge/job/<id>.
//
// In-memory only — restarting `next dev` drops the history.

import crypto from "node:crypto";

// Next.js dev mode hot-reloads modules on every edit, which would wipe a
// module-level Map. Park the registry on globalThis so it survives HMR
// (production builds keep their own copy, which is fine — workers are
// per-process).
const GLOBAL_KEY = "__skill_analytics_jobs__";
const g = /** @type {any} */ (globalThis);
if (!g[GLOBAL_KEY]) g[GLOBAL_KEY] = new Map();
const JOBS = g[GLOBAL_KEY];
const MAX_KEEP = 50;
// A "running" job that hasn't progressed in this long is almost certainly
// orphaned (subprocess died, server was restarted, etc.). Mark such jobs
// as `abandoned` so the UI doesn't think the system is busy forever.
const ABANDON_AFTER_MS = 5 * 60 * 1000;

export function newJob(kind, total = 0) {
  const id = crypto.randomBytes(6).toString("hex");
  const job = {
    id,
    kind,
    status: "running",
    started_at: Date.now() / 1000,
    ended_at: null,
    total,
    done: 0,
    results: [],            // per-invocation outcomes (capped)
    error: null,
  };
  JOBS.set(id, job);
  trim();
  return job;
}

export function progressJob(id, result) {
  const j = JOBS.get(id);
  if (!j) return;
  j.done += 1;
  j.last_progress_at = Date.now() / 1000;
  if (j.results.length < 50) j.results.push(result);
}

/**
 * Mark any "running" jobs whose last progress (or start, if no progress
 * yet) is older than ABANDON_AFTER_MS as `abandoned`. Called from
 * listJobs / getJob lazily so the UI naturally clears stale state on its
 * next refresh — no separate cron required.
 */
function reapStale() {
  const nowSec = Date.now() / 1000;
  for (const j of JOBS.values()) {
    if (j.status !== "running") continue;
    const lastActivity = j.last_progress_at || j.started_at || 0;
    if ((nowSec - lastActivity) * 1000 > ABANDON_AFTER_MS) {
      j.status = "abandoned";
      j.ended_at = nowSec;
      j.error = j.error || "no progress for >5min; subprocess likely died";
    }
  }
}

export function clearJobs() {
  JOBS.clear();
}

export function finishJob(id, fields = {}) {
  const j = JOBS.get(id);
  if (!j) return;
  Object.assign(j, fields);
  j.ended_at = Date.now() / 1000;
  if (!fields.status) j.status = fields.error ? "error" : "done";
}

export function getJob(id) {
  reapStale();
  const j = JOBS.get(id);
  return j ? { ...j, results: j.results.slice() } : null;
}

export function listJobs() {
  reapStale();
  return [...JOBS.values()]
    .sort((a, b) => (b.started_at || 0) - (a.started_at || 0))
    .slice(0, MAX_KEEP)
    .map((j) => ({ ...j, results: j.results.slice() }));
}

function trim() {
  if (JOBS.size <= MAX_KEEP) return;
  const oldest = [...JOBS.values()]
    .sort((a, b) => (a.started_at || 0) - (b.started_at || 0))
    .slice(0, JOBS.size - MAX_KEEP);
  for (const j of oldest) JOBS.delete(j.id);
}
