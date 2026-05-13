import { NextResponse } from "next/server";
import { getSkillMetrics } from "@/lib/metrics";
import { parseOpts } from "@/lib/route-opts";
import { readOrCompute } from "@/lib/metric-cache.js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type SkillRow = {
  name: string;
  kind: string;
  path: string | null;
  description: string | null;
  source?: string | null;
  events: number;
  [k: string]: unknown;
};

function categorize(skill: SkillRow): { category: string; project: string | null } {
  const path = (skill.path || "").replace(/\\/g, "/");
  if (skill.source === "claude") {
    // claude_skill (e.g. /vercel:foo, /init) or claude_agent (subagent_type)
    if (skill.kind === "claude_agent") return { category: "claude-agent", project: null };
    return { category: "claude-skill", project: null };
  }
  if (skill.kind === "agent") {
    const m = path.match(/^(.*)\/\.codex\/agents\/[^/]+\.toml$/);
    const project = m ? m[1].split("/").filter(Boolean).pop() || null : null;
    return { category: "project-agent", project };
  }
  if (skill.kind === "plugin_skill") return { category: "plugin", project: null };
  if (path.includes("/.codex/skills/.system/")) return { category: "system", project: null };
  if (path.includes("/.codex/skills/")) return { category: "user-skill", project: null };
  return { category: "other", project: null };
}

export async function GET(request: Request) {
  const opts = parseOpts(request.url);
  return NextResponse.json(
    readOrCompute("skills", opts, () => {
      const raw = getSkillMetrics(opts) as SkillRow[];
      const skills = raw.map((s) => ({ ...s, ...categorize(s) }));
      const projects = [...new Set(skills.map((s) => s.project).filter(Boolean))].sort();
      return { skills, projects };
    })
  );
}
