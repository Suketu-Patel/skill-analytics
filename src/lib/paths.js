import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const libDir = path.dirname(fileURLToPath(import.meta.url));

export function appRoot() {
  return process.env.SKILL_ANALYTICS_APP_ROOT || path.resolve(libDir, "../..");
}

export function projectRoot() {
  return process.env.SKILL_ANALYTICS_PROJECT_ROOT || path.resolve(appRoot(), "../..");
}

export function codexHome() {
  return process.env.CODEX_HOME || path.join(os.homedir(), ".codex");
}

export function dataDir() {
  return process.env.SKILL_ANALYTICS_DATA_DIR || path.join(appRoot(), "data");
}

export function dbPath() {
  return process.env.SKILL_ANALYTICS_DB || path.join(dataDir(), "skill-analytics.sqlite");
}

export function explicitEventLogPath() {
  return (
    process.env.SKILL_ANALYTICS_EVENT_LOG ||
    path.join(codexHome(), "skill-analytics", "events.jsonl")
  );
}
