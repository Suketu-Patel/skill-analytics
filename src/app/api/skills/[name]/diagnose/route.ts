import { NextResponse } from "next/server";
import { spawn } from "node:child_process";
import path from "node:path";
import { getSkillDetail } from "@/lib/metrics";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 300;

type DiagnoseBody = {
  agent: "codex" | "claude";
  mode?: "analyze" | "fix"; // analyze = read-only / plan, fix = write
};

function buildPrompt(detail: NonNullable<ReturnType<typeof getSkillDetail>>, mode: string) {
  const errors = (detail.recentErrors || [])
    .slice(0, 8)
    .map((e: { category: string; message: string; timestamp?: string }) => {
      const when = e.timestamp ? e.timestamp.slice(0, 19) : "?";
      return `- [${when}] ${e.category}: ${e.message.slice(0, 320)}`;
    })
    .join("\n");
  const tools = (detail.tools || [])
    .slice(0, 5)
    .map((t: { tool_name: string; calls: number; failed: number }) =>
      `${t.tool_name}(${t.calls} calls${t.failed ? `, ${t.failed} failed` : ""})`
    )
    .join(", ");

  const skillPath = detail.skill.path || "(no path on disk)";
  const skillKind = detail.skill.kind;

  if (mode === "fix") {
    return [
      `Skill "${detail.skill.name}" (${skillKind}) at ${skillPath} is failing.`,
      `Recent errors:`,
      errors || "(none captured)",
      tools ? `Tools used in same sessions: ${tools}` : "",
      ``,
      `Investigate the root cause of the failures and APPLY a minimal fix.`,
      `Update the skill file at ${skillPath} (and any related files) so the failures stop reproducing.`,
      `Do not refactor unrelated code. Output a one-paragraph summary of what changed.`
    ]
      .filter(Boolean)
      .join("\n");
  }

  // analyze (default) — diagnostic only, no writes
  return [
    `Skill "${detail.skill.name}" (${skillKind}) at ${skillPath} has been producing failures.`,
    ``,
    `Recent errors (most recent first):`,
    errors || "(none captured)",
    ``,
    tools ? `Tool usage context: ${tools}` : "",
    ``,
    `Without editing any files, read the skill file and any code it references and answer:`,
    `1. Root cause of the failures (1–2 sentences)`,
    `2. Proposed minimal fix (concrete diff or step list)`,
    `3. Files to change`,
    `4. Risk level (low / medium / high) and why`
  ]
    .filter(Boolean)
    .join("\n");
}

function runCli(cmd: string, args: string[], opts: { cwd?: string; input?: string; timeoutMs?: number }) {
  return new Promise<{ ok: boolean; stdout: string; stderr: string; code: number | null }>((resolve) => {
    let stdout = "";
    let stderr = "";
    const child = spawn(cmd, args, {
      cwd: opts.cwd,
      env: process.env,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const timer = opts.timeoutMs
      ? setTimeout(() => {
          child.kill("SIGTERM");
          stderr += `\n[timed out after ${opts.timeoutMs}ms]`;
        }, opts.timeoutMs)
      : null;
    child.stdout.on("data", (d) => (stdout += d.toString()));
    child.stderr.on("data", (d) => (stderr += d.toString()));
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      resolve({ ok: code === 0, stdout, stderr, code });
    });
    if (opts.input) {
      child.stdin.write(opts.input);
      child.stdin.end();
    }
  });
}

export async function POST(request: Request, context: { params: Promise<{ name: string }> }) {
  const { name } = await context.params;
  const decoded = decodeURIComponent(name);
  const detail = getSkillDetail(decoded);
  if (!detail) return NextResponse.json({ error: "Skill not found" }, { status: 404 });

  let body: DiagnoseBody;
  try {
    body = (await request.json()) as DiagnoseBody;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const agent = body.agent === "claude" ? "claude" : "codex";
  const mode = body.mode === "fix" ? "fix" : "analyze";

  const prompt = buildPrompt(detail, mode);
  // Use the directory the skill lives in so the agent can actually read it.
  const cwd = detail.skill.path
    ? path.dirname(detail.skill.path)
    : process.env.HOME || process.cwd();

  let cmd: string;
  let args: string[];
  if (agent === "codex") {
    // `codex exec` is the non-interactive run mode. In analyze mode we keep
    // the sandbox read-only so the model literally cannot mutate files.
    cmd = "codex";
    args = [
      "exec",
      "--cd",
      cwd,
      "--sandbox",
      mode === "fix" ? "workspace-write" : "read-only",
      "--ask-for-approval",
      mode === "fix" ? "on-request" : "never",
      prompt
    ];
  } else {
    // `claude -p` is the print mode for non-interactive runs. Plan mode is
    // Claude Code's read-only equivalent.
    cmd = "claude";
    args = mode === "fix"
      ? ["-p", prompt, "--permission-mode", "acceptEdits"]
      : ["-p", prompt, "--permission-mode", "plan"];
  }

  const result = await runCli(cmd, args, {
    cwd,
    timeoutMs: 240_000 // 4 min hard cap
  });

  return NextResponse.json({
    agent,
    mode,
    cwd,
    prompt,
    stdout: result.stdout.slice(0, 200_000),
    stderr: result.stderr.slice(0, 50_000),
    ok: result.ok,
    code: result.code
  });
}
