"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { fetchJson } from "./fetch-json";

// ─── data shapes ────────────────────────────────────────────────────────

type CrazyPayload = {
  ok: boolean;
  frustration: {
    by_hour: { hour: number; total: number; frustrated: number; rate: number }[];
    total_messages: number;
    total_frustrated: number;
  };
  cost_per_loc: {
    cwd: string;
    cwd_short: string;
    turns: number;
    tokens: number;
    cost: number;
    loc: number;
    cost_per_loc: number | null;
    exists: boolean;
  }[];
  context_degradation: {
    by_band: { band: string; turns: number; corrected: number; rate: number }[];
  };
  phantom_edits: { path: string; cwd: string | null; edits: number; last_source: string }[];
  tool_transitions: { from: string; to: string; count: number }[];
  pep_talk: {
    total_assistant_msgs: number;
    pep_msgs: number;
    rate: number;
    top_phrases: { phrase: string; count: number }[];
  };
  sessions: {
    session_id: string;
    cwd: string | null;
    started_at: string | null;
    ended_at: string | null;
    turns: number;
    tokens: number;
    source: string;
  }[];
  fingerprint: {
    top_models: { model: string; count: number }[];
    peak_hour: number | null;
    peak_hour_count: number;
    top_project: string | null;
    top_project_turns: number;
    most_loved_tool: string | null;
    most_loved_count: number;
    most_hated_tool: string | null;
    most_hated_error_rate: number;
    avg_turns_per_session: number;
    top_correction_phrase: { phrase: string; count: number } | null;
  };
};

type ReplayEvent = { timestamp: string | null; kind: "user" | "assistant" | "tool" | "other"; text: string };

// ─── main view ──────────────────────────────────────────────────────────

export default function CrazyView({ refreshNonce = 0 }: { refreshNonce?: number }) {
  const [data, setData] = useState<CrazyPayload | null>(null);
  const [loading, setLoading] = useState(true);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    fetchJson<CrazyPayload>("/api/metrics/crazy")
      .then((d) => setData(d))
      .catch((e) => setErr(e instanceof Error ? e.message : String(e)))
      .finally(() => setLoading(false));
  }, [refreshNonce]);

  if (loading && !data) {
    return <section className="panel p-12 text-center text-sm text-slate-500">Loading uncomfortable truths...</section>;
  }
  if (err && !data) {
    return <section className="panel p-12 text-center text-sm text-coral">Failed: {err}</section>;
  }
  if (!data) return null;

  return (
    <section className="flex flex-col gap-4">
      <header className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
        <h1 className="text-lg font-semibold text-ink">🔮 Crazy</h1>
        <p className="text-xs text-slate-500">
          Eight panels that probably reveal more about your AI habits than you bargained for.
          Computed locally from your session JSONLs.
        </p>
      </header>

      <FingerprintCard fp={data.fingerprint} />

      <div className="grid gap-4 lg:grid-cols-2">
        <FrustrationCurve data={data.frustration} />
        <ContextDegradation data={data.context_degradation} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <PepTalkPanel data={data.pep_talk} />
        <ToolTransitions data={data.tool_transitions} />
      </div>

      <CostPerLOC data={data.cost_per_loc} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PhantomEdits data={data.phantom_edits} />
        <SessionReplay sessions={data.sessions} />
      </div>
    </section>
  );
}

// ─── #21: AI fingerprint ────────────────────────────────────────────────

function FingerprintCard({ fp }: { fp: CrazyPayload["fingerprint"] }) {
  const peak = fp.peak_hour != null ? `${String(fp.peak_hour).padStart(2, "0")}:00` : "—";
  const projShort = fp.top_project ? fp.top_project.split("/").slice(-2).join("/") : "—";
  return (
    <div className="rounded-lg border-2 border-violet/40 bg-violet/5 p-5">
      <h2 className="mb-3 text-sm font-semibold uppercase tracking-wider text-violet">
        🪞 Your AI fingerprint
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FpStat label="Peak hour" value={peak} sub={`${fp.peak_hour_count} sessions started`} />
        <FpStat
          label="Top model"
          value={fp.top_models[0]?.model || "—"}
          sub={fp.top_models[1] ? `then ${fp.top_models[1].model}` : ""}
          mono
        />
        <FpStat
          label="Favorite tool"
          value={fp.most_loved_tool || "—"}
          sub={`${fp.most_loved_count.toLocaleString()} calls`}
        />
        <FpStat
          label="Buggiest tool"
          value={fp.most_hated_tool || "—"}
          sub={`${(fp.most_hated_error_rate * 100).toFixed(1)}% errors`}
          tone="coral"
        />
        <FpStat label="Most-worked project" value={projShort} sub={`${fp.top_project_turns} turns`} mono />
        <FpStat
          label="Avg turns / session"
          value={fp.avg_turns_per_session.toString()}
          sub="across all sources"
        />
        <FpStat
          label="Your top correction"
          value={fp.top_correction_phrase ? `"${fp.top_correction_phrase.phrase}"` : "—"}
          sub={fp.top_correction_phrase ? `said ${fp.top_correction_phrase.count.toLocaleString()}x` : ""}
        />
        <FpStat label="Models used" value={`${fp.top_models.length}`} sub="distinct in lifetime" />
      </div>
    </div>
  );
}

function FpStat({
  label,
  value,
  sub,
  mono = false,
  tone = "default",
}: {
  label: string;
  value: string;
  sub?: string;
  mono?: boolean;
  tone?: "default" | "coral";
}) {
  return (
    <div>
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">{label}</div>
      <div
        className={`mt-0.5 truncate text-base font-bold ${
          tone === "coral" ? "text-coral" : "text-ink"
        } ${mono ? "font-mono text-sm" : ""}`}
        title={value}
      >
        {value}
      </div>
      {sub && <div className="text-[10px] text-slate-500">{sub}</div>}
    </div>
  );
}

// ─── #2: Frustration curve by hour of day ──────────────────────────────

function FrustrationCurve({ data }: { data: CrazyPayload["frustration"] }) {
  const chart = data.by_hour.map((b) => ({ hour: `${b.hour}h`, rate: Math.round(b.rate * 1000) / 10, total: b.total }));
  const overall = data.total_messages > 0 ? (data.total_frustrated / data.total_messages) * 100 : 0;
  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">😤 Frustration by hour</h2>
        <span className="text-xs text-slate-500">
          {overall.toFixed(1)}% overall · {data.total_frustrated.toLocaleString()} corrections
        </span>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        % of your messages that contain phrases like &quot;no&quot;, &quot;actually&quot;, &quot;wrong&quot;,
        &quot;undo&quot;. Find your danger hour.
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
          <YAxis tick={{ fontSize: 10 }} unit="%" />
          <Tooltip
            formatter={(v: number) => `${v}%`}
            labelFormatter={(l: string) => `Hour: ${l}`}
          />
          <Bar dataKey="rate" fill="#f43f5e" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── #6: Context degradation curve ─────────────────────────────────────

function ContextDegradation({ data }: { data: CrazyPayload["context_degradation"] }) {
  const chart = data.by_band.map((b) => ({
    band: b.band,
    rate: Math.round(b.rate * 1000) / 10,
    turns: b.turns,
  }));
  const worst = [...data.by_band].sort((a, b) => b.rate - a.rate)[0];
  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">🐪 Context that broke the camel</h2>
        <span className="text-xs text-slate-500">
          worst: {worst?.band} ({Math.round((worst?.rate || 0) * 100)}%)
        </span>
      </div>
      <p className="mb-2 text-xs text-slate-500">
        Correction rate vs cumulative session tokens. At what context length do you start pushing back?
      </p>
      <ResponsiveContainer width="100%" height={220}>
        <LineChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="band" tick={{ fontSize: 10 }} />
          <YAxis tick={{ fontSize: 10 }} unit="%" />
          <Tooltip
            formatter={(v: number) => `${v}%`}
            labelFormatter={(l: string) => `Cumulative tokens: ${l}`}
          />
          <Line type="monotone" dataKey="rate" stroke="#8b5cf6" strokeWidth={2} dot={{ r: 4 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

// ─── #18: Pep-talk index ───────────────────────────────────────────────

function PepTalkPanel({ data }: { data: CrazyPayload["pep_talk"] }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <div className="mb-2 flex items-baseline justify-between">
        <h2 className="text-sm font-semibold text-ink">💬 Pep-talk index</h2>
        <span className="text-xs text-slate-500">
          {(data.rate * 100).toFixed(1)}% of {data.total_assistant_msgs.toLocaleString()} msgs
        </span>
      </div>
      <p className="mb-3 text-xs text-slate-500">
        How often the model says encouraging-but-empty things (&quot;perfect&quot;, &quot;great question&quot;,
        &quot;exactly&quot;). High % may mean it&apos;s performing competence rather than demonstrating it.
      </p>
      <ul className="flex flex-col gap-1">
        {data.top_phrases.map((p) => (
          <li
            key={p.phrase}
            className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-3 py-1.5 text-xs dark:bg-slate-800"
          >
            <span className="font-mono text-ink">&ldquo;{p.phrase}&rdquo;</span>
            <span className="text-slate-500 tabular-nums">{p.count.toLocaleString()}x</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── #9: Tool-call transitions ─────────────────────────────────────────

function ToolTransitions({ data }: { data: CrazyPayload["tool_transitions"] }) {
  const max = data.length > 0 ? data[0].count : 1;
  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <h2 className="mb-2 text-sm font-semibold text-ink">🔁 Tool-call transitions</h2>
      <p className="mb-3 text-xs text-slate-500">
        Most common back-to-back tool calls. A→A pairs mean you&apos;re iterating on the same op
        (read, read, read); A→B pairs show real workflows.
      </p>
      <ul className="flex flex-col gap-1.5">
        {data.map((t) => (
          <li key={`${t.from}-${t.to}`} className="text-xs">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="font-mono text-ink">
                {t.from} <span className="text-slate-400">→</span> {t.to}
              </span>
              <span className="text-slate-500 tabular-nums">{t.count.toLocaleString()}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className="h-full rounded-full bg-teal"
                style={{ width: `${(t.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </div>
  );
}

// ─── #5: Cost per LOC kept ─────────────────────────────────────────────

function CostPerLOC({ data }: { data: CrazyPayload["cost_per_loc"] }) {
  const ranked = useMemo(
    () =>
      [...data]
        .filter((r) => r.exists && r.cost_per_loc != null)
        .sort((a, b) => (b.cost_per_loc || 0) - (a.cost_per_loc || 0)),
    [data]
  );
  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <h2 className="mb-2 text-sm font-semibold text-ink">💸 Cost per surviving LOC (rough)</h2>
      <p className="mb-3 text-xs text-slate-500">
        Spend per source line currently on disk in each repo. Imperfect (counts cost that wrote
        no code, ignores deleted lines), but the ratio surfaces repos where you burned tokens
        for little code in return.
      </p>
      <table className="w-full text-xs">
        <thead>
          <tr className="border-b border-line text-left text-[10px] uppercase tracking-wider text-slate-500">
            <th className="py-1.5">Repo</th>
            <th className="py-1.5 text-right">Turns</th>
            <th className="py-1.5 text-right">~Cost</th>
            <th className="py-1.5 text-right">LOC</th>
            <th className="py-1.5 text-right">$/LOC</th>
          </tr>
        </thead>
        <tbody>
          {ranked.length === 0 && (
            <tr>
              <td colSpan={5} className="py-4 text-center text-slate-500">
                No repos with both turns and on-disk LOC.
              </td>
            </tr>
          )}
          {ranked.slice(0, 10).map((r) => (
            <tr key={r.cwd} className="border-b border-line/50">
              <td className="py-1.5 font-mono text-ink" title={r.cwd}>
                {r.cwd_short}
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-600">{r.turns}</td>
              <td className="py-1.5 text-right tabular-nums text-slate-600">
                ${r.cost.toFixed(0)}
              </td>
              <td className="py-1.5 text-right tabular-nums text-slate-600">
                {r.loc.toLocaleString()}
              </td>
              <td className="py-1.5 text-right font-semibold tabular-nums text-coral">
                ${(r.cost_per_loc || 0).toFixed(3)}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ─── #8: Phantom edits ─────────────────────────────────────────────────

function PhantomEdits({ data }: { data: CrazyPayload["phantom_edits"] }) {
  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <h2 className="mb-2 text-sm font-semibold text-ink">👻 Phantom edit graveyard</h2>
      <p className="mb-3 text-xs text-slate-500">
        Files Claude/Codex edited that don&apos;t exist on disk anymore. Renamed, deleted, or
        hallucinated. Sorted by edit count (more edits = more wasted effort).
      </p>
      {data.length === 0 ? (
        <div className="py-6 text-center text-xs text-slate-500">
          No phantom edits found. Either your AIs are tidy, or every edit landed somewhere real.
        </div>
      ) : (
        <ul className="max-h-72 overflow-y-auto text-xs">
          {data.slice(0, 30).map((e) => (
            <li
              key={e.path}
              className="flex items-baseline justify-between gap-2 border-b border-line/40 py-1.5"
            >
              <span className="truncate font-mono text-ink" title={e.path}>
                {e.path.split("/").slice(-2).join("/")}
              </span>
              <span className="shrink-0 text-slate-500 tabular-nums">
                {e.edits} edit{e.edits === 1 ? "" : "s"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// ─── #19: Session replay ───────────────────────────────────────────────

function SessionReplay({ sessions }: { sessions: CrazyPayload["sessions"] }) {
  const [selected, setSelected] = useState<string | null>(null);
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [playing, setPlaying] = useState(false);
  const [cursor, setCursor] = useState(0);
  const [loadingEvents, setLoadingEvents] = useState(false);

  useEffect(() => {
    if (!selected) return;
    setLoadingEvents(true);
    setEvents([]);
    setCursor(0);
    setPlaying(false);
    fetchJson<{ events: ReplayEvent[] }>(`/api/metrics/crazy/replay?session=${encodeURIComponent(selected)}`)
      .then((r) => setEvents(r.events || []))
      .catch(() => setEvents([]))
      .finally(() => setLoadingEvents(false));
  }, [selected]);

  useEffect(() => {
    if (!playing) return;
    if (cursor >= events.length) {
      setPlaying(false);
      return;
    }
    const t = window.setTimeout(() => setCursor((c) => c + 1), 220);
    return () => window.clearTimeout(t);
  }, [playing, cursor, events.length]);

  return (
    <div className="rounded-lg border border-line bg-white p-4 dark:bg-slate-900">
      <h2 className="mb-2 text-sm font-semibold text-ink">🎬 Session replay</h2>
      <p className="mb-3 text-xs text-slate-500">
        Pick a session, hit play, watch the conversation stream by in fast-forward.
      </p>
      <select
        value={selected || ""}
        onChange={(e) => setSelected(e.target.value || null)}
        className="mb-3 w-full rounded-md border border-line bg-white px-2 py-1 text-xs dark:bg-slate-800"
      >
        <option value="">— pick a session —</option>
        {sessions.map((s) => (
          <option key={s.session_id} value={s.session_id}>
            {(s.started_at || "").slice(0, 16).replace("T", " ")} · {s.source} ·{" "}
            {s.cwd ? s.cwd.split("/").slice(-2).join("/") : "(no cwd)"} · {s.turns}t
          </option>
        ))}
      </select>
      {selected && (
        <div className="flex items-center gap-2 text-xs">
          <button
            type="button"
            onClick={() => setPlaying((v) => !v)}
            disabled={loadingEvents || events.length === 0}
            className="rounded-md bg-ink px-3 py-1 font-medium text-white hover:bg-teal disabled:opacity-50"
          >
            {playing ? "⏸ Pause" : "▶ Play"}
          </button>
          <button
            type="button"
            onClick={() => { setPlaying(false); setCursor(0); }}
            className="rounded-md border border-line px-3 py-1 hover:border-teal"
          >
            ⏮ Restart
          </button>
          <button
            type="button"
            onClick={() => { setPlaying(false); setCursor(events.length); }}
            className="rounded-md border border-line px-3 py-1 hover:border-teal"
          >
            ⏭ End
          </button>
          <span className="ml-auto text-slate-500 tabular-nums">
            {cursor} / {events.length}
          </span>
        </div>
      )}
      <div className="mt-3 max-h-80 overflow-y-auto rounded-md border border-line/60 bg-slate-50 p-2 dark:bg-slate-800">
        {!selected ? (
          <p className="py-4 text-center text-xs text-slate-500">Choose a session to start.</p>
        ) : loadingEvents ? (
          <p className="py-4 text-center text-xs text-slate-500">Loading events...</p>
        ) : events.length === 0 ? (
          <p className="py-4 text-center text-xs text-slate-500">
            No replayable events found (older session format).
          </p>
        ) : (
          events.slice(0, cursor).map((e, i) => (
            <div
              key={i}
              className={`mb-2 rounded-md border p-2 text-xs ${
                e.kind === "user"
                  ? "border-teal/40 bg-teal/5"
                  : e.kind === "assistant"
                    ? "border-violet/40 bg-violet/5"
                    : e.kind === "tool"
                      ? "border-amber/40 bg-amber/5"
                      : "border-line bg-white dark:bg-slate-900"
              }`}
            >
              <div className="mb-1 flex items-baseline justify-between text-[10px] uppercase tracking-wider text-slate-500">
                <span>{e.kind}</span>
                <span>{(e.timestamp || "").slice(11, 19)}</span>
              </div>
              <p className="whitespace-pre-wrap break-words text-ink line-clamp-6">{e.text || "(no body)"}</p>
            </div>
          ))
        )}
      </div>
    </div>
  );
}
