import fs from "node:fs";
import path from "node:path";
import {
  SqlBatch,
  execSql,
  initDb,
  sha256,
  sqlBool,
  sqlNumber,
  sqlString
} from "./sqlite.js";
import { codexHome, explicitEventLogPath, projectRoot } from "./paths.js";
import { importClaude } from "./claude-importer.js";
import { importCursor } from "./cursor-importer.js";

const MAX_TEXT = 900;
// Cap for the raw JSONL line stored on `raw_events.raw_json`. The evidence modal
// re-parses this to show the un-truncated command/output, so it needs headroom
// for long stack traces and aggregated tool output.
const MAX_RAW_JSON = 200000;
const SKIP_DIRS = new Set([
  ".git",
  "node_modules",
  "sessions",
  "shell_snapshots",
  "log",
  "browser",
  "vendor_imports"
]);

function nowIso() {
  return new Date().toISOString();
}

function safeRead(file) {
  try {
    return fs.readFileSync(file, "utf8");
  } catch {
    return "";
  }
}

function stableEventId(sourcePath, lineNumber, rawLine) {
  return sha256(`${sourcePath}:${lineNumber}:${rawLine}`);
}

function compactText(value, length = MAX_TEXT) {
  if (value === null || value === undefined) return "";
  return String(value).replace(/\s+/g, " ").trim().slice(0, length);
}

function toIsoFromSeconds(value) {
  if (!value) return null;
  return new Date(Number(value) * 1000).toISOString();
}

function getTextFromContent(content) {
  if (!Array.isArray(content)) return "";
  return content
    .map((part) => {
      if (typeof part === "string") return part;
      return part?.text || part?.input_text || part?.output_text || "";
    })
    .join("\n");
}

function parseFrontmatter(md) {
  const match = md.match(/^---\n([\s\S]*?)\n---/);
  const frontmatter = match?.[1] || "";
  return {
    name: frontmatter.match(/^name:\s*(.+)$/m)?.[1]?.trim(),
    description: frontmatter.match(/^description:\s*(.+)$/m)?.[1]?.trim()
  };
}

function parseTomlRole(text, fallbackName) {
  return {
    name: text.match(/^name\s*=\s*"([^"]+)"/m)?.[1] || fallbackName,
    description: text.match(/^description\s*=\s*"([^"]*)"/m)?.[1] || ""
  };
}

function walkFiles(root, predicate, results = [], depth = 0) {
  if (!fs.existsSync(root) || depth > 10) return results;
  for (const entry of fs.readdirSync(root, { withFileTypes: true })) {
    const full = path.join(root, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name) && !full.includes(path.join("plugins", "cache"))) continue;
      walkFiles(full, predicate, results, depth + 1);
    } else if (predicate(full)) {
      results.push(full);
    }
  }
  return results;
}

export function loadSkillRegistry() {
  const found = new Map();
  const root = projectRoot();
  const agentsDir = path.join(root, ".codex", "agents");

  if (fs.existsSync(agentsDir)) {
    for (const file of fs.readdirSync(agentsDir)) {
      if (!file.endsWith(".toml")) continue;
      const full = path.join(agentsDir, file);
      const parsed = parseTomlRole(safeRead(full), path.basename(file, ".toml"));
      found.set(parsed.name, {
        name: parsed.name,
        kind: "agent",
        path: full,
        description: parsed.description || "Codex agent role"
      });
    }
  }

  const home = codexHome();
  const skillFiles = [
    ...walkFiles(path.join(home, "skills"), (file) => path.basename(file) === "SKILL.md"),
    ...walkFiles(path.join(home, "plugins"), (file) => path.basename(file) === "SKILL.md")
  ];

  for (const full of skillFiles) {
    const text = safeRead(full);
    const parsed = parseFrontmatter(text);
    const fallback = path.basename(path.dirname(full));
    const name = parsed.name || fallback;
    found.set(name, {
      name,
      kind: full.includes(`${path.sep}plugins${path.sep}`) ? "plugin_skill" : "skill",
      path: full,
      description: parsed.description || ""
    });
  }

  return [...found.values()].sort((a, b) => b.name.length - a.name.length);
}

function upsertSkillStatements(skills) {
  const at = nowIso();
  return skills.map((skill) => {
    const descHash = sha256(skill.description || "");
    return `INSERT OR REPLACE INTO skills
      (name, kind, path, description, description_hash, updated_at, source)
      VALUES (${sqlString(skill.name)}, ${sqlString(skill.kind)}, ${sqlString(skill.path)},
      ${sqlString(skill.description)}, ${sqlString(descHash)}, ${sqlString(at)}, 'codex')`;
  });
}

function insertSource(batch, sourcePath, kind, content) {
  let stat = { mtimeMs: null, size: null };
  try {
    stat = fs.statSync(sourcePath);
  } catch {
    // keep nullable stat fields
  }
  batch.add(`INSERT OR REPLACE INTO sources
    (path, kind, mtime_ms, size, content_hash, imported_at)
    VALUES (${sqlString(sourcePath)}, ${sqlString(kind)}, ${sqlNumber(stat.mtimeMs)},
    ${sqlNumber(stat.size)}, ${sqlString(sha256(content))}, ${sqlString(nowIso())})`);
}

function insertRawEvent(batch, sourcePath, lineNumber, rawLine, parsed) {
  const payload = parsed?.payload || {};
  const eventId = stableEventId(sourcePath, lineNumber, rawLine);
  batch.add(`INSERT OR REPLACE INTO raw_events
    (event_id, source_path, source_line, timestamp, event_type, payload_type, raw_json)
    VALUES (${sqlString(eventId)}, ${sqlString(sourcePath)}, ${sqlNumber(lineNumber)},
    ${sqlString(parsed?.timestamp || null)}, ${sqlString(parsed?.type || null)},
    ${sqlString(payload?.type || null)}, ${sqlString(rawLine.slice(0, MAX_RAW_JSON))})`);
  return eventId;
}

function resetImportedData() {
  execSql(`
DELETE FROM token_usage;
DELETE FROM errors;
DELETE FROM tool_events;
DELETE FROM skill_events;
DELETE FROM raw_events;
DELETE FROM turns;
DELETE FROM skills;
DELETE FROM sources;
`);
}

function insertTurn(batch, turnId, values = {}) {
  if (!turnId) return;
  batch.add(`INSERT INTO turns
    (turn_id, session_id, cwd, model, effort, agent_role, status, started_at, completed_at,
     duration_ms, time_to_first_token_ms, source_path, source_line)
    VALUES (${sqlString(turnId)}, ${sqlString(values.sessionId)}, ${sqlString(values.cwd)},
    ${sqlString(values.model)}, ${sqlString(values.effort)}, ${sqlString(values.agentRole)},
    ${sqlString(values.status || "seen")}, ${sqlString(values.startedAt)},
    ${sqlString(values.completedAt)}, ${sqlNumber(values.durationMs)},
    ${sqlNumber(values.timeToFirstTokenMs)}, ${sqlString(values.sourcePath)},
    ${sqlNumber(values.sourceLine)})
    ON CONFLICT(turn_id) DO UPDATE SET
      session_id = COALESCE(excluded.session_id, turns.session_id),
      cwd = COALESCE(excluded.cwd, turns.cwd),
      model = COALESCE(excluded.model, turns.model),
      effort = COALESCE(excluded.effort, turns.effort),
      agent_role = COALESCE(excluded.agent_role, turns.agent_role),
      status = COALESCE(excluded.status, turns.status),
      started_at = COALESCE(excluded.started_at, turns.started_at),
      completed_at = COALESCE(excluded.completed_at, turns.completed_at),
      duration_ms = COALESCE(excluded.duration_ms, turns.duration_ms),
      time_to_first_token_ms = COALESCE(excluded.time_to_first_token_ms, turns.time_to_first_token_ms),
      source_path = COALESCE(excluded.source_path, turns.source_path),
      source_line = COALESCE(excluded.source_line, turns.source_line)`);
}

function insertSkillEvent(batch, skillName, values) {
  if (!skillName) return;
  const key = sha256(
    `${values.evidenceId || ""}:${skillName}:${values.turnId || ""}:${values.eventType}:${values.confidence}`
  );
  batch.add(`INSERT OR REPLACE INTO skill_events
    (event_key, skill_name, turn_id, event_type, confidence, timestamp, source_kind,
     source_path, source_line, evidence_id, notes)
    VALUES (${sqlString(key)}, ${sqlString(skillName)}, ${sqlString(values.turnId)},
    ${sqlString(values.eventType)}, ${sqlString(values.confidence)}, ${sqlString(values.timestamp)},
    ${sqlString(values.sourceKind)}, ${sqlString(values.sourcePath)}, ${sqlNumber(values.sourceLine)},
    ${sqlString(values.evidenceId)}, ${sqlString(values.notes)})`);
}

function insertToolEvent(batch, values) {
  const key = sha256(
    `${values.evidenceId || ""}:${values.callId || ""}:${values.toolName}:${values.status || ""}`
  );
  batch.add(`INSERT OR REPLACE INTO tool_events
    (event_key, turn_id, call_id, tool_name, command, status, exit_code, duration_ms,
     cwd, timestamp, evidence_id, output_summary)
    VALUES (${sqlString(key)}, ${sqlString(values.turnId)}, ${sqlString(values.callId)},
    ${sqlString(values.toolName)}, ${sqlString(values.command)}, ${sqlString(values.status)},
    ${sqlNumber(values.exitCode)}, ${sqlNumber(values.durationMs)}, ${sqlString(values.cwd)},
    ${sqlString(values.timestamp)}, ${sqlString(values.evidenceId)}, ${sqlString(values.outputSummary)})`);
}

function insertError(batch, values) {
  const key = sha256(
    `${values.evidenceId || ""}:${values.turnId || ""}:${values.category}:${values.message}`
  );
  batch.add(`INSERT OR REPLACE INTO errors
    (error_key, turn_id, skill_name, severity, category, message, timestamp,
     source_path, source_line, evidence_id)
    VALUES (${sqlString(key)}, ${sqlString(values.turnId)}, ${sqlString(values.skillName)},
    ${sqlString(values.severity)}, ${sqlString(values.category)}, ${sqlString(values.message)},
    ${sqlString(values.timestamp)}, ${sqlString(values.sourcePath)}, ${sqlNumber(values.sourceLine)},
    ${sqlString(values.evidenceId)})`);
}

function insertTokenUsage(batch, values) {
  const key = sha256(`${values.evidenceId || ""}:${values.turnId || ""}:tokens`);
  batch.add(`INSERT OR REPLACE INTO token_usage
    (event_key, turn_id, timestamp, input_tokens, cached_input_tokens, output_tokens,
     reasoning_output_tokens, total_tokens, primary_used_percent, secondary_used_percent, evidence_id)
    VALUES (${sqlString(key)}, ${sqlString(values.turnId)}, ${sqlString(values.timestamp)},
    ${sqlNumber(values.inputTokens)}, ${sqlNumber(values.cachedInputTokens)},
    ${sqlNumber(values.outputTokens)}, ${sqlNumber(values.reasoningOutputTokens)},
    ${sqlNumber(values.totalTokens)}, ${sqlNumber(values.primaryUsedPercent)},
    ${sqlNumber(values.secondaryUsedPercent)}, ${sqlString(values.evidenceId)})`);
}

function mentionedSkills(text, skills) {
  if (!text || !skills.length) return [];
  const normalized = text.toLowerCase();
  const hits = [];
  for (const skill of skills) {
    const name = skill.name.toLowerCase();
    if (normalized.includes(name)) hits.push(skill.name);
  }
  return [...new Set(hits)];
}

function skillFromPath(sourcePath, skills) {
  const normalized = sourcePath || "";
  const byPath = skills.find((skill) => skill.path && normalized.includes(skill.path));
  if (byPath) return byPath.name;
  const agentMatch = normalized.match(/\.codex\/agents\/([^/]+)\.toml/);
  if (agentMatch) return agentMatch[1];
  const skillMatch = normalized.match(/\.codex\/skills\/([^/]+)\//);
  if (skillMatch) return skillMatch[1];
  const pluginSkillMatch = normalized.match(/\/skills\/([^/]+)\/SKILL\.md/);
  if (pluginSkillMatch) return pluginSkillMatch[1];
  return null;
}

function commandSummary(payload) {
  if (Array.isArray(payload.command)) return payload.command.join(" ");
  if (payload.command) return String(payload.command);
  if (payload.parsed_cmd?.[0]?.cmd) return payload.parsed_cmd[0].cmd;
  return null;
}

function importSessionFile(batch, file, skills) {
  const content = safeRead(file);
  if (!content) return { lines: 0 };
  insertSource(batch, file, "session_jsonl", content);

  const calls = new Map();
  let currentTurnId = null;
  let sessionId = null;
  let sessionMeta = {};
  let lines = 0;

  for (const rawLine of content.split(/\n/)) {
    if (!rawLine.trim()) continue;
    lines += 1;
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      const evidenceId = stableEventId(file, lines, rawLine);
      insertError(batch, {
        severity: "error",
        category: "json_parse",
        message: "Malformed JSONL line",
        timestamp: null,
        sourcePath: file,
        sourceLine: lines,
        evidenceId
      });
      continue;
    }

    const payload = parsed.payload || {};
    const eventId = stableEventId(file, lines, rawLine);
    let rawInserted = false;
    const ensureRaw = () => {
      if (!rawInserted) {
        insertRawEvent(batch, file, lines, rawLine, parsed);
        rawInserted = true;
      }
      return eventId;
    };
    const payloadType = payload.type;

    if (parsed.type === "session_meta") {
      sessionId = payload.id || sessionId;
      sessionMeta = payload;
      // agent_role can live at the top level OR nested under source.subagent.thread_spawn / .other
      const subagent = payload.source?.subagent || {};
      const nestedRole =
        subagent.thread_spawn?.agent_role ||
        subagent.other ||
        (typeof subagent === "string" ? subagent : null);
      const resolvedRole = payload.agent_role || nestedRole;
      if (resolvedRole) sessionMeta.agent_role = resolvedRole;
      if (resolvedRole && skills.some((skill) => skill.name === resolvedRole)) {
        insertSkillEvent(batch, resolvedRole, {
          eventType: "agent_session",
          confidence: "explicit",
          timestamp: parsed.timestamp,
          sourceKind: "session_meta",
          sourcePath: file,
          sourceLine: lines,
          evidenceId: ensureRaw(),
          notes: payload.agent_nickname ? `Agent nickname: ${payload.agent_nickname}` : null
        });
      }
      continue;
    }

    if (parsed.type === "turn_context") {
      currentTurnId = payload.turn_id || currentTurnId;
      insertTurn(batch, currentTurnId, {
        sessionId,
        cwd: payload.cwd,
        model: payload.model,
        effort: payload.effort,
        agentRole: sessionMeta.agent_role,
        sourcePath: file,
        sourceLine: lines
      });
      continue;
    }

    if (parsed.type === "event_msg" && payloadType === "task_started") {
      currentTurnId = payload.turn_id || currentTurnId;
      insertTurn(batch, currentTurnId, {
        sessionId,
        agentRole: sessionMeta.agent_role,
        status: "started",
        startedAt: toIsoFromSeconds(payload.started_at),
        sourcePath: file,
        sourceLine: lines
      });
      continue;
    }

    if (parsed.type === "event_msg" && payloadType === "task_complete") {
      currentTurnId = payload.turn_id || currentTurnId;
      insertTurn(batch, currentTurnId, {
        sessionId,
        agentRole: sessionMeta.agent_role,
        status: "completed",
        completedAt: toIsoFromSeconds(payload.completed_at),
        durationMs: payload.duration_ms,
        timeToFirstTokenMs: payload.time_to_first_token_ms,
        sourcePath: file,
        sourceLine: lines
      });
      if (payload.last_agent_message) {
        for (const name of mentionedSkills(payload.last_agent_message, skills)) {
          insertSkillEvent(batch, name, {
            turnId: currentTurnId,
            eventType: "mentioned",
            confidence: "mentioned",
            timestamp: parsed.timestamp,
            sourceKind: "task_complete",
            sourcePath: file,
            sourceLine: lines,
            evidenceId: ensureRaw(),
            notes: compactText(payload.last_agent_message)
          });
        }
      }
      continue;
    }

    if (parsed.type === "event_msg" && payloadType === "token_count") {
      const usage = payload.info?.last_token_usage || payload.info?.total_token_usage;
      if (usage && currentTurnId) {
        insertTokenUsage(batch, {
          turnId: currentTurnId,
          timestamp: parsed.timestamp,
          inputTokens: usage.input_tokens,
          cachedInputTokens: usage.cached_input_tokens,
          outputTokens: usage.output_tokens,
          reasoningOutputTokens: usage.reasoning_output_tokens,
          totalTokens: usage.total_tokens,
          primaryUsedPercent: payload.rate_limits?.primary?.used_percent,
          secondaryUsedPercent: payload.rate_limits?.secondary?.used_percent,
          evidenceId: ensureRaw()
        });
      }
      continue;
    }

    if (parsed.type === "event_msg" && payloadType === "error") {
      insertError(batch, {
        turnId: currentTurnId,
        severity: "error",
        category: payload.codex_error_info || "codex_error",
        message: compactText(payload.message),
        timestamp: parsed.timestamp,
        sourcePath: file,
        sourceLine: lines,
        evidenceId: ensureRaw()
      });
      continue;
    }

    if (parsed.type === "event_msg" && payloadType === "exec_command_end") {
      const exitCode = payload.exit_code;
      const failed = exitCode !== 0 && exitCode !== null && exitCode !== undefined;
      const summary = compactText(payload.aggregated_output || payload.stderr || payload.stdout);
      insertToolEvent(batch, {
        turnId: payload.turn_id || currentTurnId,
        callId: payload.call_id,
        toolName: "exec_command",
        command: commandSummary(payload),
        status: failed ? "failed" : "completed",
        exitCode,
        durationMs: payload.duration?.secs ? Number(payload.duration.secs) * 1000 : null,
        cwd: payload.cwd,
        timestamp: parsed.timestamp,
        evidenceId: ensureRaw(),
        outputSummary: summary
      });
      if (failed) {
        insertError(batch, {
          turnId: payload.turn_id || currentTurnId,
          severity: "error",
          category: "command_failure",
          message: summary || `Command exited with ${exitCode}`,
          timestamp: parsed.timestamp,
          sourcePath: file,
          sourceLine: lines,
          evidenceId: ensureRaw()
        });
      }
      continue;
    }

    if (parsed.type === "event_msg" && payloadType === "patch_apply_end") {
      insertToolEvent(batch, {
        turnId: payload.turn_id || currentTurnId,
        callId: payload.call_id,
        toolName: "apply_patch",
        status: payload.success ? "completed" : "failed",
        exitCode: payload.success ? 0 : 1,
        timestamp: parsed.timestamp,
        evidenceId: ensureRaw(),
        outputSummary: compactText(payload.stdout || payload.stderr)
      });
      if (!payload.success) {
        insertError(batch, {
          turnId: payload.turn_id || currentTurnId,
          severity: "error",
          category: "patch_failure",
          message: compactText(payload.stderr || payload.stdout || "apply_patch failed"),
          timestamp: parsed.timestamp,
          sourcePath: file,
          sourceLine: lines,
          evidenceId: ensureRaw()
        });
      }
      continue;
    }

    if (parsed.type === "response_item" && payload.type === "function_call") {
      calls.set(payload.call_id, {
        toolName: payload.name || payload.namespace || "tool",
        turnId: currentTurnId,
        arguments: payload.arguments
      });
      insertToolEvent(batch, {
        turnId: currentTurnId,
        callId: payload.call_id,
        toolName: payload.name || payload.namespace || "tool",
        command: payload.arguments,
        status: "called",
        timestamp: parsed.timestamp,
        evidenceId: ensureRaw()
      });
      // Sub-agent invocations carry the role name inside arguments JSON, not in chat text.
      // Match the role explicitly so custom agents (e.g. animation-effects-discovery) are captured.
      const argsText = typeof payload.arguments === "string" ? payload.arguments : JSON.stringify(payload.arguments || "");
      const toolName = payload.name || payload.namespace || "";
      const isAgentInvocation = /agent|task|subagent/i.test(toolName);
      if (argsText) {
        let roleMatch = null;
        try {
          const argsJson = typeof payload.arguments === "string" ? JSON.parse(payload.arguments) : payload.arguments;
          roleMatch = argsJson?.agent_role || argsJson?.role || argsJson?.subagent_type || argsJson?.agent || null;
        } catch {
          // arguments may be partial / non-JSON; fall back to substring scan
        }
        if (roleMatch && skills.some((skill) => skill.name === roleMatch)) {
          insertSkillEvent(batch, roleMatch, {
            turnId: currentTurnId,
            eventType: isAgentInvocation ? "agent_invocation" : "tool_argument",
            confidence: "explicit",
            timestamp: parsed.timestamp,
            sourceKind: "function_call_args",
            sourcePath: file,
            sourceLine: lines,
            evidenceId: ensureRaw(),
            notes: compactText(argsText)
          });
        } else {
          // Fall back to substring mention scan against the registry
          for (const name of mentionedSkills(argsText, skills)) {
            insertSkillEvent(batch, name, {
              turnId: currentTurnId,
              eventType: "mentioned",
              confidence: "mentioned",
              timestamp: parsed.timestamp,
              sourceKind: "function_call_args",
              sourcePath: file,
              sourceLine: lines,
              evidenceId: ensureRaw(),
              notes: compactText(argsText)
            });
          }
        }
      }
      continue;
    }

    if (parsed.type === "response_item" && payload.type === "custom_tool_call") {
      calls.set(payload.call_id, { toolName: payload.name || "custom_tool", turnId: currentTurnId });
      insertToolEvent(batch, {
        turnId: currentTurnId,
        callId: payload.call_id,
        toolName: payload.name || "custom_tool",
        command: compactText(payload.input),
        status: payload.status || "called",
        timestamp: parsed.timestamp,
        evidenceId: ensureRaw()
      });
      continue;
    }

    if (
      parsed.type === "response_item" &&
      (payload.type === "function_call_output" || payload.type === "custom_tool_call_output")
    ) {
      const call = calls.get(payload.call_id) || {};
      insertToolEvent(batch, {
        turnId: call.turnId || currentTurnId,
        callId: payload.call_id,
        toolName: call.toolName || "tool_output",
        status: "output",
        timestamp: parsed.timestamp,
        evidenceId: ensureRaw(),
        outputSummary: compactText(payload.output)
      });
      // Scan tool output for skill mentions too — sub-agent results often reference the calling role
      const outText = typeof payload.output === "string" ? payload.output : JSON.stringify(payload.output || "");
      if (outText) {
        for (const name of mentionedSkills(outText, skills)) {
          insertSkillEvent(batch, name, {
            turnId: call.turnId || currentTurnId,
            eventType: "mentioned",
            confidence: "mentioned",
            timestamp: parsed.timestamp,
            sourceKind: "function_call_output",
            sourcePath: file,
            sourceLine: lines,
            evidenceId: ensureRaw(),
            notes: compactText(outText)
          });
        }
      }
      continue;
    }

    if (parsed.type === "event_msg" && ["agent_message", "user_message"].includes(payloadType)) {
      const text = payload.message || "";
      for (const name of mentionedSkills(text, skills)) {
        insertSkillEvent(batch, name, {
          turnId: payload.turn_id || currentTurnId,
          eventType: "mentioned",
          confidence: "mentioned",
          timestamp: parsed.timestamp,
          sourceKind: payloadType,
          sourcePath: file,
          sourceLine: lines,
          evidenceId: ensureRaw(),
          notes: compactText(text)
        });
      }
      continue;
    }

    if (parsed.type === "response_item" && payload.type === "message") {
      const role = payload.role;
      if (role === "assistant" || role === "user") {
        const text = getTextFromContent(payload.content);
        for (const name of mentionedSkills(text, skills)) {
          insertSkillEvent(batch, name, {
            turnId: currentTurnId,
            eventType: "mentioned",
            confidence: "mentioned",
            timestamp: parsed.timestamp,
            sourceKind: `${role}_message`,
            sourcePath: file,
            sourceLine: lines,
            evidenceId: ensureRaw(),
            notes: compactText(text)
          });
        }
      }
    }
  }

  return { lines };
}

function importTuiLog(batch, file, skills) {
  const content = safeRead(file);
  if (!content) return { lines: 0 };
  insertSource(batch, file, "codex_tui_log", content);
  let lines = 0;

  for (const rawLine of content.split(/\n/)) {
    if (!rawLine.trim()) continue;
    lines += 1;
    const eventId = stableEventId(file, lines, rawLine);
    const match = rawLine.match(/^(\S+)\s+(WARN|ERROR)\s+(.+)$/);
    if (!match) continue;
    const [, timestamp, level, body] = match;
    const matchedSkill = skillFromPath(body, skills);
    const category = body.includes("malformed agent role")
      ? "malformed_agent_role"
      : body.includes("codex_core_skills::loader")
        ? "skill_loader_warning"
        : body.includes("codex_core_plugins::manifest")
          ? "plugin_manifest_warning"
          : "codex_log_warning";
    batch.add(`INSERT OR REPLACE INTO raw_events
      (event_id, source_path, source_line, timestamp, event_type, payload_type, raw_json)
      VALUES (${sqlString(eventId)}, ${sqlString(file)}, ${sqlNumber(lines)},
      ${sqlString(timestamp)}, ${sqlString("codex_tui_log")}, ${sqlString(category)},
      ${sqlString(rawLine)})`);
    insertError(batch, {
      skillName: matchedSkill,
      severity: level.toLowerCase(),
      category,
      message: compactText(body),
      timestamp,
      sourcePath: file,
      sourceLine: lines,
      evidenceId: eventId
    });
  }

  return { lines };
}

function importExplicitEvents(batch, file, skills) {
  const content = safeRead(file);
  if (!content) return { lines: 0 };
  insertSource(batch, file, "explicit_skill_events", content);
  let lines = 0;

  for (const rawLine of content.split(/\n/)) {
    if (!rawLine.trim()) continue;
    lines += 1;
    let parsed;
    try {
      parsed = JSON.parse(rawLine);
    } catch {
      continue;
    }
    const eventId = stableEventId(file, lines, rawLine);
    batch.add(`INSERT OR REPLACE INTO raw_events
      (event_id, source_path, source_line, timestamp, event_type, payload_type, raw_json)
      VALUES (${sqlString(eventId)}, ${sqlString(file)}, ${sqlNumber(lines)},
      ${sqlString(parsed.timestamp || null)}, ${sqlString("explicit_skill_event")},
      ${sqlString(parsed.event_type || parsed.eventType || parsed.status || "event")},
      ${sqlString(rawLine)})`);
    const name = parsed.skill || parsed.skill_name || parsed.name;
    if (!name) continue;
    if (!skills.some((skill) => skill.name === name)) {
      batch.add(`INSERT OR IGNORE INTO skills
        (name, kind, path, description, description_hash, updated_at)
        VALUES (${sqlString(name)}, 'unknown', NULL, NULL, NULL, ${sqlString(nowIso())})`);
    }
    insertSkillEvent(batch, name, {
      turnId: parsed.turn_id || parsed.turnId,
      eventType: parsed.event_type || parsed.eventType || parsed.status || "explicit_event",
      confidence: "explicit",
      timestamp: parsed.timestamp || nowIso(),
      sourceKind: "explicit_event_log",
      sourcePath: file,
      sourceLine: lines,
      evidenceId: eventId,
      notes: parsed.notes || parsed.message || null
    });
    if ((parsed.status || parsed.event_type || "").toLowerCase() === "error") {
      insertError(batch, {
        turnId: parsed.turn_id || parsed.turnId,
        skillName: name,
        severity: "error",
        category: parsed.category || "explicit_skill_error",
        message: compactText(parsed.error || parsed.notes || parsed.message || "Explicit skill error"),
        timestamp: parsed.timestamp || nowIso(),
        sourcePath: file,
        sourceLine: lines,
        evidenceId: eventId
      });
    }
  }

  return { lines };
}

export function importAll(options = {}) {
  initDb();
  resetImportedData();
  const batch = new SqlBatch();
  const skills = loadSkillRegistry();

  for (const statement of upsertSkillStatements(skills)) batch.add(statement);

  const home = codexHome();
  const sessionsRoot = options.sessionsRoot || path.join(home, "sessions");
  const tuiLog = options.tuiLog || path.join(home, "log", "codex-tui.log");
  const explicitLog = options.explicitEventLog || explicitEventLogPath();
  const sessionFiles = walkFiles(sessionsRoot, (file) => file.endsWith(".jsonl"));

  let sessionLineCount = 0;
  for (const file of sessionFiles) {
    sessionLineCount += importSessionFile(batch, file, skills).lines;
  }
  const tuiLines = importTuiLog(batch, tuiLog, skills).lines;
  const explicitLines = importExplicitEvents(batch, explicitLog, skills).lines;

  batch.flush();

  // Claude data lives in ~/.claude/projects/**/*.jsonl. It uses its own batch
  // (so failures in either source don't block the other).
  let claudeResult = null;
  try {
    claudeResult = importClaude();
  } catch (err) {
    claudeResult = { error: String(err?.message || err) };
  }

  // Cursor data lives in ~/Library/Application Support/Cursor/User/globalStorage/state.vscdb.
  let cursorResult = null;
  try {
    cursorResult = importCursor();
  } catch (err) {
    cursorResult = { error: String(err?.message || err) };
  }

  execSql("VACUUM;");

  return {
    codex: {
      skills: skills.length,
      sessionFiles: sessionFiles.length,
      sessionLines: sessionLineCount,
      tuiLogImported: fs.existsSync(tuiLog),
      tuiLines,
      explicitLogImported: fs.existsSync(explicitLog),
      explicitLines
    },
    claude: claudeResult,
    cursor: cursorResult,
    dbReady: true
  };
}

export function appendExplicitSkillEvent(event) {
  const file = explicitEventLogPath();
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const record = {
    timestamp: event.timestamp || nowIso(),
    skill: event.skill,
    event_type: event.eventType || event.event_type || "event",
    turn_id: event.turnId || event.turn_id || null,
    notes: event.notes || null,
    category: event.category || null,
    error: event.error || null
  };
  fs.appendFileSync(file, `${JSON.stringify(record)}\n`);
  return { file, record };
}
