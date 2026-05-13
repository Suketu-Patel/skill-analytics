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

function compactText(value, length = 900) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, length);
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

function insertToolEvent(batch, values) {
  const key = sha256(`cursor:${values.callId || ""}:${values.toolName}:${values.command || ""}`);
  batch.add(`INSERT OR REPLACE INTO tool_events
    (event_key, turn_id, call_id, tool_name, command, status, exit_code, duration_ms,
     cwd, timestamp, evidence_id, output_summary, source)
    VALUES (${sqlString(key)}, NULL, ${sqlString(values.callId)},
    ${sqlString(values.toolName)}, ${sqlString(values.command)}, 'called',
    NULL, NULL, NULL, NULL, NULL, ${sqlString(values.outputSummary)}, ${sqlString(SOURCE)})`);
}

function importComposers(db, batch, dbPath) {
  const row = db.prepare("SELECT value FROM ItemTable WHERE key='composer.composerHeaders'").get();
  if (!row?.value) return 0;

  let headers;
  try { headers = JSON.parse(row.value); } catch { return 0; }

  const composers = headers?.allComposers;
  if (!Array.isArray(composers)) return 0;

  for (const c of composers) {
    const id = c.composerId;
    if (!id) continue;
    const mode = c.unifiedMode || c.forceMode || null;
    insertTurn(batch, `cursor:${id}`, {
      sessionId: id,
      cwd: c.workspaceIdentifier?.uri?.fsPath || null,
      effort: mode,
      agentRole: mode === "agent" ? "cursor-agent" : null,
      status: c.isArchived ? "archived" : "completed",
      startedAt: msToIso(c.createdAt),
      sourcePath: dbPath
    });
  }
  return composers.length;
}

function importToolCalls(db, batch) {
  // agentKv:blob:* entries are content-addressed conversation messages.
  // Assistant messages contain arrays of content parts; tool-call parts
  // hold real tool invocations (read_file, search_replace, Shell, Write, etc.)
  const rows = db.prepare(
    "SELECT key, value FROM cursorDiskKV WHERE typeof(value)='blob' AND CAST(value AS TEXT) LIKE '%\"type\":\"tool-call\"%'"
  ).all();

  let toolCallCount = 0;
  for (const row of rows) {
    let msg;
    try { msg = JSON.parse(row.value); } catch { continue; }
    if (!Array.isArray(msg.content)) continue;

    for (const part of msg.content) {
      if (part?.type !== "tool-call") continue;
      const toolName = part.toolName || part.name || "tool";
      const args = part.args ? compactText(JSON.stringify(part.args)) : null;
      insertToolEvent(batch, {
        callId: part.toolCallId || null,
        toolName,
        command: args,
        outputSummary: null
      });
      toolCallCount += 1;
    }
  }
  return toolCallCount;
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
  let toolCallCount = 0;

  try {
    composerCount = importComposers(db, batch, dbPath);
    toolCallCount = importToolCalls(db, batch);
  } finally {
    db.close();
  }

  batch.flush();

  return {
    source: SOURCE,
    composers: composerCount,
    toolCalls: toolCallCount
  };
}
