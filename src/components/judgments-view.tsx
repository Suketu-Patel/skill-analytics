"use client";

import { useCallback, useEffect, useRef, useState } from "react";

type Counts = {
  total_invocations: number;
  skill_invocations: number;
  agent_invocations: number;
  haiku_judged: number;
  codex_judged: number;
  corrections: number;
  codex_candidates: number;
};

type PerSkill = {
  skill_name: string;
  judge: "haiku" | "codex";
  n: number;
  avg_fit: number | null;
  avg_value: number | null;
  avg_corrections: number | null;
  errors: number;
};

type Drift = {
  skill_event_key: string;
  skill_name: string;
  turn_id: string;
  haiku_value: number;
  haiku_fit: number;
  codex_value: number;
  codex_fit: number;
  delta_value: number;
  haiku_poorly: string | null;
  codex_poorly: string | null;
};

type Corroborated = {
  skill_event_key: string;
  skill_name: string;
  turn_id: string;
  fit: number;
  value: number;
  corrections: number | null;
  poorly: string | null;
  judged_at: string;
};

type JudgmentsPayload = {
  ok: boolean;
  counts: Counts;
  perSkill: PerSkill[];
  drift: Drift[];
  corroborated: Corroborated[];
};

type Job = {
  id: string;
  kind: string;
  status: "running" | "done" | "error" | "abandoned";
  started_at: number;
  ended_at: number | null;
  total: number;
  done: number;
  results: { skill: string; ok: boolean; error?: string | null }[];
  error?: string | null;
};

function fmtNum(n: unknown, digits = 1) {
  if (typeof n !== "number" || Number.isNaN(n)) return "n/a";
  return n.toFixed(digits);
}

function fmtDelta(d: number) {
  if (d == null) return "n/a";
  const a = Math.abs(d);
  const cls = a >= 3 ? "text-rose-600" : a >= 2 ? "text-amber-600" : "text-slate-500";
  return <span className={`font-semibold tabular-nums ${cls}`}>{d > 0 ? "+" : ""}{d}</span>;
}

export default function JudgmentsView() {
  const [data, setData] = useState<JudgmentsPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [jobs, setJobs] = useState<Job[]>([]);
  // `activeJobId` tracks which job we're polling. `startingRef` is a
  // synchronous guard so rapid double-clicks can't start two parallel
  // sweeps before React re-renders the disabled button.
  const [activeJobId, setActiveJobId] = useState<string | null>(null);
  const startingRef = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<NodeJS.Timeout | null>(null);

  const refresh = useCallback(async () => {
    // Two parallel fetches: metrics rollup + jobs list. Both can fail
    // independently; we surface metric failures as a banner but let job
    // fetch failures be silent (they recover on next tick).
    try {
      const [metricsResp, jobsResp] = await Promise.all([
        fetch("/api/metrics/judgments"),
        fetch("/api/judge"),
      ]);
      const m = await metricsResp.json();
      const jl = await jobsResp.json();
      if (m?.ok) {
        setData(m);
        setError(null);
      } else {
        setError(m?.error || `metrics fetch failed (HTTP ${metricsResp.status})`);
      }
      if (jl?.ok) setJobs(jl.jobs);
    } catch (e) {
      setError(`refresh failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 30_000);
    return () => clearInterval(id);
  }, [refresh]);

  const startJob = useCallback(
    async (judge: "haiku" | "codex") => {
      // Synchronous in-flight guard for double-clicks within the same
      // tick. We deliberately do NOT also gate on activeJobId — that
      // could lock the user out if a previous poll left activeJobId set
      // (server-restart, network blip, job cleared by another tab).
      // Instead, we force-reset any stale poll/state before starting.
      if (startingRef.current) return;
      startingRef.current = true;
      setError(null);
      // Force-clear any lingering state from a previous run so the
      // button can never get into a stuck-locked state.
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      setActiveJobId(null);
      try {
        const r = await fetch(`/api/judge?judge=${judge}`, { method: "POST" });
        const j = await r.json();
        if (!j.ok) {
          setError(j.error || `Failed to start ${judge} judge`);
          startingRef.current = false;
          return;
        }
        if (!j.job?.id) {
          setError("server returned no job id");
          startingRef.current = false;
          return;
        }
        setActiveJobId(j.job.id);
        // Optimistically merge the running job into the visible jobs
        // list so the progress banner shows up before the first poll.
        setJobs((prev) => [j.job, ...prev.filter((p) => p.id !== j.job.id)]);
        const targetId: string = j.job.id;
        pollRef.current = setInterval(async () => {
          try {
            const rr = await fetch(`/api/judge/job/${targetId}`);
            const jj = await rr.json();
            // 404 — server cleared the job (Clear pressed, server
            // restarted, registry reaped). Don't leave the UI locked;
            // reset and let the user click again.
            if (!jj.ok) {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setActiveJobId(null);
              startingRef.current = false;
              setError(`job ${targetId} disappeared: ${jj.error || "not found"}`);
              return;
            }
            setJobs((prev) => {
              const others = prev.filter((p) => p.id !== jj.job.id);
              return [jj.job, ...others];
            });
            if (jj.job.status !== "running") {
              if (pollRef.current) clearInterval(pollRef.current);
              pollRef.current = null;
              setActiveJobId(null);
              startingRef.current = false;
              refresh();
            }
          } catch {
            /* transient — next poll tick will retry */
          }
        }, 1500);
      } catch (e) {
        setError(`Click handler failed: ${e instanceof Error ? e.message : String(e)}`);
        startingRef.current = false;
      }
    },
    [refresh]
  );

  useEffect(() => () => {
    if (pollRef.current) clearInterval(pollRef.current);
  }, []);

  const counts = data?.counts;
  const unjudgedHaiku = counts ? Math.max(0, counts.total_invocations - counts.haiku_judged) : 0;
  // Show progress for ANY running job in the registry — including jobs
  // started by other tabs or by an earlier session — so the user always
  // knows work is happening.
  const runningJobs = jobs.filter((j) => j.status === "running");
  const anyRunning = runningJobs.length > 0;
  // Button-disable signal is local-only: just whether THIS tab has an
  // active POST in flight. Otherwise leaving the tab open with a stale
  // running job in the server registry would lock the user out.
  const thisTabRunning = !!activeJobId;

  return (
    <section className="flex flex-col gap-5">
      {/* Highly-visible progress banner — appears whenever ANY judge job
          is running, so the user always knows work is happening even if
          the small status text near the buttons is missed. */}
      {anyRunning && (
        <div className="rounded-md border border-amber-300 bg-amber-50 p-4">
          {runningJobs.map((j) => {
            const pct = j.total > 0 ? Math.round((j.done / j.total) * 100) : 0;
            const elapsed = Date.now() / 1000 - j.started_at;
            return (
              <div key={j.id} className="mb-2 last:mb-0">
                <div className="flex items-baseline justify-between gap-3">
                  <div className="text-sm font-semibold text-amber-900">
                    {j.kind === "judge-haiku" ? "⚖ Haiku judge" : "⚖⚖ Codex 2nd opinion"} running
                  </div>
                  <div className="text-xs text-amber-700 tabular-nums">
                    {j.done} / {j.total} · {elapsed.toFixed(0)}s
                  </div>
                </div>
                <div className="mt-1 h-2 overflow-hidden rounded-full bg-amber-100">
                  <div
                    className="h-full bg-amber-500 transition-all"
                    style={{ width: `${pct}%` }}
                  />
                </div>
                {j.results.length > 0 && (
                  <div className="mt-1 text-xs text-amber-700">
                    Last: {j.results[j.results.length - 1].skill}
                    {j.results[j.results.length - 1].ok ? " ✓" : " ✗"}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatTile
          label="Total invocations"
          value={counts?.total_invocations ?? "n/a"}
          hint={
            counts
              ? `${counts.skill_invocations} Skill · ${counts.agent_invocations} Agent`
              : undefined
          }
        />
        <StatTile label="Haiku judged" value={counts?.haiku_judged ?? "n/a"} hint={`${unjudgedHaiku} unjudged`} />
        <StatTile label="Codex judged" value={counts?.codex_judged ?? "n/a"} />
        <StatTile label="Corrections seen" value={counts?.corrections ?? "n/a"} hint="user pushed back on next turn" />
      </div>

      <div className="panel flex flex-wrap items-center gap-2 p-3">
        <button
          className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium hover:border-teal disabled:opacity-50"
          onClick={() => startJob("haiku")}
          disabled={thisTabRunning}
        >
          ⚖ Run Haiku judge
          {unjudgedHaiku > 0 && (
            <span className="ml-2 rounded-full bg-teal px-1.5 text-xs text-white">{unjudgedHaiku}</span>
          )}
        </button>
        <button
          className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium hover:border-teal disabled:opacity-50"
          onClick={() => startJob("codex")}
          disabled={thisTabRunning}
        >
          ⚖⚖ Run Codex 2nd opinion
          {counts?.codex_candidates ? (
            <span className="ml-2 rounded-full bg-teal px-1.5 text-xs text-white">
              {counts.codex_candidates}
            </span>
          ) : null}
        </button>
        <button
          className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium hover:border-teal disabled:opacity-50"
          onClick={refresh}
          disabled={loading}
        >
          ↻ Refresh
        </button>
        <button
          className="h-9 rounded-md border border-line bg-white px-3 text-sm font-medium text-slate-500 hover:border-rose-400 hover:text-rose-600"
          onClick={async () => {
            // Clears only the in-memory run log. Verdicts stay in SQLite.
            await fetch("/api/judge", { method: "DELETE" });
            // Also clear local UI state so any orphaned activeJobId is reset.
            startingRef.current = false;
            setActiveJobId(null);
            if (pollRef.current) {
              clearInterval(pollRef.current);
              pollRef.current = null;
            }
            await refresh();
          }}
          title="Clear in-memory run log (verdicts in SQLite are kept)"
        >
          ✕ Clear run log
        </button>
        {error && (
          <span className="text-xs text-rose-600" title={error}>
            {error.length > 120 ? error.slice(0, 120) + "…" : error}
          </span>
        )}
      </div>

      <div className="panel overflow-hidden">
        <header className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Per-skill judge rollup
        </header>
        {!data || data.perSkill.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No judgments yet. Click <b>Run Haiku judge</b> above to begin.
          </div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-4 py-2 text-left">Skill</th>
                <th className="px-4 py-2 text-left">Judge</th>
                <th className="px-4 py-2 text-right">n</th>
                <th className="px-4 py-2 text-right">avg fit</th>
                <th className="px-4 py-2 text-right">avg value</th>
                <th className="px-4 py-2 text-right">avg corrections</th>
                <th className="px-4 py-2 text-right">errors</th>
              </tr>
            </thead>
            <tbody>
              {data.perSkill.map((r, i) => (
                <tr key={i} className="border-t border-line">
                  <td className="px-4 py-2">{r.skill_name}</td>
                  <td className="px-4 py-2">{r.judge}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.n}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.avg_fit)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.avg_value)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{fmtNum(r.avg_corrections)}</td>
                  <td className="px-4 py-2 text-right tabular-nums">{r.errors || 0}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <div className="panel overflow-hidden">
        <header className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Drift watch: Haiku vs Codex
        </header>
        {!data || data.drift.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No drift data yet. Needs both Haiku and Codex judgments on the same invocations.
            Run Haiku first, then run Codex 2nd opinion.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.drift.map((d) => (
              <li key={d.skill_event_key} className="grid grid-cols-[60px_1fr_140px] items-center gap-3 px-4 py-3">
                <div className="text-right">{fmtDelta(d.delta_value)}</div>
                <div>
                  <div className="text-sm font-medium">{d.skill_name}</div>
                  {(d.haiku_poorly || d.codex_poorly) && (
                    <div className="mt-1 text-xs text-slate-500">
                      {d.haiku_poorly && <div>haiku: {d.haiku_poorly}</div>}
                      {d.codex_poorly && <div>codex: {d.codex_poorly}</div>}
                    </div>
                  )}
                </div>
                <div className="text-right text-xs text-slate-500 tabular-nums">
                  haiku {d.haiku_value} · codex {d.codex_value}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel overflow-hidden">
        <header className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Corroborated low scores: judge ≤ 4 and user corrected
        </header>
        {!data || data.corroborated.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">
            No corroborated cases yet. These are invocations where both the
            judge and the user's next turn agreed it didn't work.
          </div>
        ) : (
          <ul className="divide-y divide-line">
            {data.corroborated.map((c) => (
              <li key={c.skill_event_key} className="grid grid-cols-[1fr_160px] items-center gap-3 px-4 py-3">
                <div>
                  <div className="text-sm font-medium">{c.skill_name}</div>
                  {c.poorly && <div className="mt-1 text-xs text-slate-500">{c.poorly}</div>}
                </div>
                <div className="text-right text-xs text-slate-500 tabular-nums">
                  fit {c.fit} · value {c.value}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="panel overflow-hidden">
        <header className="border-b border-line bg-slate-50 px-4 py-2 text-xs font-semibold uppercase tracking-wide text-slate-500">
          Recent runs
        </header>
        {jobs.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No runs yet in this session.</div>
        ) : (
          <ul className="divide-y divide-line">
            {jobs.slice(0, 10).map((j) => (
              <li key={j.id} className="px-4 py-3 text-sm">
                <div className="flex flex-wrap items-center gap-2">
                  <span
                    className={`rounded-full px-2 py-0.5 text-xs font-medium ${
                      j.status === "done"
                        ? "bg-emerald-100 text-emerald-700"
                        : j.status === "running"
                        ? "bg-amber-100 text-amber-700"
                        : j.status === "abandoned"
                        ? "bg-slate-100 text-slate-600"
                        : "bg-rose-100 text-rose-700"
                    }`}
                  >
                    {j.status}
                  </span>
                  <span className="font-medium">{j.kind}</span>
                  <span className="text-xs text-slate-500 tabular-nums">
                    {j.done}/{j.total}
                  </span>
                  <span className="text-xs text-slate-400 tabular-nums">
                    {((j.ended_at || Date.now() / 1000) - j.started_at).toFixed(1)}s
                  </span>
                </div>
                {j.error && <div className="mt-1 text-xs text-rose-600">{j.error}</div>}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function StatTile({ label, value, hint }: { label: string; value: number | string; hint?: string }) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div className="mt-2 text-2xl font-semibold tabular-nums">{value}</div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}
