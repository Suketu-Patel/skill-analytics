import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// GET /api/update/check — cheap upstream check. `git fetch` updates the
// refs without merging, then `git rev-list HEAD..origin/HEAD --count`
// reports how many commits we're behind. The UI uses this to decide
// whether to even show the Update button (no point showing it when
// nothing is available).
//
// Safe to poll on an interval — no working-tree mutation, no install.

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

export async function GET() {
  const repoRoot = path.resolve(process.cwd());

  // Find the upstream ref. Default to origin/main if none configured.
  const upstreamRef = await runCmd(
    "git",
    ["rev-parse", "--abbrev-ref", "--symbolic-full-name", "@{u}"],
    repoRoot,
    5_000
  );
  const upstream =
    upstreamRef.code === 0 && upstreamRef.stdout.trim()
      ? upstreamRef.stdout.trim()
      : "origin/main";

  // Fast fetch — quiet, no tags, no recurse-submodules. ~1s on a small repo.
  const fetched = await runCmd("git", ["fetch", "--quiet", "origin"], repoRoot, 30_000);
  if (fetched.error || fetched.code !== 0) {
    return NextResponse.json({
      ok: false,
      available: false,
      error: fetched.error || `git fetch rc=${fetched.code}: ${fetched.stderr.slice(0, 200)}`,
    });
  }

  // How many commits ahead of HEAD is the upstream?
  const ahead = await runCmd(
    "git",
    ["rev-list", "--count", `HEAD..${upstream}`],
    repoRoot,
    5_000
  );
  const count = Number(ahead.stdout.trim() || "0");

  let commits: { sha: string; subject: string }[] = [];
  if (count > 0) {
    // Up to 10 newest commit subjects for the tooltip
    const log = await runCmd(
      "git",
      ["log", "--oneline", "-n", "10", `HEAD..${upstream}`],
      repoRoot,
      5_000
    );
    commits = log.stdout
      .split("\n")
      .map((l) => l.trim())
      .filter(Boolean)
      .map((l) => {
        const [sha, ...rest] = l.split(" ");
        return { sha, subject: rest.join(" ") };
      });
  }

  return NextResponse.json({
    ok: true,
    available: count > 0,
    behind_by: count,
    upstream,
    commits,
    checked_at: new Date().toISOString(),
  });
}
