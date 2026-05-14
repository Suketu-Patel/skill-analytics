"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import {
  AlertTriangle,
  Brain,
  Check,
  Copy,
  DollarSign,
  Fingerprint,
  Ghost,
  Info,
  MessageCircle,
  Moon,
  Quote,
  Repeat,
} from "lucide-react";
import { fetchJson } from "./fetch-json";

// ─── data shapes ────────────────────────────────────────────────────────

type CrazyPayload = {
  ok: boolean;
  verdict: { sentence: string; parts: string[] };
  frustration: {
    by_hour: { hour: number; total: number; frustrated: number; rate: number }[];
    total_messages: number;
    total_frustrated: number;
    peak_hour: number | null;
    baseline_rate: number;
    takeaway: string | null;
  };
  day_night: {
    by_hour: { hour: number; frustration_rate: number; fail_rate: number }[];
    takeaway: string | null;
    day_avg: { frustration: number; fail: number };
    night_avg: { frustration: number; fail: number };
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
    takeaway: string | null;
  };
  phantom_edits: { path: string; cwd: string | null; edits: number; last_source: string }[];
  tool_transitions: { from: string; to: string; count: number }[];
  pep_talk: {
    total_assistant_msgs: number;
    pep_msgs: number;
    rate: number;
    pep_followed_by_correction: number;
    sycophancy_rate: number;
    top_phrases: { phrase: string; count: number }[];
    takeaway: string | null;
  };
  fingerprint: {
    top_models: { model: string; count: number }[];
    peak_hour: number | null;
    peak_hour_count: number;
    top_project: string | null;
    top_project_turns: number;
    favorite_phrase: { phrase: string; count: number; n: number } | null;
    favorite_phrases: { phrase: string; count: number; n: number }[];
    most_frustrating_phrase: { phrase: string; count: number } | null;
    frustrating_phrases: { phrase: string; count: number }[];
    avg_turns_per_session: number;
    top_correction_phrase: { phrase: string; count: number } | null;
  };
  user_skills_total: number;
};

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
    return (
      <section className="panel p-12 text-center text-sm text-slate-500">
        Mining your transcripts for patterns...
      </section>
    );
  }
  if (err && !data) {
    return <section className="panel p-12 text-center text-sm text-coral">Failed: {err}</section>;
  }
  if (!data) return null;

  return (
    <section className="flex flex-col gap-4">
      <VerdictHero verdict={data.verdict.sentence} />

      <FingerprintCard fp={data.fingerprint} userSkills={data.user_skills_total} />

      {/* Hero panel: the most striking insight. Full-width on every viewport. */}
      <ContextDegradation data={data.context_degradation} />

      <FrustrationCurve data={data.frustration} />

      <DayNightCurve data={data.day_night} />

      <div className="grid gap-4 lg:grid-cols-2">
        <PepTalkPanel data={data.pep_talk} />
        <ToolTransitions data={data.tool_transitions} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <CostPerLOC data={data.cost_per_loc} />
        <PhantomEdits data={data.phantom_edits} />
      </div>
    </section>
  );
}

// ─── Hero verdict (the screenshottable line) ────────────────────────────

function VerdictHero({ verdict }: { verdict: string }) {
  const [copied, setCopied] = useState(false);
  async function copy() {
    try {
      await navigator.clipboard.writeText(verdict);
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1500);
    } catch {
      // best-effort; clipboard not available in some contexts
    }
  }
  return (
    <div className="rounded-lg border-2 border-ink bg-gradient-to-br from-violet/5 via-white to-teal/5 p-6 dark:from-violet/10 dark:via-slate-900 dark:to-teal/10">
      <div className="mb-2 flex items-center justify-between gap-3">
        <span className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
          <Quote size={12} /> Your AI tab, in one line
        </span>
        <button
          type="button"
          onClick={copy}
          title="Copy verdict to clipboard"
          className="inline-flex items-center gap-1 rounded-md border border-line bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-teal hover:text-ink dark:bg-slate-900"
        >
          {copied ? <Check size={12} /> : <Copy size={12} />}
          {copied ? "Copied" : "Copy"}
        </button>
      </div>
      <p className="text-lg font-semibold leading-snug text-ink sm:text-xl">{verdict}</p>
    </div>
  );
}

// ─── AI fingerprint ─────────────────────────────────────────────────────

function FingerprintCard({
  fp,
  userSkills,
}: {
  fp: CrazyPayload["fingerprint"];
  userSkills: number;
}) {
  const peak = fp.peak_hour != null ? `${String(fp.peak_hour).padStart(2, "0")}:00` : "—";
  const projShort = fp.top_project ? fp.top_project.split("/").slice(-2).join("/") : "—";
  return (
    <div className="rounded-lg border border-violet/30 bg-violet/5 p-5">
      <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold uppercase tracking-wider text-violet">
        <Fingerprint size={14} />
        Your fingerprint
        <InfoTip text="Each tile aggregates one column from your imported sessions: Peak hour = hour-of-day with most session starts. Top model = most-used model in your turns. Skills you made = on-disk skills/agents in ~/.claude or ~/.codex (excluding gstack/, plugins/, .system/). Avg turns/session = average turn count across all sessions. Phrase lists at the bottom mine bigrams/trigrams from your short conversational messages, after stripping system markers and learning per-user noise words." />
      </h2>
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <FpStat label="Peak hour" value={peak} sub={`${fp.peak_hour_count} sessions`} />
        <FpStat
          label="Top model"
          value={fp.top_models[0]?.model || "—"}
          sub={fp.top_models[1] ? `then ${fp.top_models[1].model}` : ""}
          mono
        />
        <FpStat label="Skills you made" value={userSkills.toString()} sub="not vendor/plugin" />
        <FpStat
          label="Avg turns / session"
          value={fp.avg_turns_per_session.toString()}
          sub="all sources combined"
        />
        <FpStat label="Most-worked project" value={projShort} sub={`${fp.top_project_turns} turns`} mono />
        <FpStat
          label="Models tried"
          value={fp.top_models.length.toString()}
          sub="distinct lifetime"
        />
        <FpStat
          label="You vs the model"
          value={fp.top_correction_phrase ? `"${fp.top_correction_phrase.phrase}"` : "—"}
          sub={
            fp.top_correction_phrase
              ? `your most-typed pushback (${fp.top_correction_phrase.count.toLocaleString()}x)`
              : ""
          }
          tone="coral"
        />
        <FpStat
          label="Your voice"
          value={fp.favorite_phrase ? `"${fp.favorite_phrase.phrase}"` : "—"}
          sub={
            fp.favorite_phrase
              ? `top conversational phrase (${fp.favorite_phrase.count.toLocaleString()}x)`
              : ""
          }
        />
      </div>
      <div className="mt-4 grid gap-4 sm:grid-cols-2">
        <PhraseList
          label="Things you say"
          tone="default"
          items={fp.favorite_phrases.map((p) => ({ text: p.phrase, count: p.count }))}
          emptyText="not enough signal yet"
        />
        <PhraseList
          label="Things you say when annoyed"
          tone="coral"
          items={fp.frustrating_phrases.map((p) => ({ text: p.phrase, count: p.count }))}
          emptyText="zero frustration detected (suspicious)"
        />
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
      <div className="text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
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

function PhraseList({
  label,
  items,
  tone = "default",
  emptyText,
}: {
  label: string;
  items: { text: string; count: number }[];
  tone?: "default" | "coral";
  emptyText: string;
}) {
  const accent = tone === "coral" ? "text-coral" : "text-ink";
  return (
    <div className="rounded-md bg-white/60 p-3 dark:bg-slate-900/40">
      <div className="mb-2 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
        {label}
      </div>
      {items.length === 0 ? (
        <p className="text-xs italic text-slate-500">{emptyText}</p>
      ) : (
        <ol className="flex flex-col gap-1">
          {items.map((it, i) => (
            <li
              key={`${it.text}-${i}`}
              className="flex items-baseline justify-between gap-2 text-xs"
            >
              <span className="flex items-baseline gap-1.5 truncate">
                <span className="text-[10px] tabular-nums text-slate-400">{i + 1}.</span>
                <span className={`truncate font-mono font-semibold ${accent}`}>
                  &ldquo;{it.text}&rdquo;
                </span>
              </span>
              <span className="shrink-0 tabular-nums text-slate-500">
                {it.count.toLocaleString()}x
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

// ─── shared panel chrome ───────────────────────────────────────────────

// Small "i" button that toggles a popover with the metric's
// calculation method. Plain language, short, no jargon. Click anywhere
// outside the popover to dismiss; Esc-handler at parent level closes
// modals + scopes so we don't fight with that here.
function InfoTip({ text }: { text: string }) {
  const [open, setOpen] = useState(false);
  return (
    <span className="relative inline-flex">
      <button
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        title="How this is calculated"
        aria-label="How this is calculated"
        className="inline-flex h-5 w-5 items-center justify-center rounded-full border border-line text-slate-500 hover:border-teal hover:text-ink"
      >
        <Info size={11} />
      </button>
      {open && (
        <>
          <button
            type="button"
            aria-label="Dismiss"
            onClick={() => setOpen(false)}
            className="fixed inset-0 z-40 cursor-default bg-transparent"
          />
          <div
            className="absolute left-0 top-7 z-50 w-72 rounded-md border border-line bg-white p-3 text-[11px] leading-snug text-slate-600 shadow-lg dark:bg-slate-900 dark:text-slate-300"
          >
            <div className="mb-1 text-[9px] font-semibold uppercase tracking-wider text-slate-400">
              How this is calculated
            </div>
            {text}
          </div>
        </>
      )}
    </span>
  );
}

function PanelHeader({
  Icon,
  title,
  takeaway,
  right,
  tone = "default",
  info,
}: {
  Icon: typeof Brain;
  title: string;
  takeaway?: string | null;
  right?: React.ReactNode;
  tone?: "default" | "coral" | "violet";
  info?: string;
}) {
  const accent =
    tone === "coral" ? "text-coral" : tone === "violet" ? "text-violet" : "text-slate-500";
  return (
    <div className="mb-3">
      <div className="flex items-baseline justify-between gap-2">
        <h2 className={`flex items-center gap-1.5 text-sm font-semibold text-ink`}>
          <Icon size={14} className={accent} />
          {title}
          {info && <InfoTip text={info} />}
        </h2>
        {right && <span className="text-xs text-slate-500">{right}</span>}
      </div>
      {takeaway && (
        <p
          className={`mt-1.5 text-sm leading-snug ${
            tone === "coral" ? "text-coral" : "text-ink"
          }`}
        >
          {takeaway}
        </p>
      )}
    </div>
  );
}

function Panel({
  tone = "default",
  children,
}: {
  tone?: "default" | "coral" | "violet";
  children: React.ReactNode;
}) {
  const border =
    tone === "coral"
      ? "border-coral/30 bg-coral/5"
      : tone === "violet"
        ? "border-violet/30 bg-violet/5"
        : "border-line bg-white dark:bg-slate-900";
  return <div className={`rounded-lg border p-4 ${border}`}>{children}</div>;
}

// ─── #6: Context degradation (HERO panel) ──────────────────────────────

function ContextDegradation({ data }: { data: CrazyPayload["context_degradation"] }) {
  const chart = data.by_band.map((b) => ({
    band: b.band,
    rate: Math.round(b.rate * 1000) / 10,
    turns: b.turns,
  }));
  const worst = [...data.by_band].sort((a, b) => b.rate - a.rate)[0];
  const tone =
    worst && worst.rate >= 0.5 ? "coral" : worst && worst.rate >= 0.3 ? "violet" : "default";
  return (
    <Panel tone={tone}>
      <PanelHeader
        Icon={Brain}
        title="Where the model loses you"
        takeaway={data.takeaway}
        tone={tone}
        right={`peak ${worst?.band ?? "—"} at ${Math.round((worst?.rate || 0) * 100)}%`}
        info="For every turn in a session, we add up tokens consumed so far. Then we check if you sent a 'no', 'wrong', 'actually', 'fix this', or similar message within 5 minutes after. We bucket turns by total tokens at that point and compute the correction rate per bucket. Rising line = longer sessions hurt your trust in the model."
      />
      <ResponsiveContainer width="100%" height={260}>
        <LineChart data={chart} margin={{ top: 10, right: 18, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="band" tick={{ fontSize: 11 }} />
          <YAxis tick={{ fontSize: 11 }} unit="%" />
          <Tooltip
            formatter={(v: number, _name, item) => [`${v}%`, `${item?.payload?.turns} turns`]}
            labelFormatter={(l: string) => `Cumulative tokens in session: ${l}`}
          />
          {/* 30% reference line as a "things-are-getting-rough" marker */}
          <ReferenceLine y={30} stroke="#94a3b8" strokeDasharray="4 4" label={{ value: "30%", position: "right", fontSize: 10, fill: "#64748b" }} />
          <Line
            type="monotone"
            dataKey="rate"
            stroke={tone === "coral" ? "#f43f5e" : "#8b5cf6"}
            strokeWidth={2.5}
            dot={{ r: 5 }}
          />
        </LineChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ─── #2: Frustration curve by hour ─────────────────────────────────────

function FrustrationCurve({ data }: { data: CrazyPayload["frustration"] }) {
  const chart = data.by_hour.map((b) => ({
    hour: String(b.hour).padStart(2, "0"),
    rate: Math.round(b.rate * 1000) / 10,
    total: b.total,
    isPeak: b.hour === data.peak_hour,
  }));
  const overall = data.total_messages > 0 ? (data.total_frustrated / data.total_messages) * 100 : 0;
  return (
    <Panel>
      <PanelHeader
        Icon={AlertTriangle}
        title="When you push back hardest"
        takeaway={data.takeaway}
        right={`${overall.toFixed(1)}% baseline · ${data.total_frustrated.toLocaleString()} corrections in ${data.total_messages.toLocaleString()} msgs`}
        info="We scan every user message for pushback words: 'no', 'wrong', 'actually', 'stop', 'undo', plus profanity ('fuck', 'wtf', 'ugh', etc.). Each message gets bucketed by the hour-of-day it was sent. Bar height = corrections divided by total messages that hour. The dashed baseline = your overall correction rate across all hours."
      />
      <ResponsiveContainer width="100%" height={220}>
        <BarChart data={chart} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
          <YAxis tick={{ fontSize: 10 }} unit="%" />
          <Tooltip
            formatter={(v: number, _n, item) => [`${v}%`, `${item?.payload?.total} msgs`]}
            labelFormatter={(l: string) => `Hour: ${l}`}
          />
          <ReferenceLine
            y={Math.round(overall * 10) / 10}
            stroke="#94a3b8"
            strokeDasharray="4 4"
            label={{ value: "baseline", position: "right", fontSize: 10, fill: "#64748b" }}
          />
          <Bar dataKey="rate" radius={[4, 4, 0, 0]}>
            {chart.map((row) => (
              <Cell key={row.hour} fill={row.isPeak ? "#f43f5e" : "#fb7185"} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </Panel>
  );
}

// ─── Day vs night: frustration AND outcome ─────────────────────────────

function DayNightCurve({ data }: { data: CrazyPayload["day_night"] }) {
  const chart = data.by_hour.map((b) => ({
    hour: String(b.hour).padStart(2, "0"),
    you: Math.round(b.frustration_rate * 1000) / 10,
    model: Math.round(b.fail_rate * 1000) / 10,
  }));
  return (
    <Panel>
      <PanelHeader
        Icon={Moon}
        title="Day vs night: you and the model"
        takeaway={data.takeaway}
        info="Two lines, same hour-of-day axis. Coral line = your frustration rate (% of your messages that contain pushback words). Teal line = tool-failure rate (% of AI tool calls that returned a non-zero exit code). Compare shapes: if both rise at night, late hours hurt both of you. If only one rises, tiredness and AI quality are decoupled."
        right={`night vs day · you: ${data.day_avg.frustration > 0 ? Math.round(((data.night_avg.frustration - data.day_avg.frustration) / data.day_avg.frustration) * 100) : 0}% · model: ${data.day_avg.fail > 0 ? Math.round(((data.night_avg.fail - data.day_avg.fail) / data.day_avg.fail) * 100) : 0}%`}
      />
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chart} margin={{ top: 10, right: 16, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
          <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
          <YAxis tick={{ fontSize: 10 }} unit="%" />
          <Tooltip
            formatter={(v: number, name: string) => [`${v}%`, name === "you" ? "Your frustration" : "Tool failure"]}
            labelFormatter={(l: string) => `Hour ${l}`}
          />
          <Line type="monotone" dataKey="you" stroke="#f43f5e" strokeWidth={2} dot={{ r: 3 }} name="you" />
          <Line type="monotone" dataKey="model" stroke="#14b8a6" strokeWidth={2} dot={{ r: 3 }} name="model" />
        </LineChart>
      </ResponsiveContainer>
      <div className="mt-2 flex items-center gap-4 text-[11px] text-slate-500">
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-coral" /> your frustration
        </span>
        <span className="flex items-center gap-1.5">
          <span className="inline-block h-2 w-3 rounded-sm bg-teal" /> tool-failure rate
        </span>
      </div>
    </Panel>
  );
}

// ─── #18: Pep-talk + sycophancy ────────────────────────────────────────

function PepTalkPanel({ data }: { data: CrazyPayload["pep_talk"] }) {
  const sycoBad = data.sycophancy_rate >= 0.15;
  return (
    <Panel tone={sycoBad ? "coral" : "default"}>
      <PanelHeader
        Icon={MessageCircle}
        title="Performance vs delivery"
        takeaway={data.takeaway}
        tone={sycoBad ? "coral" : "default"}
        right={`${(data.rate * 100).toFixed(1)}% pep-talk · ${(data.sycophancy_rate * 100).toFixed(0)}% then corrected`}
        info="We scan assistant messages for confidence-but-empty phrases: 'perfect', 'great question', 'exactly', 'I see what's happening', 'happy to', etc. Pep-talk rate = pep-talked messages divided by total assistant messages. Sycophancy rate = of those pep-talked turns, how many were followed by a user correction within 5 minutes. High = the model performs competence rather than delivering it."
      />
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
    </Panel>
  );
}

// ─── #9: Tool transitions ──────────────────────────────────────────────

function ToolTransitions({ data }: { data: CrazyPayload["tool_transitions"] }) {
  const max = data.length > 0 ? data[0].count : 1;
  const iteration = (t: { from: string; to: string }) => t.from === t.to;
  return (
    <Panel>
      <PanelHeader
        Icon={Repeat}
        title="Your AI workflow shape"
        takeaway={"A→A pairs are iteration on one op; A→B pairs show real workflows. Both shapes show up here."}
        info="For every tool call your AI made, we look at what tool ran next in the same turn (Edit, Read, Bash, etc.). Each pair like 'Read → Edit' gets a count. Amber arrows = same-tool iteration (you're poking at one thing). Teal arrows = cross-tool moves (real workflows like Read then Edit then Bash)."
      />
      <ul className="flex flex-col gap-1.5">
        {data.slice(0, 12).map((t) => (
          <li key={`${t.from}-${t.to}`} className="text-xs">
            <div className="mb-0.5 flex items-baseline justify-between gap-2">
              <span className="font-mono text-ink">
                {t.from} <span className={iteration(t) ? "text-amber" : "text-teal"}>→</span> {t.to}
              </span>
              <span className="text-slate-500 tabular-nums">{t.count.toLocaleString()}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-slate-100 dark:bg-slate-800">
              <div
                className={`h-full rounded-full ${iteration(t) ? "bg-amber" : "bg-teal"}`}
                style={{ width: `${(t.count / max) * 100}%` }}
              />
            </div>
          </li>
        ))}
      </ul>
    </Panel>
  );
}

// ─── #5: Cost per LOC ──────────────────────────────────────────────────

function CostPerLOC({ data }: { data: CrazyPayload["cost_per_loc"] }) {
  const ranked = useMemo(
    () =>
      [...data]
        .filter((r) => r.exists && r.cost_per_loc != null)
        .sort((a, b) => (b.cost_per_loc || 0) - (a.cost_per_loc || 0)),
    [data]
  );
  const worst = ranked[0];
  return (
    <Panel>
      <PanelHeader
        Icon={DollarSign}
        title="What each line of code cost"
        takeaway={
          worst
            ? `Most expensive line you kept: $${(worst.cost_per_loc || 0).toFixed(3)} in ${worst.cwd_short}. Rough math, ignores deleted lines.`
            : null
        }
        info="For each repo (cwd) where you ran AI sessions, we sum up the billable tokens and approximate the dollar cost. Then we walk the repo on disk and count current source-code lines (.ts, .py, .go, etc., skipping node_modules + .git). Cost ÷ LOC = the approximate price tag on each line still living in your codebase. Imperfect: it includes time you spent thinking, debugging, exploring, and doesn't track AI-vs-human authorship line-by-line."
      />
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
          {ranked.slice(0, 8).map((r) => (
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
    </Panel>
  );
}

// ─── #8: Phantom edits ─────────────────────────────────────────────────

function PhantomEdits({ data }: { data: CrazyPayload["phantom_edits"] }) {
  return (
    <Panel>
      <PanelHeader
        Icon={Ghost}
        title="Files the AI wrote, then ghosted"
        takeaway={
          data.length > 0
            ? `${data.length} file${data.length === 1 ? "" : "s"} the AI edited that no longer exist on disk. Renamed, deleted, or hallucinated.`
            : "Either your AIs are tidy or every edit landed somewhere real."
        }
        info="From every Edit / Write / apply_patch / MultiEdit tool call your AI made, we extract the file path. Then we run fs.existsSync() against your actual disk today. Files that no longer exist appear here, sorted by edit count. Could mean: file was renamed (no link tracking), deleted later, or the AI hallucinated a path that never landed."
      />
      {data.length === 0 ? null : (
        <ul className="max-h-72 overflow-y-auto text-xs">
          {data.slice(0, 16).map((e) => (
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
    </Panel>
  );
}
