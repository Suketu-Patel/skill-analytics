"use client";

import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  Cell,
  CartesianGrid,
  Legend,
  Pie,
  PieChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { useChartDateBrush } from "./use-chart-date-brush";

// ─── data shapes ─────────────────────────────────────────────────────────

type Headline = {
  spend_total: number;
  spend_today: number;
  spend_7d: number;
  spend_30d: number;
  sessions_total: number;
  active_days: number;
  tokens_input: number;
  tokens_cached: number;
  tokens_output: number;
  tokens_reasoning: number;
  tokens_billable: number;
  tokens_total: number;
  cache_hit_rate: number;
  cache_savings: number;
  avg_session_cost: number;
  most_expensive_day: { day: string; cost: number } | null;
  median_daily_cost: number;
  overlap_days: number;
  claude_only_days: number;
  codex_only_days: number;
  source_split: { claude: number; codex: number };
  latest_day: string | null;
};

type ByDay = {
  day: string;
  cost: number;
  cost_input: number;
  cost_cached: number;
  cost_output: number;
  tokens_input: number;
  tokens_cached: number;
  tokens_output: number;
  tokens_reasoning: number;
  sessions: number;
};

type ByModel = {
  source: string;
  model: string;
  sessions: number;
  tokens_total: number;
  cost: number;
  pct_of_total: number;
};

type ByProject = {
  cwd: string;
  cwd_short: string;
  sessions: number;
  cost: number;
  tokens: number;
};

type ByHour = { hour: number; sessions: number; cost: number; tokens: number };
type ByDow = { dow: number; label: string; sessions: number; cost: number };

type TopSession = {
  turn_id: string;
  source: string;
  model: string;
  cwd: string;
  cwd_short: string;
  started_at: string | null;
  duration_ms: number | null;
  cost: number;
  tokens_total: number;
};

type Burn = { day: string; cost: number; multiple: number };

type Payload = {
  ok: boolean;
  headline: Headline;
  byDay: ByDay[];
  byModel: ByModel[];
  byProject: ByProject[];
  byHour: ByHour[];
  byDayOfWeek: ByDow[];
  topSessions: TopSession[];
  burnAlerts: Burn[];
};

// ─── formatters ──────────────────────────────────────────────────────────

const usd = (n: number) =>
  n >= 100
    ? `$${Math.round(n).toLocaleString()}`
    : n >= 1
    ? `$${n.toFixed(2)}`
    : n > 0
    ? `$${n.toFixed(3)}`
    : "$0";

const usdPrecise = (n: number) =>
  new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(n);

const tok = (n: number) => {
  if (!n) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
};

const pct = (n: number, digits = 1) => `${(n * 100).toFixed(digits)}%`;

const shortTime = (iso: string | null) => {
  if (!iso) return "";
  try {
    return new Date(iso).toLocaleString(undefined, {
      month: "short",
      day: "numeric",
      hour: "2-digit",
      minute: "2-digit",
    });
  } catch {
    return iso;
  }
};

const dur = (ms: number | null) => {
  if (!ms) return "—";
  const min = ms / 60_000;
  if (min < 1) return `${Math.round(ms / 1000)}s`;
  if (min < 60) return `${min.toFixed(1)}m`;
  return `${(min / 60).toFixed(1)}h`;
};

const SRC_COLOR = { claude: "#d97c52", codex: "#0f8f8a" } as const;

// ─── fun-fact router + sticky-note bubble ───────────────────────────────
//
// Rather than a boring "here are 5 facts" panel, individual facts get
// pinned next to the visualization they comment on. We bucket each fact
// by keyword and serve it from the right spot.

const FACT_THEMES = {
  cache: /\b(cach|saved|savings|prompt cache)\b/i,
  burn: /\b(burn|worst|expensive day|spike|outlier|peak)\b/i,
  session: /\b(session|chat|conversation|interaction)\b/i,
  token: /\b(token|context|prompt|throughput)\b/i,
  cost: /\b(spend|spent|cost|dollar|\$)/i,
  model: /\b(model|opus|sonnet|haiku|gpt|codex|claude)\b/i,
} as const;

type Theme = keyof typeof FACT_THEMES;

function bucketFacts(facts: string[]): Record<Theme | "any", string[]> {
  const buckets: Record<Theme | "any", string[]> = {
    cache: [],
    burn: [],
    session: [],
    token: [],
    cost: [],
    model: [],
    any: [],
  };
  for (const f of facts) {
    let placed = false;
    for (const theme of Object.keys(FACT_THEMES) as Theme[]) {
      if (FACT_THEMES[theme].test(f)) {
        buckets[theme].push(f);
        placed = true;
        break; // first match wins so each fact appears exactly once
      }
    }
    if (!placed) buckets.any.push(f);
  }
  return buckets;
}

function FactBubble({
  fact,
  tone = "amber",
  align = "left",
}: {
  fact: string | undefined;
  tone?: "amber" | "teal" | "rose" | "violet" | "emerald";
  align?: "left" | "right";
}) {
  if (!fact) return null;
  // Slight rotation + colored background makes it feel like a sticky note
  // someone slapped onto the wall, not another panel.
  const palette: Record<string, string> = {
    amber: "border-amber-300 bg-amber-50 text-amber-900",
    teal: "border-teal-300 bg-teal-50 text-teal-900",
    rose: "border-rose-300 bg-rose-50 text-rose-900",
    violet: "border-violet-300 bg-violet-50 text-violet-900",
    emerald: "border-emerald-300 bg-emerald-50 text-emerald-900",
  };
  const rot = align === "right" ? "rotate-1" : "-rotate-1";
  return (
    <div
      className={`my-3 inline-block max-w-md transform border-l-4 ${palette[tone]} px-4 py-2 text-sm italic shadow-sm transition-transform hover:rotate-0 ${rot}`}
      style={{ borderRadius: "2px 14px 2px 14px" }}
    >
      <span className="mr-1 not-italic">✨</span>
      {fact}
    </div>
  );
}

// Tiny corner regenerate button — lives in the very-bottom footer so it
// doesn't take up screen real estate but is still discoverable.

// ─── stat tile ───────────────────────────────────────────────────────────

function Tile({
  label,
  value,
  hint,
  emphasis = false,
}: {
  label: string;
  value: string | number;
  hint?: string;
  emphasis?: boolean;
}) {
  return (
    <div className="panel p-4">
      <div className="text-xs uppercase tracking-wide text-slate-500">{label}</div>
      <div
        className={`mt-1 tabular-nums ${
          emphasis ? "text-3xl font-bold text-ink" : "text-2xl font-semibold text-ink"
        }`}
      >
        {value}
      </div>
      {hint && <div className="mt-1 text-xs text-slate-500">{hint}</div>}
    </div>
  );
}

// ─── main view ───────────────────────────────────────────────────────────

type FunFacts = {
  ok: boolean;
  facts?: string[];
  generated_at?: string;
  model?: string;
  cached?: boolean;
  error?: string;
};

export default function CostOverviewView({
  filterQS,
  onSelectRange,
}: {
  filterQS: string;
  onSelectRange?: (from: string, to: string) => void;
}) {
  const [data, setData] = useState<Payload | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [funFacts, setFunFacts] = useState<FunFacts | null>(null);
  const [funLoading, setFunLoading] = useState(false);
  // Only the Daily Spend chart has a date X-axis. Hour-of-day and
  // Day-of-week are categorical buckets — a "drag to filter dates"
  // doesn't map onto them — so they don't get the brush.
  const dailySpendBrush = useChartDateBrush(onSelectRange || (() => {}));

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    const url = `/api/metrics/cost-overview${filterQS ? `?${filterQS}` : ""}`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => {
        if (cancelled) return;
        if (j.ok) {
          setData(j);
          setError(null);
        } else {
          setError(j.error || "Failed to load");
        }
      })
      .catch((e) => {
        if (!cancelled) setError(String(e));
      })
      .finally(() => !cancelled && setLoading(false));
    return () => {
      cancelled = true;
    };
  }, [filterQS]);

  // Fetch fun facts whenever the underlying data changes. The endpoint is
  // cached server-side by content hash, so this is free on repeat calls.
  const loadFunFacts = (force = false) => {
    setFunLoading(true);
    const url = `/api/metrics/fun-facts${filterQS ? `?${filterQS}` : ""}${
      force ? (filterQS ? "&" : "?") + "force=1" : ""
    }`;
    fetch(url)
      .then((r) => r.json())
      .then((j) => setFunFacts(j))
      .catch((e) => setFunFacts({ ok: false, error: String(e), facts: [] }))
      .finally(() => setFunLoading(false));
  };
  useEffect(() => {
    if (data) loadFunFacts(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data?.headline.spend_total, data?.headline.sessions_total]);

  // Derived data: by-source pie (Claude vs Codex).
  const sourcePie = useMemo(() => {
    if (!data) return [];
    return [
      { name: "Claude", value: data.headline.source_split.claude, color: SRC_COLOR.claude },
      { name: "Codex", value: data.headline.source_split.codex, color: SRC_COLOR.codex },
    ].filter((s) => s.value > 0);
  }, [data]);

  // Per-day chart series — stack fresh input + output. Cached input is
  // intentionally omitted from the stack: it's typically 95%+ of the
  // chart volume but a tiny fraction of cost, so it crushes the useful
  // signal. Cache contribution is surfaced separately in the Cache
  // Effectiveness panel.
  const dailyChart = useMemo(() => {
    if (!data) return [];
    return data.byDay.map((d) => ({
      day: d.day,
      "Fresh input": Number(d.cost_input.toFixed(4)),
      Output: Number(d.cost_output.toFixed(4)),
    }));
  }, [data]);

  // Hour-of-day chart — keep all 24 hours so the X-axis spans the full day.
  const hourChart = useMemo(() => {
    if (!data) return [];
    return data.byHour.map((b) => ({
      label: `${String(b.hour).padStart(2, "0")}h`,
      sessions: b.sessions,
      cost: Number(b.cost.toFixed(4)),
    }));
  }, [data]);

  const dowChart = useMemo(() => {
    if (!data) return [];
    return data.byDayOfWeek.map((b) => ({
      label: b.label,
      sessions: b.sessions,
      cost: Number(b.cost.toFixed(4)),
    }));
  }, [data]);

  // Route each AI fact to the visualization it's most relevant to.
  // `pick(theme)` consumes from the bucket (so the same fact isn't
  // duplicated elsewhere) and falls back to the "any" bucket if the
  // themed bucket is empty.
  const factBuckets = useMemo(
    () => bucketFacts(funFacts?.facts || []),
    [funFacts]
  );
  const pickFact = (theme: Theme): string | undefined => {
    const themed = factBuckets[theme];
    if (themed && themed.length > 0) return themed.shift();
    return factBuckets.any.shift();
  };
  // Pre-pluck in render-order so the JSX below stays clean.
  const factForDaily = pickFact("cost");
  const factForCache = pickFact("cache");
  const factForBurn = pickFact("burn");
  const factForModel = pickFact("model");
  const factForSessions = pickFact("session");

  if (loading && !data) {
    return (
      <section className="panel p-12 text-center text-sm text-slate-500">
        Loading cost analytics…
      </section>
    );
  }

  if (error) {
    return (
      <section className="rounded-md border border-rose-200 bg-rose-50 p-6 text-sm text-rose-700">
        Failed to load cost overview: {error}
      </section>
    );
  }

  if (!data) return null;
  const h = data.headline;

  return (
    <section className="flex flex-col gap-5">
      {/* ─── headline tiles ──────────────────────────────────────────── */}
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        <Tile
          label="Total spend"
          value={usd(h.spend_total)}
          hint={`${h.active_days} active days · median ${usd(h.median_daily_cost)}/day`}
          emphasis
        />
        <Tile
          label="Last 7 days"
          value={usd(h.spend_7d)}
          hint={h.latest_day ? `as of ${h.latest_day}` : undefined}
        />
        <Tile label="Last 30 days" value={usd(h.spend_30d)} />
        <Tile label="Sessions" value={h.sessions_total.toLocaleString()} hint={`avg ${usd(h.avg_session_cost)}/session`} />
        <Tile
          label="Cache hit rate"
          value={pct(h.cache_hit_rate, 1)}
          hint={`saved ${usd(h.cache_savings)} vs no-cache`}
          emphasis
        />
        <Tile
          label="Billable tokens"
          value={tok(h.tokens_billable)}
          hint={`${tok(h.tokens_input)} input · ${tok(h.tokens_output)} output${
            h.tokens_reasoning ? ` · ${tok(h.tokens_reasoning)} reasoning` : ""
          }${h.tokens_cached ? ` · ${tok(h.tokens_cached)} cached (separately)` : ""}`}
        />
      </div>

      {/* AI facts are no longer a top-of-page panel. They're routed by
          theme to FactBubble callouts sprinkled near the visualization
          they comment on. See pickFact() below. */}

      {/* ─── daily cost trend ──────────────────────────────────────────── */}
      <div className="panel p-4">
        <div className="mb-3 flex items-baseline justify-between">
          <h2 className="text-lg font-semibold text-ink">
            Daily Spend
            {onSelectRange && (
              <span className="ml-2 text-xs font-normal text-slate-400">
                — drag to filter
              </span>
            )}
          </h2>
          <span className="text-xs text-slate-500">
            fresh input + output · cached shown in Cache panel
          </span>
        </div>
        {dailyChart.length === 0 ? (
          <div className="p-8 text-center text-sm text-slate-500">No spend in range</div>
        ) : (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={dailyChart} {...dailySpendBrush.chartProps}>
                <defs>
                  <linearGradient id="g-fresh" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#0f8f8a" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="#0f8f8a" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-cached" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#6157a8" stopOpacity={0.6} />
                    <stop offset="100%" stopColor="#6157a8" stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-output" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#d97c52" stopOpacity={0.7} />
                    <stop offset="100%" stopColor="#d97c52" stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => (v >= 100 ? `$${Math.round(v)}` : `$${v.toFixed(1)}`)}
                />
                <Tooltip
                  formatter={(v: number, name: string) => [usdPrecise(v), name]}
                  labelStyle={{ fontSize: 12 }}
                />
                <Legend />
                <Area type="monotone" dataKey="Fresh input" stackId="1" stroke="#0f8f8a" fill="url(#g-fresh)" strokeWidth={1.5} />
                <Area type="monotone" dataKey="Output" stackId="1" stroke="#d97c52" fill="url(#g-output)" strokeWidth={1.5} />
                {dailySpendBrush.selectionOverlay()}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        )}
        <FactBubble fact={factForDaily} tone="amber" />
      </div>

      {/* ─── source split + cache panel ───────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-ink">Claude vs Codex</h2>
          <p className="text-xs text-slate-500">share of total spend</p>
          {sourcePie.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No data</div>
          ) : (
            <div className="h-56">
              <ResponsiveContainer width="100%" height="100%">
                <PieChart>
                  <Pie
                    data={sourcePie}
                    dataKey="value"
                    nameKey="name"
                    innerRadius={50}
                    outerRadius={80}
                    paddingAngle={2}
                  >
                    {sourcePie.map((s) => (
                      <Cell key={s.name} fill={s.color} />
                    ))}
                  </Pie>
                  <Tooltip formatter={(v: number) => usdPrecise(v)} />
                  <Legend />
                </PieChart>
              </ResponsiveContainer>
            </div>
          )}
          <div className="mt-2 grid grid-cols-3 gap-2 text-xs">
            <div>
              <div className="text-slate-500">Both</div>
              <div className="font-semibold tabular-nums">{h.overlap_days}d</div>
            </div>
            <div>
              <div className="text-slate-500">Claude only</div>
              <div className="font-semibold tabular-nums">{h.claude_only_days}d</div>
            </div>
            <div>
              <div className="text-slate-500">Codex only</div>
              <div className="font-semibold tabular-nums">{h.codex_only_days}d</div>
            </div>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-ink">Cache Effectiveness</h2>
          <p className="text-xs text-slate-500">prompt caching is doing most of the work</p>
          <div className="mt-3 space-y-3 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-slate-600">Hit rate</span>
              <span className="text-2xl font-bold tabular-nums text-emerald-700">
                {pct(h.cache_hit_rate, 1)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-slate-600">Saved (vs no cache)</span>
              <span className="text-xl font-semibold tabular-nums text-emerald-700">
                {usd(h.cache_savings)}
              </span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-slate-600">Cached tokens</span>
              <span className="font-semibold tabular-nums">{tok(h.tokens_cached)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-slate-600">Fresh input</span>
              <span className="font-semibold tabular-nums">{tok(h.tokens_input)}</span>
            </div>
            <div className="flex items-baseline justify-between">
              <span className="text-slate-600">Output</span>
              <span className="font-semibold tabular-nums">{tok(h.tokens_output)}</span>
            </div>
            {h.tokens_reasoning > 0 && (
              <div className="flex items-baseline justify-between">
                <span className="text-slate-600">Reasoning (Codex)</span>
                <span className="font-semibold tabular-nums">{tok(h.tokens_reasoning)}</span>
              </div>
            )}
          </div>
          <FactBubble fact={factForCache} tone="emerald" align="right" />
        </div>

        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-ink">Burn Alerts</h2>
          <p className="text-xs text-slate-500">
            days where spend &gt; 3× median ({usd(h.median_daily_cost)}/day)
          </p>
          {data.burnAlerts.length === 0 ? (
            <div className="mt-3 text-sm text-slate-500">Spend is steady — no outlier days.</div>
          ) : (
            <ul className="mt-3 divide-y divide-line">
              {data.burnAlerts.slice(0, 6).map((a) => (
                <li key={a.day} className="flex items-baseline justify-between py-1.5 text-sm">
                  <span className="tabular-nums">{a.day}</span>
                  <span className="text-right tabular-nums">
                    <span className="font-semibold text-rose-600">{usd(a.cost)}</span>
                    <span className="ml-2 text-xs text-slate-500">{a.multiple.toFixed(1)}×</span>
                  </span>
                </li>
              ))}
            </ul>
          )}
          <FactBubble fact={factForBurn} tone="rose" />
        </div>
      </div>

      {/* ─── model leaderboard + project leaderboard ───────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel overflow-hidden">
          <div className="border-b border-line p-4">
            <h2 className="text-lg font-semibold text-ink">Spend by Model</h2>
            <p className="text-xs text-slate-500">where the dollars go</p>
          </div>
          {factForModel && (
            <div className="border-b border-line px-4 py-2">
              <FactBubble fact={factForModel} tone="violet" />
            </div>
          )}
          {data.byModel.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No data</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Model</th>
                  <th className="px-3 py-2 text-right">Sessions</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Spend</th>
                  <th className="px-3 py-2 text-right">%</th>
                </tr>
              </thead>
              <tbody>
                {data.byModel.slice(0, 12).map((m, i) => (
                  <tr key={i} className="border-t border-line">
                    <td className="px-3 py-2">
                      <span
                        className="inline-block h-2 w-2 rounded-full"
                        style={{
                          backgroundColor: SRC_COLOR[m.source as "claude" | "codex"] || "#999",
                        }}
                      />
                      <span className="ml-2 text-xs uppercase text-slate-500">{m.source}</span>
                      <span className="ml-2 font-medium">{m.model}</span>
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{m.sessions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{tok(m.tokens_total)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(m.cost)}</td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums text-slate-500">
                      {m.pct_of_total.toFixed(1)}%
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>

        <div className="panel overflow-hidden">
          <div className="border-b border-line p-4">
            <h2 className="text-lg font-semibold text-ink">Spend by Project</h2>
            <p className="text-xs text-slate-500">which working directory ate the budget</p>
          </div>
          {data.byProject.length === 0 ? (
            <div className="p-6 text-sm text-slate-500">No data</div>
          ) : (
            <table className="w-full text-sm">
              <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
                <tr>
                  <th className="px-3 py-2 text-left">Project</th>
                  <th className="px-3 py-2 text-right">Sessions</th>
                  <th className="px-3 py-2 text-right">Tokens</th>
                  <th className="px-3 py-2 text-right">Spend</th>
                </tr>
              </thead>
              <tbody>
                {data.byProject.map((p) => (
                  <tr key={p.cwd} className="border-t border-line">
                    <td className="px-3 py-2 font-mono text-xs" title={p.cwd}>
                      {p.cwd_short}
                    </td>
                    <td className="px-3 py-2 text-right tabular-nums">{p.sessions}</td>
                    <td className="px-3 py-2 text-right tabular-nums">{tok(p.tokens)}</td>
                    <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(p.cost)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* ─── time-of-day + day-of-week ──────────────────────────────── */}
      <div className="grid gap-4 lg:grid-cols-2">
        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-ink">Hour of Day (UTC)</h2>
          <p className="text-xs text-slate-500">when sessions fire</p>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={hourChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="label" tick={{ fontSize: 10 }} interval={2} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip
                  formatter={(v: number, name: string) =>
                    name === "cost" ? usdPrecise(v) : v
                  }
                />
                <Bar dataKey="sessions" fill="#0f8f8a" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="panel p-4">
          <h2 className="text-lg font-semibold text-ink">Day of Week</h2>
          <p className="text-xs text-slate-500">total spend per weekday</p>
          <div className="mt-3 h-56">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={dowChart}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                <YAxis
                  tick={{ fontSize: 11 }}
                  tickFormatter={(v) => (v >= 10 ? `$${Math.round(v)}` : `$${v.toFixed(1)}`)}
                />
                <Tooltip formatter={(v: number) => usdPrecise(v)} />
                <Bar dataKey="cost" fill="#6157a8" radius={[3, 3, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      {/* ─── top sessions ──────────────────────────────────────────── */}
      <div className="panel overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-lg font-semibold text-ink">Most Expensive Sessions</h2>
          <p className="text-xs text-slate-500">single sessions ranked by spend</p>
          {factForSessions && (
            <div className="mt-2">
              <FactBubble fact={factForSessions} tone="teal" />
            </div>
          )}
        </div>
        {data.topSessions.length === 0 ? (
          <div className="p-6 text-sm text-slate-500">No data</div>
        ) : (
          <table className="w-full text-sm">
            <thead className="bg-white text-xs uppercase tracking-wide text-slate-500">
              <tr>
                <th className="px-3 py-2 text-left">When</th>
                <th className="px-3 py-2 text-left">Project</th>
                <th className="px-3 py-2 text-left">Model</th>
                <th className="px-3 py-2 text-right">Duration</th>
                <th className="px-3 py-2 text-right">Tokens</th>
                <th className="px-3 py-2 text-right">Spend</th>
              </tr>
            </thead>
            <tbody>
              {data.topSessions.map((s) => (
                <tr key={s.turn_id} className="border-t border-line">
                  <td className="px-3 py-2 tabular-nums text-slate-600">{shortTime(s.started_at)}</td>
                  <td className="px-3 py-2 font-mono text-xs" title={s.cwd}>
                    {s.cwd_short}
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className="inline-block h-2 w-2 rounded-full"
                      style={{ backgroundColor: SRC_COLOR[s.source as "claude" | "codex"] || "#999" }}
                    />
                    <span className="ml-2 text-xs">{s.model}</span>
                  </td>
                  <td className="px-3 py-2 text-right tabular-nums text-slate-600">{dur(s.duration_ms)}</td>
                  <td className="px-3 py-2 text-right tabular-nums">{tok(s.tokens_total)}</td>
                  <td className="px-3 py-2 text-right font-semibold tabular-nums">{usd(s.cost)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ─── footer note ───────────────────────────────────────────── */}
      <div className="flex flex-wrap items-baseline justify-between gap-3 px-1 text-xs text-slate-500">
        <p className="max-w-3xl">
          Spend computed by applying the model rate card in <code>src/lib/pricing.js</code> to the
          token sums in <code>token_usage</code>. Cache &quot;savings&quot; = what the cached input
          would have cost at the fresh-input rate. UTC timestamps; hour-of-day reflects when the
          message landed in the transcript, not your wall clock.
        </p>
        <button
          type="button"
          disabled={funLoading}
          onClick={() => loadFunFacts(true)}
          title="Pay Haiku a tenth of a cent for fresh fact bubbles"
          className="rounded-md border border-line bg-white px-2 py-1 text-[11px] font-medium text-slate-600 hover:border-amber-400 hover:text-amber-700 disabled:opacity-50"
        >
          {funLoading ? "✨ Thinking…" : "✨ Regenerate facts"}
        </button>
      </div>
    </section>
  );
}
