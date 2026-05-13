"use client";

import { useEffect, useState } from "react";
import { Users, Trophy } from "lucide-react";

// Contributor roll, merged from two sources via /api/contributors:
//   1. `git shortlog -sn --no-merges` against the dashboard repo for
//      merged-commit authors.
//   2. `gh pr list --state all` for PR authors — so unmerged or
//      in-flight PRs (like malay44's Cursor PR) still surface.
// Sorted by total contributions (commits + PRs), with the top three
// getting a podium treatment.

type Contributor = {
  name: string;
  login?: string;
  commits: number;
  prs: number;
};

function rank(idx: number): string {
  if (idx === 0) return "🥇";
  if (idx === 1) return "🥈";
  if (idx === 2) return "🥉";
  return `#${idx + 1}`;
}

export default function ContributorsButton() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Contributor[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Lazy-load on first open so the API isn't hit on every page render.
  useEffect(() => {
    if (!open || data !== null) return;
    fetch("/api/contributors")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) setData(j.contributors || []);
        else setError(j.error || "Could not read contributors");
      })
      .catch((e) => setError(String(e)));
  }, [open, data]);

  // Esc closes — capture phase so we beat any global keymaps that
  // might be watching for the same key on other surfaces.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setOpen(false);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [open]);

  const total = data?.reduce((s, c) => s + c.commits + c.prs, 0) || 0;
  // Compact "3 commits · 1 PR" / "1 PR" / "12 commits" string per row.
  // Skips zero-count halves so a PR-only contributor doesn't read
  // "0 commits · 1 PR".
  const summarize = (c: Contributor) => {
    const parts: string[] = [];
    if (c.commits) parts.push(`${c.commits} ${c.commits === 1 ? "commit" : "commits"}`);
    if (c.prs) parts.push(`${c.prs} ${c.prs === 1 ? "PR" : "PRs"}`);
    return parts.join(" · ");
  };

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        className="inline-flex items-center gap-1 font-medium text-teal hover:underline"
        title="See everyone who's contributed (commits + PRs)"
      >
        <Users size={11} />
        <span>contributors</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/40 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-md overflow-hidden rounded-lg border border-line bg-white shadow-2xl"
          >
            <div className="flex items-center gap-2 border-b border-line bg-teal/5 px-5 py-4">
              <Trophy size={20} className="text-teal" />
              <div className="flex-1">
                <h3 className="text-base font-semibold text-ink">Contributors</h3>
                <p className="text-xs text-slate-500">
                  Commits from this clone, plus PR authors from GitHub. Sorted by total contributions.
                </p>
              </div>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-line bg-white px-2 py-1 text-xs text-slate-500 hover:border-teal"
              >
                Close (Esc)
              </button>
            </div>
            <div className="max-h-[60vh] overflow-y-auto p-5">
              {error ? (
                <p className="text-sm text-coral">{error}</p>
              ) : data === null ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : data.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No git history found. Are you running from inside the repo?
                </p>
              ) : (
                <ol className="space-y-1.5">
                  {data.map((c, i) => {
                    const contributed = c.commits + c.prs;
                    const pct = total > 0 ? (contributed / total) * 100 : 0;
                    return (
                      <li
                        key={`${c.name}-${c.login ?? i}`}
                        className="grid grid-cols-[2rem_1fr_auto] items-center gap-3 rounded-md border border-line bg-white p-2.5 hover:border-teal"
                      >
                        <span className="text-center text-sm font-semibold text-slate-500">
                          {rank(i)}
                        </span>
                        <div className="min-w-0">
                          <div className="flex items-baseline gap-2 truncate">
                            <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
                            {c.login && (
                              <a
                                href={`https://github.com/${c.login}`}
                                target="_blank"
                                rel="noreferrer"
                                className="shrink-0 text-[11px] font-mono text-teal hover:underline"
                              >
                                @{c.login}
                              </a>
                            )}
                          </div>
                          <div className="mt-1 h-1.5 w-full overflow-hidden rounded-full bg-line">
                            <div
                              className="h-full bg-teal"
                              style={{ width: `${Math.max(2, pct)}%` }}
                            />
                          </div>
                        </div>
                        <span className="shrink-0 text-right text-xs tabular-nums text-slate-500">
                          {summarize(c)}
                        </span>
                      </li>
                    );
                  })}
                </ol>
              )}
            </div>
            <div className="border-t border-line bg-slate-50 px-5 py-3 text-[11px] text-slate-500">
              {data?.length
                ? `${data.length} contributor${data.length === 1 ? "" : "s"} · ${total} contribution${total === 1 ? "" : "s"} (commits + PRs)`
                : "Merged from local git history and GitHub PRs."}
            </div>
          </div>
        </div>
      )}
    </>
  );
}
