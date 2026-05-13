import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// POST /api/update — pull latest from GitHub and `npm install` so newly
// added dependencies are picked up. The dev server's HMR will then
// recompile changed files automatically, so a real server restart is only
// needed if a server-side file (route handler / lib) changed; we report
// the pull stdout so the user can decide.
//
// Safety: refuses to pull if the working tree is dirty (uncommitted
// changes would be at risk). Repo path is restricted to the project root
// derived from process.cwd() — no path traversal possible.

function runCmd(cmd: string, args: string[], cwd: string, timeoutMs: number) {
  return new Promise<{ code: number | null; stdout: string; stderr: string; error?: string }>(
    (resolve) => {
      const child = spawn(cmd, args, { cwd, stdio: ["ignore", "pipe", "pipe"] });
      let stdout = "";
      let stderr = "";
      let settled = false;
      const timer = setTimeout(() => {
        if (settled) return;
        settled = true;
        child.kill("SIGKILL");
        resolve({ code: null, stdout, stderr, error: `timeout after ${timeoutMs}ms` });
      }, timeoutMs);
      child.stdout?.on("data", (b) => (stdout += b.toString()));
      child.stderr?.on("data", (b) => (stderr += b.toString()));
      child.on("error", (e) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code: null, stdout, stderr, error: String(e) });
      });
      child.on("close", (code) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        resolve({ code, stdout, stderr });
      });
    }
  );
}

export async function POST() {
  const repoRoot = path.resolve(process.cwd());

  // Step 1: refuse on dirty working tree
  const status = await runCmd("git", ["status", "--porcelain"], repoRoot, 10_000);
  if (status.error || status.code !== 0) {
    return NextResponse.json(
      {
        ok: false,
        step: "status",
        error: status.error || `git status rc=${status.code}: ${status.stderr.slice(0, 300)}`,
      },
      { status: 500 }
    );
  }
  if (status.stdout.trim()) {
    return NextResponse.json(
      {
        ok: false,
        step: "dirty_tree",
        error:
          "Working tree has uncommitted changes — pulling could overwrite them. " +
          "Commit or stash first, then click Update again.",
        details: status.stdout.split("\n").slice(0, 20).join("\n"),
      },
      { status: 409 }
    );
  }

  // Step 2: fetch + pull (fast-forward only — no merge commits from a
  // button click; if there's divergence we surface that as an error and
  // ask the user to reconcile manually).
  const pull = await runCmd("git", ["pull", "--ff-only"], repoRoot, 60_000);
  if (pull.error || pull.code !== 0) {
    return NextResponse.json(
      {
        ok: false,
        step: "pull",
        error: pull.error || `git pull rc=${pull.code}`,
        stderr: pull.stderr.slice(0, 1000),
        stdout: pull.stdout.slice(0, 1000),
      },
      { status: 500 }
    );
  }

  const alreadyUpToDate = /Already up to date/i.test(pull.stdout);

  // Step 3: only run npm install if package.json or lockfile changed.
  // Cheap check via the diff between HEAD and HEAD@{1}.
  let installRan = false;
  let installOutput = "";
  if (!alreadyUpToDate) {
    const diff = await runCmd(
      "git",
      ["diff", "--name-only", "HEAD@{1}", "HEAD"],
      repoRoot,
      10_000
    );
    const changed = diff.stdout.split("\n").map((s) => s.trim());
    const depsChanged = changed.some(
      (f) => f === "package.json" || f === "package-lock.json"
    );
    if (depsChanged) {
      installRan = true;
      const install = await runCmd(
        "npm",
        ["install", "--no-audit", "--no-fund"],
        repoRoot,
        300_000
      );
      installOutput = install.stdout.slice(-2000) + (install.stderr ? "\n" + install.stderr.slice(-1000) : "");
      if (install.error || install.code !== 0) {
        return NextResponse.json(
          {
            ok: false,
            step: "npm_install",
            error: install.error || `npm install rc=${install.code}`,
            output: installOutput,
            pulled: pull.stdout.slice(-500),
          },
          { status: 500 }
        );
      }
    }
  }

  return NextResponse.json({
    ok: true,
    already_up_to_date: alreadyUpToDate,
    pull_output: pull.stdout.slice(-1500),
    install_ran: installRan,
    install_output: installRan ? installOutput.slice(-1500) : null,
    // Hint to the UI: if non-trivial server files changed, dev needs a
    // restart for HMR-uncovered code (custom servers, native rebuilds).
    needs_restart: installRan,
  });
}
