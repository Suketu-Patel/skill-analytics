"use client";

import { useEffect, useState } from "react";
import { Users, Sparkles, GitCommit, GitPullRequest } from "lucide-react";

// Contributors modal. Reads from a DB-cached snapshot warmed by the
// importer after every sync, so the modal opens instantly instead of
// waiting on `gh pr list`. Layout: a podium for the top three (with
// GitHub avatars when a login is known) plus a clean ranked list
// underneath.

type Contributor = {
  name: string;
  login?: string;
  commits: number;
  prs: number;
};

// Single-character initials fallback when there's no GitHub login (so
// no avatar URL). We don't want a generic Users icon in every slot.
function initials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (!parts.length) return "?";
  if (parts.length === 1) return parts[0][0]?.toUpperCase() || "?";
  return (parts[0][0] + parts[parts.length - 1][0]).toUpperCase();
}

function Avatar({ c, size }: { c: Contributor; size: number }) {
  const dim = `${size}px`;
  if (c.login) {
    return (
      <img
        src={`https://github.com/${c.login}.png?size=${size * 2}`}
        alt={c.name}
        width={size}
        height={size}
        className="rounded-full border border-line bg-slate-100 object-cover"
        style={{ width: dim, height: dim }}
        loading="lazy"
      />
    );
  }
  return (
    <div
      className="flex items-center justify-center rounded-full border border-line bg-teal/10 font-semibold text-teal"
      style={{ width: dim, height: dim, fontSize: Math.max(10, Math.round(size * 0.4)) }}
    >
      {initials(c.name)}
    </div>
  );
}

// Tiny pill showing "12c · 3p" — split commits/PRs so the unit is
// instantly readable but doesn't eat width.
function Counts({ c }: { c: Contributor }) {
  return (
    <span className="inline-flex items-center gap-1.5 text-[11px] tabular-nums text-slate-500">
      {c.commits > 0 && (
        <span className="inline-flex items-center gap-0.5" title={`${c.commits} commit${c.commits === 1 ? "" : "s"}`}>
          <GitCommit size={11} />
          {c.commits}
        </span>
      )}
      {c.prs > 0 && (
        <span className="inline-flex items-center gap-0.5 text-teal" title={`${c.prs} PR${c.prs === 1 ? "" : "s"}`}>
          <GitPullRequest size={11} />
          {c.prs}
        </span>
      )}
    </span>
  );
}

function PodiumCard({ c, place }: { c: Contributor; place: 1 | 2 | 3 }) {
  // Visual hierarchy: first place taller + gold ring, second/third
  // shorter + silver/bronze. Card heights are intentional — the
  // staggered podium effect comes from `pt-N` increasing for lower
  // places, mimicking an Olympic podium.
  const palette: Record<1 | 2 | 3, { ring: string; medal: string; pt: string }> = {
    1: { ring: "ring-amber-400 ring-2", medal: "bg-amber-400 text-amber-950", pt: "pt-0" },
    2: { ring: "ring-slate-300 ring-2", medal: "bg-slate-300 text-slate-800", pt: "pt-3" },
    3: { ring: "ring-orange-300 ring-2", medal: "bg-orange-300 text-orange-950", pt: "pt-5" },
  };
  const p = palette[place];
  return (
    <div className={`flex flex-col items-center text-center ${p.pt}`}>
      <div className="relative">
        <div className={`rounded-full ${p.ring} p-0.5`}>
          <Avatar c={c} size={place === 1 ? 64 : 52} />
        </div>
        <span
          className={`absolute -bottom-1 -right-1 inline-flex h-5 w-5 items-center justify-center rounded-full text-[10px] font-bold ${p.medal}`}
        >
          {place}
        </span>
      </div>
      <div className="mt-2 max-w-[10rem] truncate text-sm font-semibold text-ink">
        {c.name}
      </div>
      {c.login && (
        <a
          href={`https://github.com/${c.login}`}
          target="_blank"
          rel="noreferrer"
          className="font-mono text-[10px] text-teal hover:underline"
        >
          @{c.login}
        </a>
      )}
      <div className="mt-1">
        <Counts c={c} />
      </div>
    </div>
  );
}

export default function ContributorsButton() {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState<Contributor[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [generatedAt, setGeneratedAt] = useState<string | null>(null);

  // Prefetch on first hover OR open so the modal feels instant. Cache
  // hit makes the fetch ~5ms; even pre-cache it kicks off before click.
  useEffect(() => {
    if (!open || data !== null) return;
    fetch("/api/contributors")
      .then((r) => r.json())
      .then((j) => {
        if (j.ok) {
          setData(j.contributors || []);
          setGeneratedAt(j.generated_at || null);
        } else {
          setError(j.error || "Could not read contributors");
        }
      })
      .catch((e) => setError(String(e)));
  }, [open, data]);

  // Esc closes — capture phase so we beat any global keymaps watching
  // for the same key on other surfaces.
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
  const podium = data?.slice(0, 3) ?? [];
  const rest = data?.slice(3) ?? [];

  return (
    <>
      <button
        onClick={() => setOpen(true)}
        onMouseEnter={() => {
          if (data === null && !error) {
            // Warm the cache route in the background so click→open is instant.
            fetch("/api/contributors").catch(() => {});
          }
        }}
        className="inline-flex items-center gap-1 font-medium text-teal hover:underline"
        title="See everyone who's contributed (commits + PRs)"
      >
        <Users size={11} />
        <span>contributors</span>
      </button>
      {open && (
        <div
          className="fixed inset-0 z-[70] flex items-center justify-center bg-black/50 p-4"
          onClick={() => setOpen(false)}
        >
          <div
            onClick={(e) => e.stopPropagation()}
            className="w-full max-w-lg overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
          >
            {/* Header */}
            <div className="relative overflow-hidden border-b border-line bg-gradient-to-br from-teal/15 via-teal/5 to-white px-5 py-4">
              <div className="absolute -right-4 -top-4 text-teal/15">
                <Sparkles size={96} />
              </div>
              <h3 className="text-lg font-semibold text-ink">Made by these humans</h3>
              <p className="text-xs text-slate-600">
                Local commits + GitHub PR authors. Cached on each sync, so this opens instantly.
              </p>
            </div>

            {/* Body */}
            <div className="max-h-[70vh] overflow-y-auto px-5 py-5">
              {error ? (
                <p className="text-sm text-coral">{error}</p>
              ) : data === null ? (
                <p className="text-sm text-slate-500">Loading…</p>
              ) : data.length === 0 ? (
                <p className="text-sm text-slate-500">
                  No git history found. Are you running from inside the repo?
                </p>
              ) : (
                <>
                  {/* Podium — at least 2 contributors. Grid columns
                       match the number we actually have so a 2-person
                       podium doesn't leave a gaping third column. With
                       3+, the order is 2nd / 1st / 3rd so the gold
                       medal sits in the middle like an Olympic podium. */}
                  {podium.length >= 2 && (
                    <div
                      className={`mb-5 grid items-end gap-3 ${
                        podium.length === 2 ? "grid-cols-2 justify-center" : "grid-cols-3"
                      }`}
                    >
                      {podium.length === 2 ? (
                        <>
                          {/* 1st on the left, 2nd on the right — no fake middle */}
                          <PodiumCard c={podium[0]} place={1} />
                          <PodiumCard c={podium[1]} place={2} />
                        </>
                      ) : (
                        <>
                          <PodiumCard c={podium[1]} place={2} />
                          <PodiumCard c={podium[0]} place={1} />
                          {podium[2] && <PodiumCard c={podium[2]} place={3} />}
                        </>
                      )}
                    </div>
                  )}

                  {/* Single-contributor fallback — just a centered card */}
                  {podium.length === 1 && (
                    <div className="mb-5 flex justify-center">
                      <PodiumCard c={podium[0]} place={1} />
                    </div>
                  )}

                  {/* Tail */}
                  {rest.length > 0 && (
                    <ol className="space-y-1.5">
                      {rest.map((c, i) => {
                        const place = i + 4;
                        const contributed = c.commits + c.prs;
                        const pct = total > 0 ? (contributed / total) * 100 : 0;
                        return (
                          <li
                            key={`${c.name}-${c.login ?? i}`}
                            className="grid grid-cols-[1.5rem_2rem_1fr_auto] items-center gap-3 rounded-md border border-line bg-white px-3 py-2"
                          >
                            <span className="text-center text-xs font-semibold text-slate-400">
                              #{place}
                            </span>
                            <Avatar c={c} size={28} />
                            <div className="min-w-0">
                              <div className="flex items-baseline gap-2 truncate">
                                <span className="truncate text-sm font-semibold text-ink">{c.name}</span>
                                {c.login && (
                                  <a
                                    href={`https://github.com/${c.login}`}
                                    target="_blank"
                                    rel="noreferrer"
                                    className="shrink-0 text-[10px] font-mono text-teal hover:underline"
                                  >
                                    @{c.login}
                                  </a>
                                )}
                              </div>
                              <div className="mt-1 h-1 w-full overflow-hidden rounded-full bg-line">
                                <div className="h-full bg-teal" style={{ width: `${Math.max(2, pct)}%` }} />
                              </div>
                            </div>
                            <Counts c={c} />
                          </li>
                        );
                      })}
                    </ol>
                  )}
                </>
              )}
            </div>

            {/* Footer */}
            <div className="flex items-center justify-between gap-3 border-t border-line bg-slate-50 px-5 py-2.5 text-[11px] text-slate-500">
              <span>
                {data?.length
                  ? `${data.length} contributor${data.length === 1 ? "" : "s"} · ${total} contribution${total === 1 ? "" : "s"}`
                  : "Cached on each sync."}
                {generatedAt && (
                  <>
                    {" · refreshed "}
                    <span className="text-slate-400">{new Date(generatedAt).toLocaleString()}</span>
                  </>
                )}
              </span>
              <button
                onClick={() => setOpen(false)}
                className="rounded-md border border-line bg-white px-2 py-1 text-[11px] text-slate-500 hover:border-teal"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
