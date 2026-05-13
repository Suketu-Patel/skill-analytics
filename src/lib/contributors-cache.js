// Contributors snapshot cache.
//
// The first version of /api/contributors spawned `git shortlog` + `gh pr
// list` on every modal open, which took 1–3 seconds (the `gh` call
// alone dominates because it round-trips to GitHub). Both inputs only
// change when a new commit lands or a new PR opens, so we compute once
// per sync and serve from SQLite on read — instant after the first run.
//
// Storage: same `summaries` table the wrapped + metric caches use, under
// kind `contributors_snapshot`, single canonical row keyed "latest".

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { SqlBatch, initDb, queryRows, sha256, sqlString } from "./sqlite.js";
import fs from "node:fs";
import path from "node:path";

const exec = promisify(execFile);
const KIND = "contributors_snapshot";
const SNAPSHOT_KEY = sha256("contributors:latest:v1");

// Identity check — only the skill-analytics dashboard repo is allowed
// as a source. Same gating as the /api/contributors route.
const DASHBOARD_PACKAGE_NAME = "skill-analytics";

function isDashboardRepo(candidate) {
  if (!candidate) return false;
  if (!fs.existsSync(path.join(candidate, ".git"))) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
    return pkg?.name === DASHBOARD_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function findDashboardRepo(start) {
  const env = process.env.SKILL_ANALYTICS_GIT_DIR;
  if (env && isDashboardRepo(env)) return env;

  let dir = start;
  for (let i = 0; i < 10; i++) {
    if (isDashboardRepo(dir)) return dir;
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }

  const home = process.env.HOME || "";
  const fallbacks = [
    path.resolve(start, "../skill-analytics"),
    path.resolve(start, "../../skill-analytics"),
    home && path.join(home, "Desktop", "skill-analytics"),
  ].filter(Boolean);
  for (const candidate of fallbacks) {
    if (isDashboardRepo(candidate)) return candidate;
  }
  return null;
}

async function readLocalCommits(root) {
  const { stdout } = await exec(
    "git",
    ["shortlog", "-sn", "--no-merges", "--all"],
    { cwd: root, maxBuffer: 4 * 1024 * 1024 }
  );
  return stdout
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const m = line.match(/^(\d+)\s+(.+)$/);
      if (!m) return null;
      return { name: m[2].trim(), commits: Number(m[1]) };
    })
    .filter(Boolean);
}

async function readPrAuthors(root) {
  try {
    const { stdout } = await exec(
      "gh",
      ["pr", "list", "--state", "all", "--limit", "500", "--json", "author"],
      { cwd: root, maxBuffer: 4 * 1024 * 1024, timeout: 8000 }
    );
    const rows = JSON.parse(stdout);
    const counts = new Map();
    for (const row of rows) {
      const login = row.author?.login;
      if (!login) continue;
      const cur = counts.get(login);
      if (cur) {
        cur.prs += 1;
      } else {
        counts.set(login, {
          login,
          name: row.author?.name?.trim() || login,
          prs: 1,
        });
      }
    }
    return [...counts.values()];
  } catch {
    return [];
  }
}

function mergeAuthors(commits, prs) {
  const byKey = new Map();
  const keyFor = (s) => String(s || "").toLowerCase().replace(/[\s\-_]+/g, "");

  for (const c of commits) {
    byKey.set(keyFor(c.name), { name: c.name, commits: c.commits, prs: 0 });
  }
  for (const p of prs) {
    const candidateKeys = [keyFor(p.name), keyFor(p.login)];
    let merged = false;
    for (const k of candidateKeys) {
      const existing = byKey.get(k);
      if (existing) {
        existing.prs += p.prs;
        existing.login = existing.login || p.login;
        merged = true;
        break;
      }
    }
    if (!merged) {
      byKey.set(keyFor(p.login), {
        name: p.name,
        login: p.login,
        commits: 0,
        prs: p.prs,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    const ta = a.commits + a.prs;
    const tb = b.commits + b.prs;
    if (tb !== ta) return tb - ta;
    return b.commits - a.commits;
  });
}

/**
 * Compute a fresh contributors snapshot and persist it. Idempotent —
 * `INSERT OR REPLACE` keeps the "latest" row authoritative. Safe to
 * call from importer.js after every sync.
 *
 * Returns the payload that was written, or `null` if the dashboard
 * repo couldn't be located (in which case any prior snapshot stays
 * intact rather than being wiped).
 */
export async function precomputeContributorsSnapshot() {
  initDb();
  const root = findDashboardRepo(process.cwd());
  if (!root) return null;

  const [commits, prs] = await Promise.all([
    readLocalCommits(root).catch(() => []),
    readPrAuthors(root),
  ]);
  const contributors = mergeAuthors(commits, prs);
  const payload = {
    generated_at: new Date().toISOString(),
    repo: root,
    pr_source_available: prs.length > 0,
    contributors,
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

/** Read the cached snapshot, or null if no sync has run yet. */
export function readContributorsSnapshot() {
  initDb();
  const rows = queryRows(
    `SELECT payload, generated_at FROM summaries WHERE content_hash = ${sqlString(SNAPSHOT_KEY)} LIMIT 1`
  );
  if (!rows.length) return null;
  try {
    return { ...JSON.parse(rows[0].payload), cached: true };
  } catch {
    return null;
  }
}
