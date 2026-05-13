import crypto from "node:crypto";
import fs from "node:fs";
import Database from "better-sqlite3";
import { dataDir, dbPath } from "./paths.js";

// Singleton better-sqlite3 connection. Opening per-query was massively slow:
// each metric endpoint spawned the `sqlite3` CLI multiple times, each ~80ms.
// Native in-process binding makes the same queries microseconds.
let _db = null;
function db() {
  if (_db) return _db;
  ensureDataDir();
  _db = new Database(dbPath());
  _db.pragma("journal_mode = WAL");
  _db.pragma("synchronous = NORMAL");
  _db.pragma("temp_store = MEMORY");
  _db.pragma("cache_size = -65536"); // ~64MB page cache
  return _db;
}

export function closeDb() {
  if (_db) {
    _db.close();
    _db = null;
  }
}

export function sha256(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

export function sqlString(value) {
  if (value === null || value === undefined) return "NULL";
  // Strip ASCII control characters (except tab/newline/CR) and lone NULs.
  // Claude session logs can embed websocket binary that breaks the sqlite3
  // CLI parser when passed via stdin.
  const cleaned = String(value).replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, "");
  return `'${cleaned.replaceAll("'", "''")}'`;
}

export function sqlNumber(value) {
  if (value === null || value === undefined || Number.isNaN(Number(value))) return "NULL";
  return String(Number(value));
}

export function sqlBool(value) {
  if (value === null || value === undefined) return "NULL";
  return value ? "1" : "0";
}

export function ensureDataDir() {
  fs.mkdirSync(dataDir(), { recursive: true });
}

export function execSql(sql) {
  // Allow multi-statement scripts via exec; better-sqlite3 supports it.
  db().exec(sql);
}

export function queryRows(sql) {
  // better-sqlite3 returns native JS arrays of objects — no JSON parse, no
  // process spawn. Per-query cost drops from ~80ms (CLI) to microseconds.
  return db().prepare(sql).all();
}

export function initDb() {
  execSql(`
PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sources (
  path TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  mtime_ms INTEGER,
  size INTEGER,
  content_hash TEXT,
  imported_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skills (
  name TEXT PRIMARY KEY,
  kind TEXT NOT NULL,
  path TEXT,
  description TEXT,
  description_hash TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS turns (
  turn_id TEXT PRIMARY KEY,
  session_id TEXT,
  cwd TEXT,
  model TEXT,
  effort TEXT,
  agent_role TEXT,
  status TEXT,
  started_at TEXT,
  completed_at TEXT,
  duration_ms INTEGER,
  time_to_first_token_ms INTEGER,
  source_path TEXT,
  source_line INTEGER
);

CREATE TABLE IF NOT EXISTS raw_events (
  event_id TEXT PRIMARY KEY,
  source_path TEXT NOT NULL,
  source_line INTEGER NOT NULL,
  timestamp TEXT,
  event_type TEXT,
  payload_type TEXT,
  raw_json TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS skill_events (
  event_key TEXT PRIMARY KEY,
  skill_name TEXT NOT NULL,
  turn_id TEXT,
  event_type TEXT NOT NULL,
  confidence TEXT NOT NULL,
  timestamp TEXT,
  source_kind TEXT NOT NULL,
  source_path TEXT,
  source_line INTEGER,
  evidence_id TEXT,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS tool_events (
  event_key TEXT PRIMARY KEY,
  turn_id TEXT,
  call_id TEXT,
  tool_name TEXT NOT NULL,
  command TEXT,
  status TEXT,
  exit_code INTEGER,
  duration_ms INTEGER,
  cwd TEXT,
  timestamp TEXT,
  evidence_id TEXT,
  output_summary TEXT
);

CREATE TABLE IF NOT EXISTS errors (
  error_key TEXT PRIMARY KEY,
  turn_id TEXT,
  skill_name TEXT,
  severity TEXT NOT NULL,
  category TEXT NOT NULL,
  message TEXT NOT NULL,
  timestamp TEXT,
  source_path TEXT,
  source_line INTEGER,
  evidence_id TEXT
);

CREATE TABLE IF NOT EXISTS token_usage (
  event_key TEXT PRIMARY KEY,
  turn_id TEXT,
  timestamp TEXT,
  input_tokens INTEGER,
  cached_input_tokens INTEGER,
  output_tokens INTEGER,
  reasoning_output_tokens INTEGER,
  total_tokens INTEGER,
  primary_used_percent REAL,
  secondary_used_percent REAL,
  evidence_id TEXT
);

CREATE INDEX IF NOT EXISTS idx_skill_events_skill ON skill_events(skill_name);
CREATE INDEX IF NOT EXISTS idx_skill_events_turn ON skill_events(turn_id);
CREATE INDEX IF NOT EXISTS idx_skill_events_time ON skill_events(timestamp);
CREATE INDEX IF NOT EXISTS idx_errors_time ON errors(timestamp);
CREATE INDEX IF NOT EXISTS idx_errors_skill ON errors(skill_name);
CREATE INDEX IF NOT EXISTS idx_tool_events_turn ON tool_events(turn_id);
CREATE INDEX IF NOT EXISTS idx_token_usage_turn ON token_usage(turn_id);
`);

  // Lightweight migration: add `source` column to every events/turns table so
  // we can attribute rows to codex vs claude. SQLite has no IF NOT EXISTS on
  // ALTER TABLE, so swallow the duplicate-column error.
  const addSource = (table) => {
    try {
      execSql(`ALTER TABLE ${table} ADD COLUMN source TEXT NOT NULL DEFAULT 'codex';`);
    } catch (e) {
      const msg = String(e?.message || "");
      if (!/duplicate column/i.test(msg)) throw e;
    }
  };
  for (const t of ["skills", "turns", "raw_events", "skill_events", "tool_events", "errors", "token_usage", "sources"]) {
    addSource(t);
  }
  execSql(`CREATE INDEX IF NOT EXISTS idx_skill_events_source ON skill_events(source);
CREATE INDEX IF NOT EXISTS idx_tool_events_source ON tool_events(source);
CREATE INDEX IF NOT EXISTS idx_turns_source ON turns(source);
CREATE INDEX IF NOT EXISTS idx_errors_source ON errors(source);
-- Composite indexes that match the patterns used by the success-rate +
-- skill-event-by-time queries. Reduces overview load from ~2s to <50ms.
CREATE INDEX IF NOT EXISTS idx_skill_events_skill_turn ON skill_events(skill_name, turn_id);
CREATE INDEX IF NOT EXISTS idx_tool_events_turn_status ON tool_events(turn_id, status);
CREATE INDEX IF NOT EXISTS idx_token_usage_time ON token_usage(timestamp);
CREATE INDEX IF NOT EXISTS idx_turns_started ON turns(started_at);`);

  // Layer 3: LLM-as-judge verdicts. One row per (skill_event_key, judge).
  // Judges: "haiku" (Claude Code's Haiku model) and "codex" (codex exec).
  // Codex acts as a tiebreaker on cases where the Haiku judge and the
  // skill's self-report disagree by ≥ MIN_DRIFT.
  execSql(`
CREATE TABLE IF NOT EXISTS judgments (
  judgment_key TEXT PRIMARY KEY,
  skill_event_key TEXT NOT NULL,
  skill_name TEXT,
  turn_id TEXT,
  judge TEXT NOT NULL,                -- "haiku" | "codex"
  model TEXT,
  fit INTEGER,                        -- 0-10
  value INTEGER,                      -- 0-10
  corrections INTEGER,
  well TEXT,
  poorly TEXT,
  raw_response TEXT,
  error TEXT,
  prompt_chars INTEGER,
  judged_at TEXT NOT NULL,
  duration_ms INTEGER,
  source TEXT NOT NULL DEFAULT 'claude'
);
CREATE INDEX IF NOT EXISTS idx_judgments_event ON judgments(skill_event_key);
CREATE INDEX IF NOT EXISTS idx_judgments_skill ON judgments(skill_name);
CREATE INDEX IF NOT EXISTS idx_judgments_judge ON judgments(judge);
CREATE INDEX IF NOT EXISTS idx_judgments_time ON judgments(judged_at);
`);
}

export class SqlBatch {
  constructor(limit = 450) {
    this.limit = limit;
    this.statements = [];
  }

  add(statement) {
    this.statements.push(statement.endsWith(";") ? statement : `${statement};`);
    if (this.statements.length >= this.limit) this.flush();
  }

  flush() {
    if (!this.statements.length) return;
    execSql(`BEGIN;\n${this.statements.join("\n")}\nCOMMIT;`);
    this.statements = [];
  }
}
