import { NextResponse } from "next/server";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const exec = promisify(execFile);

// ─── repo gating ─────────────────────────────────────────────────────────
//
// This endpoint must ONLY ever surface contributors from the
// skill-analytics dashboard repo itself. Without that guard a walk-up
// search from the process CWD can land on an unrelated parent repo (in
// dev this dashboard runs from inside the iLit monorepo, whose .git
// would otherwise leak thousands of unrelated authors).
//
// Identity check: a candidate path is the dashboard repo iff its
// package.json has `"name": "skill-analytics"`.

const DASHBOARD_PACKAGE_NAME = "skill-analytics";

function isDashboardRepo(candidate: string): boolean {
  if (!candidate) return false;
  if (!fs.existsSync(path.join(candidate, ".git"))) return false;
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(candidate, "package.json"), "utf8"));
    return pkg?.name === DASHBOARD_PACKAGE_NAME;
  } catch {
    return false;
  }
}

function findDashboardRepo(start: string): string | null {
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
  ].filter(Boolean) as string[];
  for (const candidate of fallbacks) {
    if (isDashboardRepo(candidate)) return candidate;
  }
  return null;
}

// ─── data sources ───────────────────────────────────────────────────────

type CommitAuthor = { name: string; commits: number };
type PrAuthor = { login: string; name: string; prs: number };

async function readLocalCommits(root: string): Promise<CommitAuthor[]> {
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
    .filter((c): c is CommitAuthor => c !== null);
}

// PR authors via gh CLI. The user's clone of the dashboard repo is
// typically `gh`-authed; if it isn't, we degrade silently to the local
// commit list rather than failing the whole endpoint. This is the bit
// that surfaces contributors like malay44 whose PRs were never merged
// (so they don't appear in `git shortlog`) but who still contributed.
async function readPrAuthors(root: string): Promise<PrAuthor[]> {
  try {
    const { stdout } = await exec(
      "gh",
      ["pr", "list", "--state", "all", "--limit", "500", "--json", "author"],
      { cwd: root, maxBuffer: 4 * 1024 * 1024, timeout: 8000 }
    );
    const rows = JSON.parse(stdout) as Array<{ author?: { login?: string; name?: string } }>;
    const counts = new Map<string, PrAuthor>();
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

// ─── merge ──────────────────────────────────────────────────────────────
//
// One contributor identity per row, even if the person shows up as both
// "Suketu Patel" (commit author) and "Suketu-Patel" (GitHub login).
// We match on lowercased name first, then fall back to login.
//
// Each row reports `commits` and `prs` independently — the modal can
// show "X commits, Y PRs" or just whichever is non-zero.

type Contributor = {
  name: string;
  login?: string;
  commits: number;
  prs: number;
};

function mergeAuthors(commits: CommitAuthor[], prs: PrAuthor[]): Contributor[] {
  const byKey = new Map<string, Contributor>();
  const keyFor = (s: string) => s.toLowerCase().replace(/[\s-_]+/g, "");

  for (const c of commits) {
    const key = keyFor(c.name);
    byKey.set(key, { name: c.name, commits: c.commits, prs: 0 });
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
      // Brand-new contributor with no local commits (e.g. malay44 whose
      // PR was opened against this repo but not merged into this clone).
      byKey.set(keyFor(p.login), {
        name: p.name,
        login: p.login,
        commits: 0,
        prs: p.prs,
      });
    }
  }

  return [...byKey.values()].sort((a, b) => {
    // Sort by total contribution (commits + PRs), tiebreaker on commits.
    const ta = a.commits + a.prs;
    const tb = b.commits + b.prs;
    if (tb !== ta) return tb - ta;
    return b.commits - a.commits;
  });
}

// GET /api/contributors
//
// Returns everyone who contributed to the skill-analytics dashboard —
// merged-commit authors from local git history PLUS PR authors from
// GitHub (so unmerged or in-flight PRs still count). Sorted by total
// contributions descending. Names only; logins are exposed so the modal
// can deep-link to GitHub profiles.
export async function GET() {
  try {
    const root = findDashboardRepo(process.cwd());
    if (!root) {
      return NextResponse.json({
        ok: false,
        error:
          "skill-analytics repo not found near this checkout. Set SKILL_ANALYTICS_GIT_DIR if it's elsewhere.",
        contributors: [],
      });
    }
    const [commitAuthors, prAuthors] = await Promise.all([
      readLocalCommits(root),
      readPrAuthors(root),
    ]);
    const contributors = mergeAuthors(commitAuthors, prAuthors);
    return NextResponse.json({
      ok: true,
      repo: root,
      pr_source_available: prAuthors.length > 0,
      contributors,
    });
  } catch (e) {
    return NextResponse.json(
      { ok: false, error: e instanceof Error ? e.message : String(e), contributors: [] },
      { status: 200 }
    );
  }
}
