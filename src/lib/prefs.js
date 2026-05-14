// Server-side user-preferences store, backed by SQLite. Replaces what
// used to live in browser localStorage so prefs survive site-data
// clears and are part of the same backup story as the rest of the DB.
//
// Schema: tiny key/value table (`user_prefs`). Each value is
// JSON-encoded so we don't have to invent column types for "is the
// value an array or a number or a bool". One read on mount, write-
// through on every change.

import { SqlBatch, initDb, queryRows, sqlString } from "./sqlite.js";

// The canonical set of keys. The client and server both consult this
// when reading defaults so an empty DB doesn't return missing entries.
export const DEFAULT_PREFS = {
  hiddenTabs: [],
  hiddenSources: [],
  syncIntervalMinutes: 30,
  region: "auto",
  anonymize: false,
  paletteRecency: [],
  // Theme lives here AND in localStorage. The mirror in localStorage is
  // strictly for the pre-paint FOUC script — the source of truth on
  // disk is this row. Default is "light" so a fresh install doesn't
  // surprise users with dark mode just because their OS happens to be
  // in dark mode at install time. They can opt into "system" or "dark"
  // from Settings → Appearance.
  theme: "light",
};

export function getAllPrefs() {
  initDb();
  const rows = queryRows(`SELECT key, value FROM user_prefs`);
  const out = { ...DEFAULT_PREFS };
  for (const r of rows) {
    try {
      out[r.key] = JSON.parse(r.value);
    } catch {
      // Skip corrupt rows; default still wins.
    }
  }
  return out;
}

export function setPrefs(patch) {
  if (!patch || typeof patch !== "object") return getAllPrefs();
  initDb();
  const batch = new SqlBatch();
  const nowIso = new Date().toISOString();
  for (const [k, v] of Object.entries(patch)) {
    // Only persist known keys — unknown keys are silently dropped so a
    // misbehaving client can't bloat the table.
    if (!(k in DEFAULT_PREFS)) continue;
    batch.add(
      `INSERT OR REPLACE INTO user_prefs (key, value, updated_at)
       VALUES (${sqlString(k)}, ${sqlString(JSON.stringify(v))}, ${sqlString(nowIso)})`
    );
  }
  batch.flush();
  return getAllPrefs();
}
