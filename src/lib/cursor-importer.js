import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import Database from "better-sqlite3";
import { SqlBatch, sha256, sqlNumber, sqlString } from "./sqlite.js";

const SOURCE = "cursor";

function nowIso() {
  return new Date().toISOString();
}

function msToIso(ms) {
  if (!ms) return null;
  return new Date(Number(ms)).toISOString();
}

export function cursorHome() {
  return (
    process.env.CURSOR_HOME ||
    path.join(os.homedir(), "Library", "Application Support", "Cursor")
  );
}

function globalStateDb() {
  const p = path.join(cursorHome(), "User", "globalStorage", "state.vscdb");
  if (!fs.existsSync(p)) return null;
  try {
    // Open read-only so we never corrupt Cursor's live DB
    const db = new Database(p, { readonly: true, fileMustExist: true });
    db.pragma("journal_mode = WAL");
    return db;
  } catch {
    return null;
  }
}

function insertSource(batch, sourcePath, kind) {
  let stat = { mtimeMs: null, size: null };
  try {
    stat = fs.statSync(sourcePath);
  } catch {}
  batch.add(`INSERT OR REPLACE INTO sources
    (path, kind, mtime_ms, size, content_hash, imported_at, source)
    VALUES (${sqlString(sourcePath)}, ${sqlString(kind)}, ${sqlNumber(stat.mtimeMs)},
    ${sqlNumber(stat.size)}, ${sqlString(sha256(sourcePath))}, ${sqlString(nowIso())}, ${sqlString(SOURCE)})`);
}

function insertTurn(batch, turnId, values = {}) {
  if (!turnId) return;
  batch.add(`INSERT INTO turns
    (turn_id, session_id, cwd, model, effort, agent_role, status, started_at, completed_at,
     duration_ms, time_to_first_token_ms, source_path, source_line, source)
    VALUES (${sqlString(turnId)}, ${sqlString(values.sessionId)}, ${sqlString(values.cwd)},
    ${sqlString(values.model)}, ${sqlString(values.effort)}, ${sqlString(values.agentRole)},
    ${sqlString(values.status || "completed")}, ${sqlString(values.startedAt)},
    ${sqlString(values.completedAt)}, ${sqlNumber(values.durationMs)},
    NULL, ${sqlString(values.sourcePath)}, NULL, ${sqlString(SOURCE)})
    ON CONFLICT(turn_id) DO UPDATE SET
      cwd = COALESCE(excluded.cwd, turns.cwd),
      model = COALESCE(excluded.model, turns.model),
      effort = COALESCE(excluded.effort, turns.effort),
      agent_role = COALESCE(excluded.agent_role, turns.agent_role),
      source = ${sqlString(SOURCE)}`);
}

export function importCursor() {
  const db = globalStateDb();
  if (!db) {
    return { source: SOURCE, composers: 0, skipped: "state.vscdb not found" };
  }

  const dbPath = path.join(cursorHome(), "User", "globalStorage", "state.vscdb");
  const batch = new SqlBatch();
  insertSource(batch, dbPath, "cursor_global_state");

  let composerCount = 0;

  try {
    const row = db.prepare("SELECT value FROM ItemTable WHERE key='composer.composerHeaders'").get();
    if (row?.value) {
      let headers;
      try {
        headers = JSON.parse(row.value);
      } catch {
        headers = null;
      }
      const composers = headers?.allComposers;
      if (Array.isArray(composers)) {
        for (const c of composers) {
          const id = c.composerId;
          if (!id) continue;
          const startedAt = msToIso(c.createdAt);
          const cwd = c.workspaceIdentifier?.uri?.fsPath || null;
          const mode = c.unifiedMode || c.forceMode || null;
          insertTurn(batch, `cursor:${id}`, {
            sessionId: id,
            cwd,
            effort: mode,
            agentRole: mode === "agent" ? "cursor-agent" : null,
            status: c.isArchived ? "archived" : "completed",
            startedAt,
            sourcePath: dbPath
          });
          composerCount += 1;
        }
      }
    }
  } finally {
    db.close();
  }

  batch.flush();

  return {
    source: SOURCE,
    composers: composerCount
  };
}
