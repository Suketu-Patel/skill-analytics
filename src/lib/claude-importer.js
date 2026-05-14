import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { SqlBatch, execSql, sha256, sqlNumber, sqlString } from "./sqlite.js";

const MAX_TEXT = 900;
const MAX_RAW = 200000;
const SOURCE = "claude";

// Phrases that suggest the user pushed back on the skill's output. Used
// to mark a Skill invocation as having received a course-correction in
// the very next user turn. Conservative — better to underflag than to
// over-detect frustration.
const CORRECTION_RE =
  /\b(no|wrong|actually|instead|that'?s not|try again|undo|revert|broken|fix this|redo|start over|didn'?t (?:work|finish|complete))\b/i;

function nowIso() {
  return new Date().toISOString();
}

function compactText(value, length = MAX_TEXT) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, length);
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function stableId(...parts) {
  return sha256(parts.join(":"));
}

function listClaudeProjects() {
  const root = path.join(os.homedir(), ".claude", "projects");
  if (!fs.existsSync(root)) return [];
  return fs.readdirSync(root).filter((entry) => {
    try {
      return fs.statSync(path.join(root, entry)).isDirectory();
    } catch {
      return false;
    }
  });
}

function projectFromDirname(name) {
  // Directories use the cwd with separators replaced by `-`, e.g.
  // "/Users/suketupatel/Desktop/project/ilit" -> "-Users-suketupatel-Desktop-project-ilit"
  // Surface just the last segment as the project label.
  if (!name) return null;
  const parts = name.split("-").filter(Boolean);
  return parts[parts.length - 1] || name;
}

function walkSessionFiles(dir, results = []) {
  if (!fs.existsSync(dir)) return results;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkSessionFiles(full, results);
    } else if (entry.name.endsWith(".jsonl")) {
      results.push(full);
    }
  }
  return results;
}

function insertSource(batch, sourcePath, kind, content) {
  let stat = { mtimeMs: null, size: null };
  try {
    stat = fs.statSync(sourcePath);
  } catch {}
  batch.add(`INSERT OR REPLACE INTO sources
    (path, kind, mtime_ms, size, content_hash, imported_at, source)
    VALUES (${sqlString(sourcePath)}, ${sqlString(kind)}, ${sqlNumber(stat.mtimeMs)},
    ${sqlNumber(stat.size)}, ${sqlString(sha256(content))}, ${sqlString(nowIso())}, ${sqlString(SOURCE)})`);
}

function insertRaw(batch, sourcePath, line, rawLine, parsed) {
  const evid = stableId(sourcePath, line, rawLine);
  batch.add(`INSERT OR REPLACE INTO raw_events
    (event_id, source_path, source_line, timestamp, event_type, payload_type, raw_json, source)
    VALUES (${sqlString(evid)}, ${sqlString(sourcePath)}, ${sqlNumber(line)},
    ${sqlString(parsed?.timestamp || null)}, ${sqlString(parsed?.type || null)},
    ${sqlString(parsed?.message?.role || null)}, ${sqlString(rawLine.slice(0, MAX_RAW))},
    ${sqlString(SOURCE)})`);
  return evid;
}

function insertTurn(batch, turnId, values = {}) {
  if (!turnId) return;
  batch.add(`INSERT INTO turns
    (turn_id, session_id, cwd, model, effort, agent_role, status, started_at, completed_at,
     duration_ms, time_to_first_token_ms, source_path, source_line, source)
    VALUES (${sqlString(turnId)}, ${sqlString(values.sessionId)}, ${sqlString(values.cwd)},
    ${sqlString(values.model)}, NULL, ${sqlString(values.agentRole)}, ${sqlString(values.status || "seen")},
    ${sqlString(values.startedAt)}, ${sqlString(values.completedAt)},
    ${sqlNumber(values.durationMs)}, ${sqlNumber(values.timeToFirstTokenMs)},
    ${sqlString(values.sourcePath)}, ${sqlNumber(values.sourceLine)}, ${sqlString(SOURCE)})
    ON CONFLICT(turn_id) DO UPDATE SET
      session_id = COALESCE(excluded.session_id, turns.session_id),
      cwd = COALESCE(excluded.cwd, turns.cwd),
      model = COALESCE(excluded.model, turns.model),
      status = COALESCE(excluded.status, turns.status),
      started_at = COALESCE(excluded.started_at, turns.started_at),
      completed_at = COALESCE(excluded.completed_at, turns.completed_at),
      duration_ms = COALESCE(excluded.duration_ms, turns.duration_ms),
      source = ${sqlString(SOURCE)}`);
}

function insertToolEvent(batch, values) {
  const key = stableId(values.evidenceId || "", values.callId || "", values.toolName, values.status || "");
  batch.add(`INSERT OR REPLACE INTO tool_events
    (event_key, turn_id, call_id, tool_name, command, status, exit_code, duration_ms,
     cwd, timestamp, evidence_id, output_summary, source)
    VALUES (${sqlString(key)}, ${sqlString(values.turnId)}, ${sqlString(values.callId)},
    ${sqlString(values.toolName)}, ${sqlString(values.command)}, ${sqlString(values.status)},
    ${sqlNumber(values.exitCode)}, ${sqlNumber(values.durationMs)}, ${sqlString(values.cwd)},
    ${sqlString(values.timestamp)}, ${sqlString(values.evidenceId)}, ${sqlString(values.outputSummary)},
    ${sqlString(SOURCE)})`);
}

function insertError(batch, values) {
  const key = stableId(values.evidenceId || "", values.turnId || "", values.category, values.message);
  batch.add(`INSERT OR REPLACE INTO errors
    (error_key, turn_id, skill_name, severity, category, message, timestamp,
     source_path, source_line, evidence_id, source)
    VALUES (${sqlString(key)}, ${sqlString(values.turnId)}, ${sqlString(values.skillName)},
    ${sqlString(values.severity)}, ${sqlString(values.category)}, ${sqlString(values.message)},
    ${sqlString(values.timestamp)}, ${sqlString(values.sourcePath)}, ${sqlNumber(values.sourceLine)},
    ${sqlString(values.evidenceId)}, ${sqlString(SOURCE)})`);
}

function insertTokenUsage(batch, values) {
  const key = stableId(values.evidenceId || "", values.turnId || "", "tokens");
  batch.add(`INSERT OR REPLACE INTO token_usage
    (event_key, turn_id, timestamp, input_tokens, cached_input_tokens, output_tokens,
     reasoning_output_tokens, total_tokens, primary_used_percent, secondary_used_percent,
     evidence_id, source)
    VALUES (${sqlString(key)}, ${sqlString(values.turnId)}, ${sqlString(values.timestamp)},
    ${sqlNumber(values.inputTokens)}, ${sqlNumber(values.cachedInputTokens)},
    ${sqlNumber(values.outputTokens)}, ${sqlNumber(values.reasoningOutputTokens)},
    ${sqlNumber(values.totalTokens)}, NULL, NULL, ${sqlString(values.evidenceId)}, ${sqlString(SOURCE)})`);
}

function insertSkillEvent(batch, skillName, values) {
  if (!skillName) return;
  const key = stableId(values.evidenceId || "", skillName, values.turnId || "", values.eventType, values.confidence);
  batch.add(`INSERT OR REPLACE INTO skill_events
    (event_key, skill_name, turn_id, event_type, confidence, timestamp, source_kind,
     source_path, source_line, evidence_id, notes, source)
    VALUES (${sqlString(key)}, ${sqlString(skillName)}, ${sqlString(values.turnId)},
    ${sqlString(values.eventType)}, ${sqlString(values.confidence)}, ${sqlString(values.timestamp)},
    ${sqlString(values.sourceKind)}, ${sqlString(values.sourcePath)}, ${sqlNumber(values.sourceLine)},
    ${sqlString(values.evidenceId)}, ${sqlString(values.notes)}, ${sqlString(SOURCE)})`);
}

function upsertSkill(batch, name, kind, descr) {
  batch.add(`INSERT OR IGNORE INTO skills
    (name, kind, path, description, description_hash, updated_at, source)
    VALUES (${sqlString(name)}, ${sqlString(kind)}, NULL, ${sqlString(descr || "")},
    ${sqlString(sha256(descr || ""))}, ${sqlString(nowIso())}, ${sqlString(SOURCE)})`);
}

function partText(part) {
  if (typeof part === "string") return part;
  if (part?.type === "text") return part.text || "";
  return "";
}

function importClaudeSession(batch, file) {
  const content = safeRead(file);
  if (!content) return { lines: 0 };
  insertSource(batch, file, "claude_session_jsonl", content);

  // Use sessionId as the turn key — Claude's "turn" granularity in the log is
  // a single message, but for analytics we aggregate per session like Codex.
  let sessionId = null;
  let cwd = null;
  let model = null;
  let startedAt = null;
  let completedAt = null;
  const toolCalls = new Map(); // toolUseID -> { name, input, evidenceId }
  let lineNum = 0;

  // Track the most recent "Skill" tool_result so the next user message
  // can be probed for a course-correction. We only consume the next user
  // turn after the skill returned — subsequent turns aren't directly
  // attributable to that skill.
  let pendingSkillCorrection = null;

  for (const rawLine of content.split(/\n/)) {
    if (!rawLine.trim()) continue;
    lineNum += 1;
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }

    const evidenceId = insertRaw(batch, file, lineNum, rawLine, parsed);
    const ts = parsed.timestamp || null;
    sessionId = parsed.sessionId || sessionId;
    cwd = parsed.cwd || cwd;
    if (ts) {
      if (!startedAt || ts < startedAt) startedAt = ts;
      if (!completedAt || ts > completedAt) completedAt = ts;
    }
    const msg = parsed.message || {};
    if (msg.model) model = msg.model;

    // If a Skill tool just returned, the next user message is the
    // course-correction probe. Scan it for pushback keywords, then
    // emit a "correction" or "no_correction" skill_event so the
    // dashboard can compute correction rates per skill.
    if (pendingSkillCorrection && parsed.type === "user") {
      const userText = (Array.isArray(msg.content) ? msg.content : [])
        .map((p) => (typeof p === "string" ? p : p?.type === "text" ? p.text || "" : ""))
        .join(" ")
        .trim();
      // Tool-result echoes also arrive as type=user; skip them — they have
      // a content array of tool_result blocks, not real user text.
      const isToolResultEcho =
        Array.isArray(msg.content) &&
        msg.content.some((p) => p && typeof p === "object" && p.type === "tool_result");
      // After a Skill returns, Claude Code injects the skill's loading
      // preamble (`Base directory for this skill: …`, `<command-name>…`,
      // `AUTO-GENERATED from SKILL.md`, etc.) into a synthetic user
      // message. These are not real user input and must not be probed for
      // corrections.
      const isSkillPreamble =
        /^Base directory for this skill:/i.test(userText) ||
        /AUTO-GENERATED from SKILL\.md/i.test(userText) ||
        /^<command-(name|message|args)/i.test(userText) ||
        userText.startsWith("<local-command-");
      if (userText && !isToolResultEcho && !isSkillPreamble) {
        const matches = userText.match(CORRECTION_RE);
        const eventType = matches ? "correction" : "no_correction";
        insertSkillEvent(batch, pendingSkillCorrection.skillName, {
          turnId: sessionId,
          eventType,
          confidence: "inferred",
          timestamp: ts,
          sourceKind: "post_skill_user_prompt",
          sourcePath: file,
          sourceLine: lineNum,
          evidenceId,
          notes: matches
            ? compactText(`matched=${matches[0]} prompt=${userText}`, 600)
            : compactText(userText, 600)
        });
        pendingSkillCorrection = null;
      }
    }

    // Token usage on assistant messages
    if (parsed.type === "assistant" && msg.usage && sessionId) {
      const u = msg.usage;
      const total = (u.input_tokens || 0) + (u.output_tokens || 0) + (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0);
      insertTokenUsage(batch, {
        turnId: sessionId,
        timestamp: ts,
        inputTokens: u.input_tokens,
        cachedInputTokens: (u.cache_read_input_tokens || 0) + (u.cache_creation_input_tokens || 0),
        outputTokens: u.output_tokens,
        reasoningOutputTokens: null,
        totalTokens: total,
        evidenceId
      });
    }

    // Walk message.content for tool_use / tool_result / Skill invocations
    const contentParts = Array.isArray(msg.content) ? msg.content : [];
    for (const part of contentParts) {
      if (!part || typeof part !== "object") continue;

      if (part.type === "tool_use") {
        const toolName = part.name || "tool";
        const inputJson = part.input ? JSON.stringify(part.input) : null;
        const skillName =
          toolName === "Skill" && part.input?.skill ? String(part.input.skill) : null;
        toolCalls.set(part.id, { toolName, input: inputJson, evidenceId, ts, skillName });
        insertToolEvent(batch, {
          turnId: sessionId,
          callId: part.id,
          toolName,
          command: inputJson,
          status: "called",
          timestamp: ts,
          evidenceId,
          cwd
        });

        // Claude's Skill tool invokes a named skill - capture as a skill event.
        if (toolName === "Skill" && part.input?.skill) {
          const skillName = String(part.input.skill);
          upsertSkill(batch, skillName, "claude_skill");
          insertSkillEvent(batch, skillName, {
            turnId: sessionId,
            eventType: "skill_invocation",
            confidence: "explicit",
            timestamp: ts,
            sourceKind: "tool_use",
            sourcePath: file,
            sourceLine: lineNum,
            evidenceId,
            notes: compactText(JSON.stringify(part.input))
          });
        }
        // Agent tool with subagent_type counts as a sub-agent invocation.
        if (toolName === "Agent" && part.input?.subagent_type) {
          const role = String(part.input.subagent_type);
          upsertSkill(batch, role, "claude_agent");
          insertSkillEvent(batch, role, {
            turnId: sessionId,
            eventType: "agent_invocation",
            confidence: "explicit",
            timestamp: ts,
            sourceKind: "tool_use",
            sourcePath: file,
            sourceLine: lineNum,
            evidenceId,
            notes: compactText(part.input.description || "")
          });
        }
      } else if (part.type === "tool_result") {
        const call = toolCalls.get(part.tool_use_id) || {};
        const isError = part.is_error === true;
        const text = Array.isArray(part.content) ? part.content.map(partText).join("\n") : (typeof part.content === "string" ? part.content : "");
        insertToolEvent(batch, {
          turnId: sessionId,
          callId: part.tool_use_id,
          toolName: call.toolName || "tool_result",
          status: isError ? "failed" : "completed",
          timestamp: ts,
          evidenceId,
          outputSummary: compactText(text)
        });
        // If this result closed a Skill tool, arm correction detection
        // for the next user message.
        if (call.toolName === "Skill" && call.skillName) {
          // If another Skill already had a pending probe (back-to-back
          // skills with no user input between), emit a synthetic
          // no_correction event for the previous one so it isn't lost
          // from the rollup.
          if (pendingSkillCorrection && pendingSkillCorrection.skillName !== call.skillName) {
            insertSkillEvent(batch, pendingSkillCorrection.skillName, {
              turnId: sessionId,
              eventType: "no_correction",
              confidence: "inferred",
              timestamp: ts,
              sourceKind: "back_to_back_skill_close",
              sourcePath: file,
              sourceLine: lineNum,
              evidenceId,
              notes: "next event was another Skill invocation, no user turn between",
            });
          }
          pendingSkillCorrection = {
            skillName: call.skillName,
            toolUseId: part.tool_use_id,
            evidenceId,
          };
        }
        if (isError) {
          insertError(batch, {
            turnId: sessionId,
            severity: "error",
            category: "tool_error",
            message: compactText(text) || "Tool returned is_error=true",
            timestamp: ts,
            sourcePath: file,
            sourceLine: lineNum,
            evidenceId
          });
        }
      }
    }
  }

  if (sessionId) {
    insertTurn(batch, sessionId, {
      sessionId,
      cwd,
      model,
      status: completedAt ? "completed" : "seen",
      startedAt,
      completedAt,
      durationMs:
        startedAt && completedAt ? Date.parse(completedAt) - Date.parse(startedAt) : null,
      sourcePath: file,
      sourceLine: 1
    });
  }

  return { lines: lineNum };
}

// Parse the YAML-style frontmatter at the top of a SKILL.md / agent .md.
// We only need name + description, so a tiny hand-rolled parser is fine.
function parseClaudeFrontmatter(text) {
  const out = { name: null, description: null };
  if (!text || !text.startsWith("---")) return out;
  const end = text.indexOf("\n---", 3);
  if (end < 0) return out;
  const block = text.slice(3, end);
  const nameMatch = block.match(/^name:\s*(.+?)\s*$/m);
  if (nameMatch) out.name = nameMatch[1].replace(/^["']|["']$/g, "");
  // description can be a single line or a "|" block; grab the first line either way.
  const descMatch = block.match(/^description:\s*(?:\|\s*\n\s*(.+?)|(.+?))\s*$/m);
  if (descMatch) out.description = (descMatch[1] || descMatch[2] || "").trim();
  return out;
}

// Scan ~/.claude/skills/<name>/SKILL.md and ~/.claude/agents/*.md for skills
// that exist on disk. The session-JSONL importer only learns about skills
// it sees mentioned in transcripts (and stores path=NULL), so anything the
// user wrote but hasn't invoked yet was invisible. Walking the filesystem
// fills that in and gives each row a real path, which is what the
// "user-authored" filter in metrics.js keys off of.
function scanClaudeSkillsFromDisk(batch) {
  const home = path.join(os.homedir(), ".claude");
  const skillsDir = path.join(home, "skills");
  const agentsDir = path.join(home, "agents");
  let found = 0;

  function upsertWithPath(name, kind, descr, fullPath) {
    // INSERT OR REPLACE so we overwrite the path-less row created by the
    // session importer when the same skill was also mentioned in a
    // transcript. Without REPLACE the path stays NULL forever.
    batch.add(`INSERT OR REPLACE INTO skills
      (name, kind, path, description, description_hash, updated_at, source)
      VALUES (${sqlString(name)}, ${sqlString(kind)}, ${sqlString(fullPath)},
      ${sqlString(descr || "")}, ${sqlString(sha256(descr || ""))},
      ${sqlString(nowIso())}, ${sqlString(SOURCE)})`);
    found++;
  }

  // Skills: each subdir holds a SKILL.md. The dirname is the skill name.
  // Many entries in ~/.claude/skills/ are symlinks into ~/.claude/skills/gstack/<name>,
  // so we resolve symlinks (statSync follows them) and store the resolved
  // path. The metrics.js user-authored filter then excludes anything that
  // resolves into a /gstack/ subtree without us having to special-case it.
  if (fs.existsSync(skillsDir)) {
    for (const name of fs.readdirSync(skillsDir)) {
      const entryPath = path.join(skillsDir, name);
      let isDir = false;
      try {
        isDir = fs.statSync(entryPath).isDirectory();
      } catch {
        continue;
      }
      if (!isDir) continue;
      const skillFile = path.join(entryPath, "SKILL.md");
      if (!fs.existsSync(skillFile)) continue;
      let resolved = skillFile;
      try {
        resolved = fs.realpathSync(skillFile);
      } catch {
        // keep skillFile as-is
      }
      const parsed = parseClaudeFrontmatter(safeRead(resolved));
      upsertWithPath(parsed.name || name, "claude_skill", parsed.description, resolved);
    }
  }

  // Agents: flat .md files. The filename (sans .md) is the agent name.
  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".md")) continue;
      const full = path.join(agentsDir, file);
      const parsed = parseClaudeFrontmatter(safeRead(full));
      const name = parsed.name || file.replace(/\.md$/, "");
      upsertWithPath(name, "claude_agent", parsed.description, full);
    }
  }

  return found;
}

export function importClaude() {
  const projects = listClaudeProjects();
  const batch = new SqlBatch();
  let totalFiles = 0;
  let totalLines = 0;
  for (const proj of projects) {
    const projRoot = path.join(os.homedir(), ".claude", "projects", proj);
    const files = walkSessionFiles(projRoot);
    totalFiles += files.length;
    for (const file of files) {
      totalLines += importClaudeSession(batch, file).lines;
    }
  }
  // Filesystem scan runs after the session sweep so on-disk rows
  // overwrite the path-less placeholders created by JSONL mentions.
  const skillsFound = scanClaudeSkillsFromDisk(batch);
  batch.flush();
  return {
    source: "claude",
    projects: projects.length,
    sessionFiles: totalFiles,
    sessionLines: totalLines,
    skillsOnDisk: skillsFound
  };
}
