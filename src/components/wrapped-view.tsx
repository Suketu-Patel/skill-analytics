"use client";

import { useEffect, useMemo, useState } from "react";

// ─── data shapes ────────────────────────────────────────────────────────

type CompareTotals = {
  turns: number;
  skill_events: number;
  tool_calls: number;
  tool_failed: number;
  errors: number;
  total_tokens: number;
};
type CompareSource = { source: "claude" | "codex"; totals?: CompareTotals };
type CompareData = { sources?: CompareSource[] };

type CostHeadline = {
  spend_total: number;
  sessions_total: number;
  active_days: number;
  tokens_total: number;
  tokens_billable: number;
  tokens_cached: number;
  cache_hit_rate: number;
  cache_savings: number;
  avg_session_cost: number;
  most_expensive_day: { day: string; cost: number } | null;
  source_split: { claude: number; codex: number };
  source_billable_tokens: { claude: number; codex: number };
  source_sessions: { claude: number; codex: number };
  latest_day: string | null;
};
type ByModel = { source: string; model: string; sessions: number; tokens_total: number; cost: number; pct_of_total: number };
type ByProject = { cwd: string; cwd_short: string; sessions: number; cost: number; tokens: number };
type Burn = { day: string; cost: number; multiple: number };

type CostPayload = {
  ok: boolean;
  headline: CostHeadline;
  byModel: ByModel[];
  byProject: ByProject[];
  burnAlerts: Burn[];
};

type FunFacts = { ok: boolean; facts?: string[] };

// ─── formatters ─────────────────────────────────────────────────────────

const num = (n: number) => n.toLocaleString();
const usd = (n: number) =>
  n >= 1000 ? `$${Math.round(n).toLocaleString()}` : `$${n.toFixed(2)}`;

// ─── brand logos (copy from dashboard-client so this view is standalone) */

function ClaudeLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-label="Claude">
      <path d="M11.376 24L10.776 23.544L10.44 22.8L10.776 21.312L11.16 19.392L11.472 17.856L11.76 15.96L11.928 15.336L11.904 15.288L11.784 15.312L10.344 17.28L8.16 20.232L6.432 22.056L6.024 22.224L5.304 21.864L5.376 21.192L5.784 20.616L8.16 17.568L9.6 15.672L10.536 14.592L10.512 14.448H10.464L4.128 18.576L3 18.72L2.496 18.264L2.568 17.52L2.808 17.28L4.704 15.96L9.432 13.32L9.504 13.08L9.432 12.96H9.192L8.4 12.912L5.712 12.84L3.384 12.744L1.104 12.624L0.528 12.504L0 11.784L0.048 11.424L0.528 11.112L1.224 11.16L2.736 11.28L5.016 11.424L6.672 11.52L9.12 11.784H9.504L9.552 11.616L9.432 11.52L9.336 11.424L6.96 9.84L4.416 8.16L3.072 7.176L2.352 6.672L1.992 6.216L1.848 5.208L2.496 4.488L3.384 4.56L3.6 4.608L4.488 5.304L6.384 6.768L8.88 8.616L9.24 8.904L9.408 8.808V8.736L9.24 8.472L7.896 6.024L6.456 3.528L5.808 2.496L5.64 1.872C5.576 1.656 5.544 1.416 5.544 1.152L6.288 0.144001L6.696 0L7.704 0.144001L8.112 0.504001L8.736 1.92L9.72 4.152L11.28 7.176L11.736 8.088L11.976 8.904L12.072 9.168H12.24V9.024L12.36 7.296L12.6 5.208L12.84 2.52L12.912 1.752L13.296 0.840001L14.04 0.360001L14.616 0.624001L15.096 1.32L15.024 1.752L14.76 3.6L14.184 6.504L13.824 8.472H14.04L14.28 8.208L15.264 6.912L16.92 4.848L17.64 4.032L18.504 3.12L19.056 2.688H20.088L20.832 3.816L20.496 4.992L19.44 6.336L18.552 7.464L17.28 9.168L16.512 10.536L16.584 10.632H16.752L19.608 10.008L21.168 9.744L22.992 9.432L23.832 9.816L23.928 10.2L23.592 11.016L21.624 11.496L19.32 11.952L15.888 12.768L15.84 12.792L15.888 12.864L17.424 13.008L18.096 13.056H19.728L22.752 13.272L23.544 13.8L24 14.424L23.928 14.928L22.704 15.528L21.072 15.144L17.232 14.232L15.936 13.92H15.744V14.016L16.848 15.096L18.84 16.896L21.36 19.224L21.48 19.8L21.168 20.28L20.832 20.232L18.624 18.552L17.76 17.808L15.84 16.2H15.72V16.368L16.152 17.016L18.504 20.544L18.624 21.624L18.456 21.96L17.832 22.176L17.184 22.056L15.792 20.136L14.376 17.952L13.224 16.008L13.104 16.104L12.408 23.352L12.096 23.712L11.376 24Z" />
    </svg>
  );
}
function CodexLogo({ size = 22 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="currentColor" aria-label="Codex (OpenAI)">
      <path d="M21.07 10.32a5.34 5.34 0 0 0-.46-4.39 5.41 5.41 0 0 0-5.82-2.59 5.4 5.4 0 0 0-9.16 1.96 5.4 5.4 0 0 0-3.61 2.62 5.4 5.4 0 0 0 .66 6.34 5.4 5.4 0 0 0 .46 4.4 5.4 5.4 0 0 0 5.82 2.6 5.4 5.4 0 0 0 9.16-1.97 5.4 5.4 0 0 0 3.61-2.62 5.4 5.4 0 0 0-.66-6.34Zm-8.06 11.27a4 4 0 0 1-2.57-.93l.13-.07 4.27-2.46a.7.7 0 0 0 .35-.6v-6.02l1.81 1.04c.02.01.03.03.04.05v4.98c0 2.21-1.81 4.01-4.03 4.01ZM4.35 17.85a4 4 0 0 1-.48-2.7l.13.08 4.27 2.46c.21.13.48.13.7 0l5.21-3v2.08c0 .02 0 .04-.03.06l-4.31 2.48a4.02 4.02 0 0 1-5.49-1.46Zm-1.13-9.4a4 4 0 0 1 2.11-1.77v5.06c0 .24.13.46.34.59l5.2 3-1.81 1.04a.06.06 0 0 1-.06 0L4.69 13.9a4.02 4.02 0 0 1-1.47-5.45Zm14.83 3.45-5.21-3.01 1.81-1.04a.06.06 0 0 1 .06 0l4.32 2.48a4.02 4.02 0 0 1-.62 7.25v-5.07c0-.24-.13-.46-.36-.6Zm1.8-2.7-.13-.07-4.26-2.49a.7.7 0 0 0-.7 0L9.55 9.65V7.57c0-.02 0-.04.02-.06l4.32-2.48a4.02 4.02 0 0 1 5.97 4.16Zm-11.3 3.71L6.74 11.86a.07.07 0 0 1-.04-.05V6.83a4.02 4.02 0 0 1 6.59-3.08l-.13.07-4.27 2.46a.7.7 0 0 0-.35.6l-.01 6.01Zm.98-2.12L11.85 9.4l2.33 1.34v2.69l-2.33 1.34-2.32-1.34Z" />
    </svg>
  );
}

// ─── anonymization ──────────────────────────────────────────────────────

function anonProjects(projects: ByProject[]): Map<string, string> {
  const map = new Map<string, string>();
  projects
    .slice()
    .sort((a, b) => b.cost - a.cost)
    .forEach((p, i) => {
      const letter =
        i < 26 ? String.fromCharCode(65 + i) : `A${String.fromCharCode(65 + (i - 26))}`;
      map.set(p.cwd, `Project ${letter}`);
    });
  return map;
}

// ─── main ───────────────────────────────────────────────────────────────

export default function WrappedView({ filterQS }: { filterQS: string }) {
  const [cost, setCost] = useState<CostPayload | null>(null);
  const [comparison, setComparison] = useState<CompareData | null>(null);
  const [funFacts, setFunFacts] = useState<FunFacts | null>(null);
  const [loading, setLoading] = useState(true);
  const [anonymize, setAnonymize] = useState(true);

  useEffect(() => {
    setLoading(true);
    const qs = filterQS ? `?${filterQS}` : "";
    const wrappedPromise = filterQS
      ? Promise.all([
          fetch(`/api/metrics/cost-overview${qs}`).then((r) => r.json()),
          fetch(`/api/metrics/comparison${qs}`).then((r) => r.json()),
        ]).then(([c, cmp]) => ({ ok: true, cost_overview: c, comparison: cmp }))
      : fetch(`/api/metrics/wrapped`).then((r) => r.json());

    Promise.all([
      wrappedPromise,
      fetch(`/api/metrics/fun-facts${qs}`).then((r) => r.json()),
    ])
      .then(([snap, fun]) => {
        if (snap?.ok) {
          // Be lenient about what counts as "loaded": as long as a
          // headline exists, render. The legacy `.ok` check on each
          // sub-payload silently rejected cached snapshots whose
          // inner objects don't carry the envelope flag.
          const co = snap.cost_overview;
          if (co?.headline) setCost(co);
          setComparison(snap.comparison || null);
        }
        setFunFacts(fun);
      })
      .finally(() => setLoading(false));
  }, [filterQS]);

  const projAnon = useMemo(
    () => (cost ? anonProjects(cost.byProject) : new Map<string, string>()),
    [cost]
  );
  const projectLabel = (cwd: string, fallback: string) =>
    anonymize ? projAnon.get(cwd) || "Project ?" : fallback;

  if (loading && !cost) {
    return <section className="panel p-12 text-center text-sm text-slate-500">Loading…</section>;
  }
  if (!cost) {
    return (
      <section className="panel p-12 text-center text-sm text-slate-500">
        No data. Run Import first.
      </section>
    );
  }

  const claudeT = comparison?.sources?.find((s) => s.source === "claude")?.totals;
  const codexT = comparison?.sources?.find((s) => s.source === "codex")?.totals;
  const h = cost.headline;
  const claudeSpend = h.source_split?.claude || 0;
  const codexSpend = h.source_split?.codex || 0;

  const topModel = cost.byModel[0];
  const topProject = cost.byProject[0];
  const worstBurn =
    cost.burnAlerts[0] ||
    (h.most_expensive_day
      ? { day: h.most_expensive_day.day, cost: h.most_expensive_day.cost, multiple: 0 }
      : null);

  return (
    <section className="flex flex-col gap-5">
      {/* header strip with anonymize toggle */}
      <div className="flex flex-wrap items-center justify-between gap-3 rounded-md border border-line bg-white px-4 py-3">
        <div>
          <h1 className="text-lg font-semibold text-ink">
            Your AI usage
            {h.latest_day && (
              <span className="ml-2 text-sm font-normal text-slate-500">
                · ending {h.latest_day}
              </span>
            )}
          </h1>
          <p className="text-xs text-slate-500">
            {h.active_days} active days · screenshot any card to share.
          </p>
        </div>
        <label className="flex cursor-pointer items-center gap-2 text-xs text-slate-600">
          <input
            type="checkbox"
            checked={anonymize}
            onChange={(e) => setAnonymize(e.target.checked)}
            className="h-4 w-4"
          />
          Anonymize project names
        </label>
      </div>

      {/* ─── HERO: side-by-side Codex / Claude cards ──────────────
          Tokens shown here are BILLABLE (fresh input + output +
          reasoning), pulled from cost-overview. The cached-token volume
          is reported by the provider but priced separately and would
          otherwise dominate the headline number. */}
      <div className="grid gap-4 lg:grid-cols-2">
        <SourceCard
          source="codex"
          logo={<CodexLogo size={22} />}
          label="Codex"
          sessions={h.source_sessions?.codex ?? codexT?.turns ?? 0}
          toolCalls={codexT?.tool_calls ?? 0}
          errors={codexT?.errors ?? 0}
          tokens={h.source_billable_tokens?.codex ?? 0}
          spend={codexSpend}
        />
        <SourceCard
          source="claude"
          logo={<ClaudeLogo size={22} />}
          label="Claude"
          sessions={h.source_sessions?.claude ?? claudeT?.turns ?? 0}
          toolCalls={claudeT?.tool_calls ?? 0}
          errors={claudeT?.errors ?? 0}
          tokens={h.source_billable_tokens?.claude ?? 0}
          spend={claudeSpend}
        />
      </div>

      {/* ─── secondary highlight cards ──────────────────────────── */}
      <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <HighlightCard
          accent="emerald"
          label="Cache savings"
          big={usd(h.cache_savings)}
          sub={`${(h.cache_hit_rate * 100).toFixed(1)}% hit rate`}
        />
        <HighlightCard
          accent="rose"
          label="Worst burn day"
          big={worstBurn ? usd(worstBurn.cost) : "—"}
          sub={worstBurn ? `${worstBurn.day}${worstBurn.multiple ? ` · ${worstBurn.multiple.toFixed(1)}× median` : ""}` : "no outliers"}
        />
        <HighlightCard
          accent="violet"
          label="Top model"
          big={topModel ? topModel.model : "—"}
          sub={topModel ? `${usd(topModel.cost)} · ${topModel.sessions} sessions` : ""}
        />
        <HighlightCard
          accent="amber"
          label="Top project"
          big={topProject ? projectLabel(topProject.cwd, topProject.cwd_short) : "—"}
          sub={topProject ? `${usd(topProject.cost)} · ${topProject.sessions} sessions` : ""}
          mono
        />
      </div>

      {/* ─── overall totals card (one more screenshot) ──────────── */}
      <div className="rounded-lg border border-line bg-white p-5">
        <div className="mb-4 flex items-baseline justify-between">
          <h2 className="text-sm font-semibold uppercase tracking-wider text-slate-500">
            Overall
          </h2>
          <span className="text-xs text-slate-400">Cost + tokens combined across sources</span>
        </div>
        <div className="grid gap-x-6 gap-y-3 sm:grid-cols-2 lg:grid-cols-4">
          <BigStat label="Total spend" value={usd(h.spend_total)} />
          <BigStat label="Sessions" value={num(h.sessions_total)} />
          <BigStat label="Billable tokens" value={num(h.tokens_billable)} muted />
          <BigStat
            label="Avg / session"
            value={`$${h.avg_session_cost.toFixed(3)}`}
          />
        </div>
      </div>

      {/* ─── single sarcastic line — small, not boxed ──────────── */}
      {funFacts?.facts?.[0] && (
        <p className="px-2 text-center text-sm italic text-slate-500">
          <span className="mr-1 not-italic">✨</span>
          {funFacts.facts[0]}
        </p>
      )}

      {/* tiny footer */}
      <div className="rounded-md border border-line bg-slate-50 px-4 py-2 text-center text-[11px] text-slate-500">
        Generated by{" "}
        <a
          href="https://github.com/Suketu-Patel/skill-analytics"
          className="font-mono text-teal hover:underline"
        >
          github.com/Suketu-Patel/skill-analytics
        </a>
        {" "}— local-only · your data never leaves this machine
      </div>
    </section>
  );
}

// ─── sub-components matching the reference design ───────────────────────

/**
 * Hero card mirroring the v1 hit screenshot: brand logo + name in a tinted
 * top strip with a colored underline bar, then a 2x3 grid of bold tabular
 * stats. ERRORS shown in coral. SPEND added as the new headline figure.
 */
function SourceCard({
  source,
  logo,
  label,
  sessions,
  toolCalls,
  errors,
  tokens,
  spend,
}: {
  source: "claude" | "codex";
  logo: React.ReactNode;
  label: string;
  sessions: number;
  toolCalls: number;
  errors: number;
  tokens: number;
  spend: number;
}) {
  // Same palette as the rest of the app for source identity:
  // claude = warm peach, codex = neutral slate.
  const head =
    source === "claude"
      ? "bg-orange-50 border-orange-200"
      : "bg-slate-100 border-slate-200";
  const bar = source === "claude" ? "bg-orange-500" : "bg-slate-900";
  const iconBg =
    source === "claude" ? "bg-orange-500 text-white" : "bg-slate-900 text-white";
  const labelColor = source === "claude" ? "text-orange-700" : "text-slate-900";

  return (
    <div className="overflow-hidden rounded-lg border border-line bg-white shadow-sm">
      {/* tinted header strip + brand */}
      <div className={`flex items-center justify-between border-b ${head} px-5 py-3`}>
        <div className="flex items-center gap-3">
          <span className={`inline-flex h-8 w-8 items-center justify-center rounded-md ${iconBg}`}>
            {logo}
          </span>
          <span className={`text-xl font-bold ${labelColor}`}>{label}</span>
        </div>
        <span className={`h-1 w-12 rounded-full ${bar}`} />
      </div>
      {/* 2x3 stat grid */}
      <div className="grid grid-cols-2 gap-x-6 gap-y-4 px-5 py-5">
        <CardStat label="Sessions" value={num(sessions)} />
        <CardStat label="Tool Calls" value={num(toolCalls)} />
        <CardStat label="Errors" value={num(errors)} tone={errors > 0 ? "coral" : "muted"} />
        <CardStat label="Tokens" value={num(tokens)} />
        <CardStat label="Spend" value={usd(spend)} tone="bold" />
        <CardStat
          label="Avg / session"
          value={sessions > 0 ? `$${(spend / sessions).toFixed(3)}` : "—"}
          tone="muted"
        />
      </div>
    </div>
  );
}

function CardStat({
  label,
  value,
  tone = "default",
}: {
  label: string;
  value: string;
  tone?: "default" | "coral" | "muted" | "bold";
}) {
  const valueClass =
    tone === "coral"
      ? "text-coral"
      : tone === "muted"
      ? "text-slate-500"
      : tone === "bold"
      ? "text-ink"
      : "text-ink";
  const fontWeight = tone === "bold" ? "font-bold" : "font-semibold";
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div className={`mt-0.5 text-xl tabular-nums ${fontWeight} ${valueClass}`}>{value}</div>
    </div>
  );
}

function HighlightCard({
  accent,
  label,
  big,
  sub,
  mono = false,
}: {
  accent: "emerald" | "rose" | "violet" | "amber";
  label: string;
  big: string;
  sub?: string;
  mono?: boolean;
}) {
  const palette = {
    emerald: { bar: "bg-emerald-500", text: "text-emerald-700", bg: "bg-emerald-50 border-emerald-100" },
    rose:    { bar: "bg-rose-500",    text: "text-rose-700",    bg: "bg-rose-50 border-rose-100" },
    violet:  { bar: "bg-violet-500",  text: "text-violet-700",  bg: "bg-violet-50 border-violet-100" },
    amber:   { bar: "bg-amber-500",   text: "text-amber-700",   bg: "bg-amber-50 border-amber-100" },
  }[accent];

  return (
    <div className={`overflow-hidden rounded-lg border ${palette.bg}`}>
      <div className={`h-1 w-full ${palette.bar}`} />
      <div className="p-4">
        <div className={`text-[11px] font-medium uppercase tracking-wider ${palette.text}`}>
          {label}
        </div>
        <div
          className={`mt-1 break-words text-xl font-bold tabular-nums text-slate-900 ${
            mono ? "font-mono text-base" : ""
          }`}
          title={big}
        >
          {big}
        </div>
        {sub && <div className="mt-0.5 text-xs text-slate-500">{sub}</div>}
      </div>
    </div>
  );
}

function BigStat({
  label,
  value,
  muted = false,
}: {
  label: string;
  value: string;
  muted?: boolean;
}) {
  return (
    <div>
      <div className="text-[11px] font-medium uppercase tracking-wider text-slate-500">
        {label}
      </div>
      <div
        className={`mt-0.5 text-2xl font-bold tabular-nums ${
          muted ? "text-slate-700" : "text-ink"
        }`}
      >
        {value}
      </div>
    </div>
  );
}
