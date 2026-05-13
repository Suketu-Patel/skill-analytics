"use client";

import JudgmentsView from "./judgments-view";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Database,
  EyeOff,
  Eye,
  Flame,
  Moon,
  RefreshCw,
  Search,
  ShieldCheck,
  Timer,
  TrendingDown,
  X,
  Zap
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Legend,
  Line,
  LineChart,
  Pie,
  PieChart,
  ReferenceArea,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis
} from "recharts";

type Overview = {
  totals?: Record<string, number>;
  confidence?: Array<{ confidence: string; count: number }>;
  topSkills?: Array<Record<string, string | number | null>>;
  topErrors?: Array<Record<string, string | number | null>>;
  recentErrors?: Array<Record<string, string | number | null>>;
};

type SkillRow = {
  name: string;
  kind: string;
  path?: string;
  description?: string;
  events: number;
  explicit_events: number;
  inferred_events: number;
  mentioned_events: number;
  errors: number;
  total_tokens: number;
  avg_duration_ms: number;
  last_seen?: string;
  category?: "system" | "plugin" | "user-skill" | "project-agent" | "other";
  project?: string | null;
  tool_calls?: number;
  tool_failed?: number;
  tool_completed?: number;
  success_rate?: number | null;
  source?: string | null;
};

type Insights = {
  staleSkills?: Array<{ name: string; kind: string; events: number; last_seen?: string | null }>;
  hourlyActivity?: Array<{ hour: number; events: number }>;
  topFailingCommands?: Array<{ command: string; failures: number; last_failure?: string }>;
  failureLeaders?: Array<{ skill_name: string; calls: number; failed: number; completed: number; failure_rate: number }>;
};

type SkillCategoryFilter =
  | "all"
  | "user-skill"
  | "project-agent"
  | "plugin"
  | "system"
  | "claude-skill"
  | "claude-agent";

const CATEGORY_LABEL: Record<SkillCategoryFilter, string> = {
  all: "All",
  "user-skill": "Custom Skills",
  "project-agent": "Project Agents",
  plugin: "Plugin Skills",
  system: "System Skills",
  "claude-skill": "Claude Skills",
  "claude-agent": "Claude Agents"
};

type SourceFilter = "all" | "codex" | "claude" | "cursor";

const SOURCE_LABEL: Record<SourceFilter, string> = {
  all: "All",
  codex: "Codex",
  claude: "Claude",
  cursor: "Cursor"
};

type PricingData = {
  totals?: {
    overall: number;
    codex: number;
    claude: number;
    saved_by_caching: number;
    unpriced_tokens: number;
    total_fresh_input: number;
    total_cached: number;
    total_output: number;
  };
  models?: Array<{
    source: "codex" | "claude";
    model: string;
    sessions: number;
    input_tokens: number;
    fresh_input_tokens: number;
    cached_input_tokens: number;
    output_tokens: number;
    reasoning_output_tokens: number;
    cost: number;
    input_cost: number;
    cached_cost: number;
    output_cost: number;
    saved_by_caching: number;
    priced: boolean;
  }>;
  daily?: Array<{ day: string; codex: number; claude: number }>;
  perSkill?: Array<{ skill_name: string; source: string; cost: number; sessions: number }>;
};

type ComparisonData = {
  sources?: Array<{
    source: string;
    totals: Record<string, number>;
    topTools: Array<{ tool_name: string; calls: number; failed: number }>;
    topModels: Array<{ model: string; turns: number }>;
    daily: Array<{ day: string; events: number }>;
    dailyTokens?: Array<{ day: string; tokens: number }>;
    tokenBreakdown?: {
      input_tokens: number;
      cached_input_tokens: number;
      output_tokens: number;
      reasoning_tokens: number;
    };
    hourly?: Array<{ hour: number; events: number }>;
  }>;
};

type ErrorRow = {
  error_key: string;
  timestamp?: string;
  severity: string;
  category: string;
  message: string;
  skill_name?: string;
  turn_id?: string;
  source_path?: string;
  source_line?: number;
  evidence_id?: string;
  source?: string;
};

type TimelineRow = {
  day: string;
  skill_events: number;
  errors: number;
  tokens: number;
};

const COLORS = ["#0f8f8a", "#d55c47", "#b78318", "#6157a8", "#3f7fbc", "#6b7280"];

// Brand color tokens (also defined in tailwind.config.cjs).
const BRAND = {
  claude: "#D97757",
  codex: "#0D0D0D",
  cursor: "#1B6FFF"
} as const;

// Anthropic Claude mark — official brand SVG (the leftmost "sunburst" glyph
// from the full Claude wordmark provided by Anthropic).
function ClaudeLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label="Claude"
      className={className}
    >
      <path
        shapeRendering="optimizeQuality"
        d="M11.376 24L10.776 23.544L10.44 22.8L10.776 21.312L11.16 19.392L11.472 17.856L11.76 15.96L11.928 15.336L11.904 15.288L11.784 15.312L10.344 17.28L8.16 20.232L6.432 22.056L6.024 22.224L5.304 21.864L5.376 21.192L5.784 20.616L8.16 17.568L9.6 15.672L10.536 14.592L10.512 14.448H10.464L4.128 18.576L3 18.72L2.496 18.264L2.568 17.52L2.808 17.28L4.704 15.96L9.432 13.32L9.504 13.08L9.432 12.96H9.192L8.4 12.912L5.712 12.84L3.384 12.744L1.104 12.624L0.528 12.504L0 11.784L0.048 11.424L0.528 11.112L1.224 11.16L2.736 11.28L5.016 11.424L6.672 11.52L9.12 11.784H9.504L9.552 11.616L9.432 11.52L9.336 11.424L6.96 9.84L4.416 8.16L3.072 7.176L2.352 6.672L1.992 6.216L1.848 5.208L2.496 4.488L3.384 4.56L3.6 4.608L4.488 5.304L6.384 6.768L8.88 8.616L9.24 8.904L9.408 8.808V8.736L9.24 8.472L7.896 6.024L6.456 3.528L5.808 2.496L5.64 1.872C5.576 1.656 5.544 1.416 5.544 1.152L6.288 0.144001L6.696 0L7.704 0.144001L8.112 0.504001L8.736 1.92L9.72 4.152L11.28 7.176L11.736 8.088L11.976 8.904L12.072 9.168H12.24V9.024L12.36 7.296L12.6 5.208L12.84 2.52L12.912 1.752L13.296 0.840001L14.04 0.360001L14.616 0.624001L15.096 1.32L15.024 1.752L14.76 3.6L14.184 6.504L13.824 8.472H14.04L14.28 8.208L15.264 6.912L16.92 4.848L17.64 4.032L18.504 3.12L19.056 2.688H20.088L20.832 3.816L20.496 4.992L19.44 6.336L18.552 7.464L17.28 9.168L16.512 10.536L16.584 10.632H16.752L19.608 10.008L21.168 9.744L22.992 9.432L23.832 9.816L23.928 10.2L23.592 11.016L21.624 11.496L19.32 11.952L15.888 12.768L15.84 12.792L15.888 12.864L17.424 13.008L18.096 13.056H19.728L22.752 13.272L23.544 13.8L24 14.424L23.928 14.928L22.704 15.528L21.072 15.144L17.232 14.232L15.936 13.92H15.744V14.016L16.848 15.096L18.84 16.896L21.36 19.224L21.48 19.8L21.168 20.28L20.832 20.232L18.624 18.552L17.76 17.808L15.84 16.2H15.72V16.368L16.152 17.016L18.504 20.544L18.624 21.624L18.456 21.96L17.832 22.176L17.184 22.056L15.792 20.136L14.376 17.952L13.224 16.008L13.104 16.104L12.408 23.352L12.096 23.712L11.376 24Z"
      />
    </svg>
  );
}

// OpenAI "spirograph" mark — simplified circular knot used to badge Codex rows.
function CodexLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label="Codex (OpenAI)"
      className={className}
    >
      <path d="M21.07 10.32a5.34 5.34 0 0 0-.46-4.39 5.41 5.41 0 0 0-5.82-2.59 5.4 5.4 0 0 0-9.16 1.96 5.4 5.4 0 0 0-3.61 2.62 5.4 5.4 0 0 0 .66 6.34 5.4 5.4 0 0 0 .46 4.4 5.4 5.4 0 0 0 5.82 2.6 5.4 5.4 0 0 0 9.16-1.97 5.4 5.4 0 0 0 3.61-2.62 5.4 5.4 0 0 0-.66-6.34Zm-8.06 11.27a4 4 0 0 1-2.57-.93l.13-.07 4.27-2.46a.7.7 0 0 0 .35-.6v-6.02l1.81 1.04c.02.01.03.03.04.05v4.98c0 2.21-1.81 4.01-4.03 4.01ZM4.35 17.85a4 4 0 0 1-.48-2.7l.13.08 4.27 2.46c.21.13.48.13.7 0l5.21-3v2.08c0 .02 0 .04-.03.06l-4.31 2.48a4.02 4.02 0 0 1-5.49-1.46Zm-1.13-9.4a4 4 0 0 1 2.11-1.77v5.06c0 .24.13.46.34.59l5.2 3-1.81 1.04a.06.06 0 0 1-.06 0L4.69 13.9a4.02 4.02 0 0 1-1.47-5.45Zm14.83 3.45-5.21-3.01 1.81-1.04a.06.06 0 0 1 .06 0l4.32 2.48a4.02 4.02 0 0 1-.62 7.25v-5.07c0-.24-.13-.46-.36-.6Zm1.8-2.7-.13-.07-4.26-2.49a.7.7 0 0 0-.7 0L9.55 9.65V7.57c0-.02 0-.04.02-.06l4.32-2.48a4.02 4.02 0 0 1 5.97 4.16Zm-11.3 3.71L6.74 11.86a.07.07 0 0 1-.04-.05V6.83a4.02 4.02 0 0 1 6.59-3.08l-.13.07-4.27 2.46a.7.7 0 0 0-.35.6l-.01 6.01Zm.98-2.12L11.85 9.4l2.33 1.34v2.69l-2.33 1.34-2.32-1.34Z" />
    </svg>
  );
}

function CursorLogo({ size = 16, className = "" }: { size?: number; className?: string }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="currentColor"
      aria-label="Cursor"
      className={className}
    >
      <path d="M12 2L2 7l10 5 10-5-10-5zM2 17l10 5 10-5M2 12l10 5 10-5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
    </svg>
  );
}

// Tiny inline source badge shown next to skill / error rows so the eye can
// instantly tell which agent produced the row.
function SourceBadge({ source }: { source?: string | null }) {
  if (source === "claude") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-claude-tint px-1.5 py-0.5 text-[10px] font-semibold text-claude">
        <ClaudeLogo size={10} /> Claude
      </span>
    );
  }
  if (source === "codex") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-codex-tint px-1.5 py-0.5 text-[10px] font-semibold text-codex">
        <CodexLogo size={10} /> Codex
      </span>
    );
  }
  return null;
}

function formatNumber(value: unknown) {
  const number = Number(value || 0);
  return new Intl.NumberFormat("en-US").format(Math.round(number));
}

function formatDuration(ms: unknown) {
  const value = Number(ms || 0);
  if (!value) return "0s";
  if (value < 60_000) return `${Math.round(value / 1000)}s`;
  return `${Math.round(value / 60_000)}m`;
}

// Compact token formatting for axes / legends — 12345 → "12.3k", 5.4M → "5.4M".
function formatTokens(value: number) {
  if (!value) return "0";
  if (value >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `${(value / 1_000).toFixed(1)}k`;
  return String(value);
}

function shortPath(value?: string) {
  if (!value) return "";
  const marker = "/.codex/";
  if (value.includes(marker)) return `~/.codex/${value.split(marker)[1]}`;
  const projectMarker = "/project/ilit/";
  if (value.includes(projectMarker)) return value.split(projectMarker)[1];
  return value;
}

/**
 * Hook that turns any Recharts time-series chart into a click-and-drag
 * date-range selector. Spread `chartProps` onto `<LineChart>` /
 * `<AreaChart>` / `<BarChart>`, render `selectionOverlay()` inside the
 * chart, and pass `onSelect` to receive the chosen [from, to] day pair
 * (already sorted left-to-right).
 *
 * Behavior:
 *  - mousedown on a data point records the left bound
 *  - mousemove with the button held records the right bound and renders
 *    a translucent <ReferenceArea> across the selection
 *  - mouseup with a non-empty range fires onSelect and clears overlay
 *  - leaving the chart while dragging cancels (no half-selections)
 *
 * The chart's data must have a `day` field whose values are sortable
 * strings — YYYY-MM-DD works as-is.
 */
function useChartDateBrush(onSelect: (from: string, to: string) => void) {
  const [left, setLeft] = useState<string | null>(null);
  const [right, setRight] = useState<string | null>(null);
  const isDragging = left != null;

  const reset = () => {
    setLeft(null);
    setRight(null);
  };

  // While the user is dragging the chart, the browser would normally
  // select all surrounding text (chart axis labels, panel headings,
  // etc.) — the standard side-effect of any mousedown+drag. Block it at
  // the document level for the duration of the drag.
  useEffect(() => {
    if (!isDragging) return;
    const prev = document.body.style.userSelect;
    document.body.style.userSelect = "none";
    return () => {
      document.body.style.userSelect = prev;
    };
  }, [isDragging]);

  const chartProps = {
    onMouseDown: (e: { activeLabel?: string } | null) => {
      const lab = e?.activeLabel;
      if (typeof lab === "string" && lab) {
        setLeft(lab);
        setRight(lab);
      }
    },
    onMouseMove: (e: { activeLabel?: string } | null) => {
      if (left == null) return;
      const lab = e?.activeLabel;
      if (typeof lab === "string" && lab) setRight(lab);
    },
    onMouseUp: () => {
      if (left != null && right != null && left !== right) {
        const [from, to] = [left, right].sort();
        onSelect(from, to);
      }
      reset();
    },
    onMouseLeave: reset,
    // crosshair cursor + suppress text selection at the element level
    // too (defense-in-depth alongside the document-level guard above).
    style: {
      cursor: "crosshair",
      userSelect: "none",
      WebkitUserSelect: "none",
    } as React.CSSProperties,
  };

  const selectionOverlay = () =>
    left && right && left !== right ? (
      <ReferenceArea
        x1={left}
        x2={right}
        strokeOpacity={0.3}
        fill="#0f8f8a"
        fillOpacity={0.15}
      />
    ) : null;

  return { chartProps, selectionOverlay };
}

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "teal",
  loading = false
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "teal" | "coral" | "amber" | "violet";
  loading?: boolean;
}) {
  const toneClass = {
    teal: "bg-teal/10 text-teal",
    coral: "bg-coral/10 text-coral",
    amber: "bg-amber/10 text-amber",
    violet: "bg-violet/10 text-violet"
  }[tone];
  return (
    <div className="metric-card p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">{label}</p>
          {loading ? (
            <>
              <p className="mt-2"><span className="skeleton h-7 w-24">000</span></p>
              <p className="mt-1"><span className="skeleton h-3 w-36">.</span></p>
            </>
          ) : (
            <>
              <p className="mt-2 text-2xl font-semibold text-ink">{value}</p>
              <p className="mt-1 text-sm text-slate-500">{detail}</p>
            </>
          )}
        </div>
        <div className={`rounded-md p-2 ${toneClass}`}>
          <Icon size={18} />
        </div>
      </div>
    </div>
  );
}

function EmptyState({ text, loading = false }: { text: string; loading?: boolean }) {
  if (loading) {
    return (
      <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-line bg-surface">
        <div className="flex items-center gap-3 text-sm text-slate-500">
          <span className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-slate-300 border-t-teal" />
          Loading
        </div>
      </div>
    );
  }
  return (
    <div className="flex min-h-44 items-center justify-center rounded-md border border-dashed border-line bg-surface text-sm text-slate-500">
      {text}
    </div>
  );
}

function ChartSkeleton({ height = "h-80" }: { height?: string }) {
  // Bar-chart-shaped skeleton so the panel doesn't visually collapse during refetch.
  const bars = Array.from({ length: 12 }, (_, i) => 30 + ((i * 37) % 60));
  return (
    <div className={`flex items-end justify-around gap-2 px-2 ${height}`}>
      {bars.map((h, i) => (
        <span key={i} className="skeleton w-full" style={{ height: `${h}%` }}>
          .
        </span>
      ))}
    </div>
  );
}

function TableSkeleton({ rows = 6, cols = 5 }: { rows?: number; cols?: number }) {
  return (
    <div className="flex flex-col gap-2 p-3">
      {Array.from({ length: rows }).map((_, r) => (
        <div key={r} className="flex gap-3">
          {Array.from({ length: cols }).map((_, c) => (
            <span key={c} className="skeleton h-4 flex-1">
              .
            </span>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function DashboardClient() {
  const [overview, setOverview] = useState<Overview>({});
  const [skills, setSkills] = useState<SkillRow[]>([]);
  const [errors, setErrors] = useState<ErrorRow[]>([]);
  const [timeline, setTimeline] = useState<TimelineRow[]>([]);
  const [query, setQuery] = useState("");
  const [active, setActive] = useState<"overview" | "skills" | "errors" | "timeline" | "comparison" | "pricing" | "judgments">("overview");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>("");
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<SkillCategoryFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [projects, setProjects] = useState<string[]>([]);
  const [hideUnused, setHideUnused] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<"all" | "error" | "warn">("all");
  const [insights, setInsights] = useState<Insights>({});
  const [skillDetailName, setSkillDetailName] = useState<string | null>(null);
  const [sourceFilter, setSourceFilter] = useState<SourceFilter>("all");
  const [dateFrom, setDateFrom] = useState<string>("");
  const [dateTo, setDateTo] = useState<string>("");
  const [comparison, setComparison] = useState<ComparisonData>({});
  const [pricing, setPricing] = useState<PricingData>({});

  // Build the shared filter query string. Every metric endpoint accepts these
  // identical params so the entire dashboard reflects the same filter state.
  const filterQS = useMemo(() => {
    const p = new URLSearchParams();
    if (sourceFilter !== "all") p.set("source", sourceFilter);
    if (dateFrom) p.set("from", `${dateFrom}T00:00:00.000Z`);
    if (dateTo) p.set("to", `${dateTo}T23:59:59.999Z`);
    return p.toString();
  }, [sourceFilter, dateFrom, dateTo]);

  // Single callback wired to every brush-able chart. Charts call this with
  // a [from, to] day pair after the user drags a horizontal selection.
  // We also scroll the filter bar into view so the user sees the change.
  const handleChartDateSelect = (from: string, to: string) => {
    setDateFrom(from);
    setDateTo(to);
  };

  // Brush handlers for the two main timeline charts (Skill Activity +
  // Token Load). Each chart needs its own state, so we instantiate two
  // hooks.
  const activityBrush = useChartDateBrush(handleChartDateSelect);
  const tokenBrush = useChartDateBrush(handleChartDateSelect);

  async function loadData() {
    setLoading(true);
    try {
      const safeJson = async (url: string) => {
        try {
          const res = await fetch(url, { cache: "no-store" });
          if (!res.ok) return null;
          const text = await res.text();
          return text ? JSON.parse(text) : null;
        } catch {
          return null;
        }
      };
      const qs = filterQS ? `&${filterQS}` : "";
      const [overviewBody, skillsBody, errorsBody, timelineBody, insightsBody, comparisonBody, pricingBody] =
        await Promise.all([
          safeJson(`/api/metrics/overview?${filterQS}`),
          safeJson(`/api/metrics/skills?${filterQS}`),
          safeJson(`/api/metrics/errors?limit=200${qs}`),
          safeJson(`/api/metrics/timeline?${filterQS}`),
          safeJson(`/api/metrics/insights?${filterQS}`),
          safeJson(`/api/metrics/comparison?${filterQS}`),
          safeJson(`/api/metrics/pricing?${filterQS}`)
        ]);
      setOverview(overviewBody || {});
      setSkills(skillsBody?.skills || []);
      setProjects(skillsBody?.projects || []);
      setErrors(errorsBody?.errors || []);
      setTimeline(timelineBody?.timeline || []);
      setInsights(insightsBody || {});
      setComparison(comparisonBody || {});
      setPricing(pricingBody || {});
    } finally {
      setLoading(false);
    }
  }

  async function runImport() {
    setImporting(true);
    setImportError("");
    try {
      const response = await fetch("/api/import", { method: "POST" });
      const body = await response.json();
      if (!body.ok) setImportError(String(body.error || "Import failed"));
      await loadData();
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  async function openEvidence(id?: string) {
    if (!id) return;
    const response = await fetch(`/api/evidence/${id}`, { cache: "no-store" });
    setEvidence(await response.json());
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQS]);

  const filteredSkills = useMemo(() => {
    const text = query.trim().toLowerCase();
    return skills.filter((skill) => {
      if (categoryFilter !== "all" && skill.category !== categoryFilter) return false;
      if (projectFilter !== "all" && (skill.project || "") !== projectFilter) return false;
      if (hideUnused && (skill.events || 0) === 0) return false;
      if (!text) return true;
      return [skill.name, skill.kind, skill.path, skill.description].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(text)
      );
    });
  }, [skills, query, categoryFilter, projectFilter, hideUnused]);

  // Skills matching the current category/project filter, indexed by name for fast lookup.
  const skillIndex = useMemo(() => {
    const map = new Map<string, SkillRow>();
    skills.forEach((s) => map.set(s.name, s));
    return map;
  }, [skills]);

  const skillNamePassesFilter = (name?: string | null) => {
    if (categoryFilter === "all" && projectFilter === "all") return true;
    if (!name) return categoryFilter === "all" && projectFilter === "all";
    const s = skillIndex.get(name);
    if (!s) return false;
    if (categoryFilter !== "all" && s.category !== categoryFilter) return false;
    if (projectFilter !== "all" && (s.project || "") !== projectFilter) return false;
    return true;
  };

  const filteredErrors = useMemo(() => {
    const text = query.trim().toLowerCase();
    return errors.filter((error) => {
      if (severityFilter !== "all" && error.severity !== severityFilter) return false;
      if (!skillNamePassesFilter(error.skill_name)) return false;
      if (!text) return true;
      return [error.category, error.message, error.skill_name, error.source_path].some((value) =>
        String(value || "")
          .toLowerCase()
          .includes(text)
      );
    });
  }, [errors, query, severityFilter, categoryFilter, projectFilter]);

  const serverTotals = overview.totals || {};
  // When a category/project filter is active, the server returned counts for
  // EVERYTHING in the date+source window — we recompute the visible stats from
  // the already-filtered skill list so the cards match the filter pills.
  const categoryActive = categoryFilter !== "all" || projectFilter !== "all" || hideUnused;
  const totals: Record<string, number> = categoryActive
    ? (() => {
        const skillNames = new Set(filteredSkills.map((s) => s.name));
        const eventsSum = filteredSkills.reduce((acc, s) => acc + (s.events || 0), 0);
        const tokensSum = filteredSkills.reduce((acc, s) => acc + (s.total_tokens || 0), 0);
        const errorsSum = filteredSkills.reduce((acc, s) => acc + (s.errors || 0), 0);
        const activeCount = filteredSkills.filter((s) => (s.events || 0) > 0).length;
        // Avg turn — average the visible skills' avg_duration_ms (skip zeros)
        const durations = filteredSkills.map((s) => s.avg_duration_ms || 0).filter((d) => d > 0);
        const avgDur = durations.length ? durations.reduce((a, b) => a + b, 0) / durations.length : 0;
        const hardErrors = errors.filter(
          (e) => e.severity === "error" && (!e.skill_name || skillNames.has(e.skill_name))
        ).length;
        return {
          skills: filteredSkills.length,
          active_skills: activeCount,
          skill_events: eventsSum,
          total_tokens: tokensSum,
          errors: errorsSum,
          hard_errors: hardErrors,
          avg_duration_ms: avgDur,
          turns: Number(serverTotals.turns || 0)
        };
      })()
    : (serverTotals as Record<string, number>);
  const activeSkillRate =
    Number(totals.skills || 0) > 0
      ? Math.round((Number(totals.active_skills || 0) / Number(totals.skills)) * 100)
      : 0;

  // Apply the global category/project filter to each server-returned panel.
  // Without this, the Top Skill Activity chart and recent errors panel would
  // show data for skills the user has filtered out of the table view.
  const filteredTopSkills = useMemo(() => {
    const rows = (overview.topSkills || []) as Array<Record<string, string | number | null>>;
    if (!categoryActive) return rows;
    return rows.filter((r) => skillNamePassesFilter(String(r.skill_name || "")));
  }, [overview.topSkills, categoryActive, categoryFilter, projectFilter, hideUnused, skillIndex]);

  const filteredRecentErrors = useMemo(() => {
    const rows = (overview.recentErrors || []) as Array<Record<string, string | number | null>>;
    if (!categoryActive) return rows;
    return rows.filter((r) => skillNamePassesFilter(String(r.skill_name || "") || null));
  }, [overview.recentErrors, categoryActive, categoryFilter, projectFilter, hideUnused, skillIndex]);

  const filteredFailureLeaders = useMemo(() => {
    const rows = insights.failureLeaders || [];
    if (!categoryActive) return rows;
    return rows.filter((r) => skillNamePassesFilter(r.skill_name));
  }, [insights.failureLeaders, categoryActive, categoryFilter, projectFilter, hideUnused, skillIndex]);

  const filteredStaleSkills = useMemo(() => {
    const rows = insights.staleSkills || [];
    if (!categoryActive) return rows;
    return rows.filter((r) => skillNamePassesFilter(r.name));
  }, [insights.staleSkills, categoryActive, categoryFilter, projectFilter, hideUnused, skillIndex]);

  return (
    <main className="mx-auto flex min-h-screen w-full max-w-[1500px] flex-col gap-5 px-3 py-4 sm:px-5 sm:py-5 lg:px-8">
      {/* Indeterminate progress bar — visible whenever any metric fetch is in flight. */}
      {loading && (
        <div className="fixed inset-x-0 top-0 z-40">
          <div className="loader-bar" />
        </div>
      )}
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal">
            <BarChart3 size={18} />
            Skill Analytics
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-ink sm:text-3xl">
            Codex skill usage and health
          </h1>
          <p className="mt-2 max-w-3xl text-sm text-slate-600">
            Historical inference from Codex sessions plus explicit skill lifecycle events.
          </p>
        </div>
        <div className="flex w-full flex-wrap items-center gap-2 lg:w-auto">
          <div className="relative min-w-0 flex-1 sm:flex-none">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter skills or errors"
              className="h-10 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-teal sm:w-64"
            />
          </div>
          <button
            onClick={loadData}
            className="inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink hover:border-teal"
          >
            <RefreshCw size={16} />
            <span className="hidden sm:inline">Refresh</span>
          </button>
          <button
            onClick={runImport}
            disabled={importing}
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white hover:bg-teal disabled:cursor-wait disabled:opacity-70"
          >
            <Database size={16} />
            {importing ? "Importing" : "Import"}
          </button>
        </div>
        {importError && (
          <div className="mt-2 text-xs text-rose-600" title={importError}>
            Import failed: {importError.slice(0, 200)}
          </div>
        )}
      </header>

      <FilterBar
        skills={skills}
        projects={projects}
        category={categoryFilter}
        project={projectFilter}
        hideUnused={hideUnused}
        source={sourceFilter}
        dateFrom={dateFrom}
        dateTo={dateTo}
        onCategory={setCategoryFilter}
        onProject={setProjectFilter}
        onHideUnused={setHideUnused}
        onSource={setSourceFilter}
        onDateFrom={setDateFrom}
        onDateTo={setDateTo}
        filteredCount={filteredSkills.length}
      />

      <nav className="flex flex-wrap gap-2">
        {[
          ["overview", "Overview"],
          ["skills", "Skill Health"],
          ["errors", "Errors"],
          ["timeline", "Timeline"],
          ["comparison", "Compare"],
          ["pricing", "Pricing"],
          ["judgments", "Judgments"]
        ].map(([id, label]) => (
          <button
            key={id}
            onClick={() => setActive(id as typeof active)}
            className={`h-9 rounded-md border px-3 text-sm font-medium ${
              active === id
                ? "border-ink bg-ink text-white"
                : "border-line bg-white text-slate-600 hover:border-teal"
            }`}
          >
            {label}
          </button>
        ))}
      </nav>

      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Active Skills"
          value={`${formatNumber(totals.active_skills)} / ${formatNumber(totals.skills)}`}
          detail={`${activeSkillRate}% of known skills seen in sessions`}
          icon={Activity}
          tone="teal"
          loading={loading && !overview.totals}
        />
        <StatCard
          label="Skill Events"
          value={formatNumber(totals.skill_events)}
          detail="Explicit and inferred lifecycle signals"
          icon={Zap}
          tone="violet"
          loading={loading && !overview.totals}
        />
        <StatCard
          label="Errors"
          value={formatNumber(totals.errors)}
          detail={`${formatNumber(totals.hard_errors)} hard errors or failed calls`}
          icon={AlertTriangle}
          tone="coral"
          loading={loading && !overview.totals}
        />
        <StatCard
          label="Avg Turn"
          value={formatDuration(totals.avg_duration_ms)}
          detail={`${formatNumber(totals.total_tokens)} imported tokens`}
          icon={Timer}
          tone="amber"
          loading={loading && !overview.totals}
        />
      </section>

      {active === "overview" && (
        <section className="grid gap-4 xl:grid-cols-[1.2fr_0.8fr]">
          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Top Skill Activity</h2>
              <span className="text-xs font-medium text-slate-500">
                explicit, mentioned, and agent-session signals
              </span>
            </div>
            {loading && !overview.topSkills?.length ? (
              <ChartSkeleton />
            ) : filteredTopSkills.length ? (
              <div className="h-80">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={filteredTopSkills}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                    <XAxis dataKey="skill_name" tick={{ fontSize: 11 }} interval={0} height={70} angle={-25} textAnchor="end" />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Bar dataKey="events" fill="#0f8f8a" radius={[4, 4, 0, 0]} />
                    <Bar dataKey="errors" fill="#d55c47" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text={categoryActive ? "No skills match the current filters" : "Run Import Data to populate the dashboard"} />
            )}
          </div>

          <div className="panel p-4">
            <h2 className="text-lg font-semibold text-ink">Interpretation Confidence</h2>
            <p className="mt-1 text-sm text-slate-500">
              Explicit events are authoritative; mentions are useful but lower confidence.
            </p>
            {(overview.confidence || []).length ? (
              <div className="mt-4 h-64">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={overview.confidence} dataKey="count" nameKey="confidence" innerRadius={54} outerRadius={92}>
                      {(overview.confidence || []).map((_, index) => (
                        <Cell key={index} fill={COLORS[index % COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="No confidence data imported yet" />
            )}
          </div>

          <div className="panel p-4 xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Activity by Hour of Day</h2>
              <span className="flex items-center gap-1 text-xs font-medium text-slate-500">
                <Clock size={13} /> When sessions are most active
              </span>
            </div>
            {(insights.hourlyActivity || []).length ? (
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={hourlyChartData(insights.hourlyActivity)}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                    <XAxis dataKey="hour" tick={{ fontSize: 11 }} interval={0} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                    <Tooltip />
                    <Bar dataKey="events" fill="#6157a8" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            ) : (
              <EmptyState text="No timestamped events to chart" />
            )}
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Worst Failure Rates</h2>
              <TrendingDown size={18} className="text-coral" />
            </div>
            <p className="mb-3 text-xs text-slate-500">Skills with ≥5 resolved tool calls.</p>
            {filteredFailureLeaders.length ? (
              <div className="flex flex-col divide-y divide-line">
                {filteredFailureLeaders.map((row) => (
                  <button
                    key={row.skill_name}
                    onClick={() => setSkillDetailName(row.skill_name)}
                    className="flex items-center justify-between py-2 text-left hover:bg-surface"
                  >
                    <div className="min-w-0 flex-1 truncate text-sm font-medium text-ink">{row.skill_name}</div>
                    <div className="ml-3 flex items-center gap-3 text-xs text-slate-500">
                      <span>
                        {row.failed}/{row.calls}
                      </span>
                      <span className="font-mono font-semibold text-coral">{row.failure_rate}%</span>
                    </div>
                  </button>
                ))}
              </div>
            ) : (
              <EmptyState text={categoryActive ? "No failures in this filter" : "No failure data yet"} />
            )}
          </div>

          <div className="panel p-4">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Stale Skills</h2>
              <Moon size={18} className="text-slate-400" />
            </div>
            <p className="mb-3 text-xs text-slate-500">No events, or last activity &gt; 30 days ago.</p>
            {filteredStaleSkills.length ? (
              <ul className="flex max-h-56 flex-col divide-y divide-line overflow-auto">
                {filteredStaleSkills.slice(0, 12).map((s) => (
                  <li key={s.name} className="flex items-center justify-between py-2 text-sm">
                    <button
                      onClick={() => setSkillDetailName(s.name)}
                      className="min-w-0 flex-1 truncate text-left font-medium text-ink hover:text-teal"
                    >
                      {s.name}
                    </button>
                    <span className="ml-3 text-xs text-slate-500">
                      {s.events > 0 ? s.last_seen?.slice(0, 10) : "never"}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState text={categoryActive ? "No stale skills in this filter" : "All registered skills have recent activity"} />
            )}
          </div>

          <div className="panel p-4 xl:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-semibold text-ink">Top Failing Commands</h2>
              <Flame size={18} className="text-coral" />
            </div>
            {(insights.topFailingCommands || []).length ? (
              <div className="overflow-hidden rounded-md border border-line">
                <table className="w-full border-collapse text-sm">
                  <thead className="bg-surface text-left text-xs uppercase text-slate-500">
                    <tr>
                      <th className="px-3 py-2">Command</th>
                      <th className="px-3 py-2 text-right">Failures</th>
                      <th className="px-3 py-2">Last Failure</th>
                    </tr>
                  </thead>
                  <tbody>
                    {insights.topFailingCommands!.map((row) => (
                      <tr key={row.command} className="border-t border-line">
                        <td className="mono max-w-xl truncate px-3 py-2 text-xs text-slate-700" title={row.command}>
                          {row.command}
                        </td>
                        <td className="px-3 py-2 text-right font-semibold text-coral">{row.failures}</td>
                        <td className="px-3 py-2 text-xs text-slate-500">{row.last_failure?.slice(0, 19) || "-"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <EmptyState text="No failing commands yet" />
            )}
          </div>

          <div className="panel p-4 xl:col-span-2">
            <h2 className="text-lg font-semibold text-ink">Recent Failure Signals</h2>
            <div className="mt-3 overflow-hidden rounded-md border border-line">
              <table className="w-full border-collapse text-sm">
                <thead className="bg-surface text-left text-xs uppercase text-slate-500">
                  <tr>
                    <th className="px-3 py-2">Severity</th>
                    <th className="px-3 py-2">Category</th>
                    <th className="px-3 py-2">Skill</th>
                    <th className="px-3 py-2">Message</th>
                    <th className="px-3 py-2">Evidence</th>
                  </tr>
                </thead>
                <tbody>
                  {filteredRecentErrors.map((error) => (
                    <tr key={String(error.error_key)} className="border-t border-line">
                      <td className="px-3 py-2 font-medium text-coral">{String(error.severity || "")}</td>
                      <td className="px-3 py-2">{String(error.category || "")}</td>
                      <td className="px-3 py-2">
                        <div className="flex items-center gap-1.5">
                          <SourceBadge source={String(error.source || "") || undefined} />
                          <span>{String(error.skill_name || "-")}</span>
                        </div>
                      </td>
                      <td className="px-3 py-2 text-slate-600">{String(error.message || "")}</td>
                      <td className="px-3 py-2">
                        <button
                          onClick={() => openEvidence(String(error.evidence_id || ""))}
                          className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs hover:border-teal"
                        >
                          <Eye size={13} />
                          View
                        </button>
                      </td>
                    </tr>
                  ))}
                  {filteredRecentErrors.length === 0 && (
                    <tr>
                      <td colSpan={5} className="px-3 py-6 text-center text-xs text-slate-500">
                        {categoryActive ? "No recent errors for this filter" : "No errors yet"}
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </section>
      )}

      {active === "skills" && (
        <section className="panel overflow-hidden">
          <div className="flex items-center justify-between border-b border-line p-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Skill Health</h2>
              <p className="text-sm text-slate-500">
                Click a row for per-skill drill-down. Sorted by activity, then error pressure.
              </p>
            </div>
            <ShieldCheck className="text-teal" size={22} />
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1080px] border-collapse text-sm">
              <thead className="bg-surface text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">Skill</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Events</th>
                  <th className="px-3 py-2">Success</th>
                  <th className="px-3 py-2">Errors</th>
                  <th className="px-3 py-2">Tokens</th>
                  <th className="px-3 py-2">Avg Turn</th>
                  <th className="px-3 py-2">Last Seen</th>
                </tr>
              </thead>
              <tbody>
                {filteredSkills.map((skill) => (
                  <tr
                    key={skill.name}
                    onClick={() => setSkillDetailName(skill.name)}
                    className="cursor-pointer border-t border-line align-top hover:bg-surface"
                  >
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-2 font-semibold text-ink">
                        <SourceBadge source={skill.source} />
                        <span>{skill.name}</span>
                      </div>
                      {skill.project && (
                        <span className="mt-0.5 inline-block rounded bg-violet/10 px-1.5 py-0.5 text-[10px] font-medium text-violet">
                          {skill.project}
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-slate-600">
                      {skill.category ? CATEGORY_LABEL[skill.category as SkillCategoryFilter] || skill.kind : skill.kind}
                    </td>
                    <td className="px-3 py-2">{formatNumber(skill.events)}</td>
                    <td className="px-3 py-2">
                      <SuccessBadge rate={skill.success_rate} calls={skill.tool_calls} />
                    </td>
                    <td className={`px-3 py-2 font-semibold ${skill.errors ? "text-coral" : "text-teal"}`}>
                      {formatNumber(skill.errors)}
                    </td>
                    <td className="px-3 py-2">{formatNumber(skill.total_tokens)}</td>
                    <td className="px-3 py-2">{formatDuration(skill.avg_duration_ms)}</td>
                    <td className="px-3 py-2 text-slate-600">{skill.last_seen?.slice(0, 10) || "-"}</td>
                  </tr>
                ))}
                {filteredSkills.length === 0 && (
                  <tr>
                    <td colSpan={8} className="px-3 py-8 text-center text-sm text-slate-500">
                      No skills match the current filters.
                    </td>
                  </tr>
                )}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {active === "errors" && (
        <section className="panel overflow-hidden">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-line p-4">
            <div>
              <h2 className="text-lg font-semibold text-ink">Errors And Warnings</h2>
              <p className="text-sm text-slate-500">
                Loader warnings, malformed configs, failed commands, patch failures, and explicit skill errors.
              </p>
            </div>
            <div className="flex flex-wrap gap-1.5">
              {(["all", "error", "warn"] as const).map((key) => (
                <button
                  key={key}
                  onClick={() => setSeverityFilter(key)}
                  className={`h-8 rounded-md border px-2.5 text-xs font-medium ${
                    severityFilter === key
                      ? "border-ink bg-ink text-white"
                      : "border-line bg-white text-slate-600 hover:border-teal"
                  }`}
                >
                  {key === "all" ? "All" : key === "error" ? "Errors" : "Warnings"}
                  <span className={`ml-1.5 ${severityFilter === key ? "text-white/70" : "text-slate-400"}`}>
                    {key === "all" ? errors.length : errors.filter((e) => e.severity === key).length}
                  </span>
                </button>
              ))}
            </div>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[1050px] border-collapse text-sm">
              <thead className="bg-surface text-left text-xs uppercase text-slate-500">
                <tr>
                  <th className="px-3 py-2">When</th>
                  <th className="px-3 py-2">Severity</th>
                  <th className="px-3 py-2">Category</th>
                  <th className="px-3 py-2">Skill</th>
                  <th className="px-3 py-2">Message</th>
                  <th className="px-3 py-2">Source</th>
                  <th className="px-3 py-2">Evidence</th>
                </tr>
              </thead>
              <tbody>
                {filteredErrors.map((error) => (
                  <tr key={error.error_key} className="border-t border-line align-top">
                    <td className="px-3 py-2 text-slate-600">{error.timestamp?.slice(0, 19) || "-"}</td>
                    <td className="px-3 py-2 font-semibold text-coral">{error.severity}</td>
                    <td className="px-3 py-2">{error.category}</td>
                    <td className="px-3 py-2">
                      <div className="flex items-center gap-1.5">
                        <SourceBadge source={error.source} />
                        <span>{error.skill_name || "-"}</span>
                      </div>
                    </td>
                    <td className="px-3 py-2 text-slate-600">{error.message}</td>
                    <td className="mono max-w-xs truncate px-3 py-2 text-xs text-slate-500">
                      {shortPath(error.source_path)}
                      {error.source_line ? `:${error.source_line}` : ""}
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => openEvidence(error.evidence_id)}
                        className="inline-flex items-center gap-1 rounded border border-line px-2 py-1 text-xs hover:border-teal"
                      >
                        <Eye size={13} />
                        View
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      )}

      {active === "timeline" && (
        <section className="grid gap-4 xl:grid-cols-2">
          <div className="panel p-4">
            <h2 className="text-lg font-semibold text-ink">Usage And Error Trend</h2>
            <div className="mt-4 h-80">
              {timeline.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <LineChart data={timeline} {...activityBrush.chartProps}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Legend />
                    <Line type="monotone" dataKey="skill_events" stroke="#0f8f8a" strokeWidth={2} dot={false} />
                    <Line type="monotone" dataKey="errors" stroke="#d55c47" strokeWidth={2} dot={false} />
                    {activityBrush.selectionOverlay()}
                  </LineChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No timeline data imported yet" />
              )}
            </div>
            <p className="mt-1 text-xs text-slate-400">
              Tip: click-and-drag horizontally to filter all dashboards by that date range.
            </p>
          </div>
          <div className="panel p-4">
            <h2 className="text-lg font-semibold text-ink">Token Load</h2>
            <div className="mt-4 h-80">
              {timeline.length ? (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={timeline} {...tokenBrush.chartProps}>
                    <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                    <XAxis dataKey="day" tick={{ fontSize: 12 }} />
                    <YAxis tick={{ fontSize: 12 }} />
                    <Tooltip />
                    <Area type="monotone" dataKey="tokens" stroke="#6157a8" fill="#6157a8" fillOpacity={0.2} />
                    {tokenBrush.selectionOverlay()}
                  </AreaChart>
                </ResponsiveContainer>
              ) : (
                <EmptyState text="No token timeline imported yet" />
              )}
            </div>
          </div>
        </section>
      )}

      {active === "comparison" && (
        <ComparisonView data={comparison} onSelectRange={handleChartDateSelect} />
      )}
      {active === "pricing" && <PricingView data={pricing} loading={loading} />}
      {active === "judgments" && <JudgmentsView />}

      {evidence ? (
        <EvidenceModal evidence={evidence} onClose={() => setEvidence(null)} />
      ) : null}
      {skillDetailName ? (
        <SkillDetailModal
          name={skillDetailName}
          onClose={() => setSkillDetailName(null)}
          onOpenEvidence={openEvidence}
          onSelectRange={(from, to) => {
            handleChartDateSelect(from, to);
            // Close the modal so the user can see the filter took effect
            // across the main dashboard.
            setSkillDetailName(null);
          }}
        />
      ) : null}
    </main>
  );
}

type EvidenceSummary = {
  event_id?: string;
  source_path?: string;
  source_line?: number;
  timestamp?: string;
  event_type?: string;
  payload_type?: string;
  turn_id?: string;
  call_id?: string;
  cwd?: string;
  exit_code?: number | null;
  duration_ms?: number | null;
  command?: string | null;
  stdout?: string | null;
  stderr?: string | null;
  aggregated_output?: string | null;
  output?: string | null;
  message?: string | null;
  tool_name?: string | null;
  arguments?: unknown;
};

function cleanTerminalText(value: string | null | undefined): string {
  if (!value) return "";
  return value
    // Strip ANSI color escape sequences (incl. literal  that survived JSON)
    .replace(/\[[0-9;]*m/g, "")
    .replace(/u001b\[[0-9;]*m/g, "")
    // Normalize escaped newlines
    .replace(/\\n/g, "\n")
    .replace(/\\t/g, "\t")
    .replace(/\\"/g, '"');
}

function EvidenceField({ label, value, mono = false }: { label: string; value: React.ReactNode; mono?: boolean }) {
  if (value === null || value === undefined || value === "") return null;
  return (
    <div className="flex flex-col gap-0.5">
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      <span className={`text-sm text-ink ${mono ? "mono break-all text-xs" : ""}`}>{value}</span>
    </div>
  );
}

function EvidenceBlock({ label, value, tone = "neutral" }: { label: string; value: string; tone?: "neutral" | "error" | "command" }) {
  if (!value) return null;
  const toneClasses =
    tone === "error"
      ? "border-coral/40 bg-coral/5 text-coral"
      : tone === "command"
        ? "border-teal/40 bg-teal/5 text-ink"
        : "border-line bg-surface text-slate-700";
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</span>
      </div>
      <pre className={`mono whitespace-pre-wrap break-words rounded-md border px-3 py-2 text-xs ${toneClasses}`}>
        {value}
      </pre>
    </div>
  );
}

function EvidenceModal({ evidence, onClose }: { evidence: Record<string, unknown>; onClose: () => void }) {
  const [showRaw, setShowRaw] = useState(false);
  const summary = (evidence?.evidence ?? evidence) as EvidenceSummary;
  const raw = evidence?.raw;
  const error = (evidence as Record<string, unknown>)?.error as string | undefined;
  const failed = typeof summary?.exit_code === "number" && summary.exit_code !== 0;

  const argsString =
    summary?.arguments == null
      ? ""
      : typeof summary.arguments === "string"
        ? summary.arguments
        : JSON.stringify(summary.arguments, null, 2);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4">
      <div className="panel flex max-h-[90vh] w-full max-w-4xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Evidence</h2>
            <p className="text-xs text-slate-500">
              {summary?.event_type || "event"}
              {summary?.payload_type ? ` · ${summary.payload_type}` : ""}
              {summary?.tool_name ? ` · ${summary.tool_name}` : ""}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => setShowRaw((v) => !v)}
              className="rounded-md border border-line px-3 py-1 text-xs font-medium hover:border-teal"
            >
              {showRaw ? "Structured view" : "Show raw JSON"}
            </button>
            <button
              onClick={onClose}
              className="rounded-md border border-line px-3 py-1 text-sm hover:border-teal"
            >
              Close
            </button>
          </div>
        </div>
        <div className="overflow-auto p-4">
          {error ? (
            <div className="rounded-md border border-coral/40 bg-coral/5 p-3 text-sm text-coral">{error}</div>
          ) : showRaw ? (
            <pre className="mono whitespace-pre-wrap break-words text-xs text-slate-700">
              {JSON.stringify(raw ?? summary, null, 2)}
            </pre>
          ) : (
            <div className="flex flex-col gap-4">
              <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
                <EvidenceField label="Timestamp" value={summary?.timestamp?.replace("T", " ").slice(0, 19)} />
                <EvidenceField
                  label="Status"
                  value={
                    failed ? (
                      <span className="text-coral">Failed (exit {summary?.exit_code})</span>
                    ) : summary?.exit_code === 0 ? (
                      <span className="text-teal">OK</span>
                    ) : (
                      "-"
                    )
                  }
                />
                <EvidenceField
                  label="Duration"
                  value={
                    summary?.duration_ms != null
                      ? `${(summary.duration_ms / 1000).toFixed(2)}s`
                      : null
                  }
                />
                <EvidenceField label="Turn" value={summary?.turn_id} mono />
                <EvidenceField label="Call" value={summary?.call_id} mono />
                <EvidenceField label="CWD" value={summary?.cwd} mono />
              </div>
              <EvidenceBlock label="Command" value={cleanTerminalText(summary?.command)} tone="command" />
              <EvidenceBlock label="Arguments" value={argsString} />
              <EvidenceBlock label="Message" value={cleanTerminalText(summary?.message)} />
              <EvidenceBlock
                label="Output"
                value={cleanTerminalText(summary?.aggregated_output || summary?.output || summary?.stdout)}
                tone={failed ? "error" : "neutral"}
              />
              <EvidenceBlock label="Stderr" value={cleanTerminalText(summary?.stderr)} tone="error" />
              <div className="flex flex-col gap-1 border-t border-line pt-3">
                <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
                <span className="mono break-all text-xs text-slate-500">
                  {summary?.source_path}
                  {summary?.source_line ? `:${summary.source_line}` : ""}
                </span>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function FilterBar({
  skills,
  projects,
  category,
  project,
  hideUnused,
  source,
  dateFrom,
  dateTo,
  onCategory,
  onProject,
  onHideUnused,
  onSource,
  onDateFrom,
  onDateTo,
  filteredCount
}: {
  skills: SkillRow[];
  projects: string[];
  category: SkillCategoryFilter;
  project: string;
  hideUnused: boolean;
  source: SourceFilter;
  dateFrom: string;
  dateTo: string;
  onCategory: (v: SkillCategoryFilter) => void;
  onProject: (v: string) => void;
  onHideUnused: (v: boolean) => void;
  onSource: (v: SourceFilter) => void;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
  filteredCount: number;
}) {
  const presetRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    onDateFrom(from.toISOString().slice(0, 10));
    onDateTo(to.toISOString().slice(0, 10));
  };
  return (
    <div className="panel flex flex-col gap-3 p-3 sm:p-4">
      {/* Row 1: source toggle + date range */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SOURCE_LABEL) as SourceFilter[]).map((key) => {
            const active = source === key;
            const activeColor =
              key === "claude"
                ? "border-claude bg-claude text-white"
                : key === "codex"
                  ? "border-codex bg-codex text-white"
                  : "border-ink bg-ink text-white";
            return (
              <button
                key={key}
                onClick={() => onSource(key)}
                className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium transition-colors ${
                  active ? activeColor : "border-line bg-white text-slate-600 hover:border-slate-400"
                }`}
              >
                {key === "claude" && <ClaudeLogo size={12} className={active ? "" : "text-claude"} />}
                {key === "codex" && <CodexLogo size={12} className={active ? "" : "text-codex"} />}
                {SOURCE_LABEL[key]}
              </button>
            );
          })}
        </div>
        <span className="mx-2 hidden h-5 w-px bg-line sm:block" />
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Range</span>
        <input
          type="date"
          value={dateFrom}
          onChange={(e) => onDateFrom(e.target.value)}
          className="h-8 rounded-md border border-line bg-white px-2 text-xs outline-none focus:border-teal"
          aria-label="From date"
        />
        <span className="text-xs text-slate-400">→</span>
        <input
          type="date"
          value={dateTo}
          onChange={(e) => onDateTo(e.target.value)}
          className="h-8 rounded-md border border-line bg-white px-2 text-xs outline-none focus:border-teal"
          aria-label="To date"
        />
        <div className="flex flex-wrap gap-1">
          {[
            { label: "7d", days: 7 },
            { label: "30d", days: 30 },
            { label: "90d", days: 90 }
          ].map((p) => (
            <button
              key={p.label}
              onClick={() => presetRange(p.days)}
              className="h-8 rounded-md border border-line bg-white px-2 text-xs font-medium text-slate-600 hover:border-teal"
            >
              {p.label}
            </button>
          ))}
          {(dateFrom || dateTo) && (
            <button
              onClick={() => {
                onDateFrom("");
                onDateTo("");
              }}
              className="h-8 rounded-md border border-line bg-white px-2 text-xs font-medium text-coral hover:border-coral"
              title="Clear date range"
            >
              Clear
            </button>
          )}
        </div>
      </div>
      {/* Row 2: category + project + hide unused */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(CATEGORY_LABEL) as SkillCategoryFilter[]).map((key) => {
            const count = key === "all" ? skills.length : skills.filter((s) => s.category === key).length;
            if (count === 0 && key !== "all") return null;
            const isActive = category === key;
            return (
              <button
                key={key}
                onClick={() => onCategory(key)}
                className={`h-8 rounded-md border px-2.5 text-xs font-medium ${
                  isActive
                    ? "border-ink bg-ink text-white"
                    : "border-line bg-white text-slate-600 hover:border-teal"
                }`}
              >
                {CATEGORY_LABEL[key]}
                <span className={`ml-1.5 ${isActive ? "text-white/70" : "text-slate-400"}`}>{count}</span>
              </button>
            );
          })}
        </div>
        {projects.length > 0 && (
          <label className="flex items-center gap-1.5 text-xs font-medium text-slate-600">
            Project
            <select
              value={project}
              onChange={(e) => onProject(e.target.value)}
              className="h-8 rounded-md border border-line bg-white px-2 text-xs outline-none focus:border-teal"
            >
              <option value="all">All</option>
              {projects.map((p) => (
                <option key={p} value={p}>
                  {p}
                </option>
              ))}
            </select>
          </label>
        )}
        <button
          onClick={() => onHideUnused(!hideUnused)}
          className={`inline-flex h-8 items-center gap-1.5 rounded-md border px-2.5 text-xs font-medium ${
            hideUnused
              ? "border-ink bg-ink text-white"
              : "border-line bg-white text-slate-600 hover:border-teal"
          }`}
          title="Hide skills with zero events"
        >
          {hideUnused ? <EyeOff size={13} /> : <Eye size={13} />}
          Hide unused
        </button>
        <span className="ml-auto text-xs text-slate-500">
          {filteredCount} of {skills.length} skills
        </span>
      </div>
    </div>
  );
}

function SuccessBadge({ rate, calls }: { rate?: number | null; calls?: number }) {
  if (rate == null || !calls) {
    return <span className="text-xs text-slate-400">—</span>;
  }
  const tone = rate >= 90 ? "text-teal" : rate >= 70 ? "text-amber" : "text-coral";
  return (
    <div className="flex flex-col">
      <span className={`text-sm font-semibold ${tone}`}>{rate}%</span>
      <span className="text-[10px] text-slate-400">{calls} calls</span>
    </div>
  );
}

function hourlyChartData(rows?: Array<{ hour: number; events: number }>) {
  const byHour = new Map<number, number>();
  (rows || []).forEach((r) => byHour.set(Number(r.hour), Number(r.events)));
  return Array.from({ length: 24 }, (_, h) => ({
    hour: `${String(h).padStart(2, "0")}h`,
    events: byHour.get(h) || 0
  }));
}

type SkillDetail = {
  skill: { name: string; kind: string; path?: string; description?: string };
  recentEvents: Array<{
    event_key: string;
    event_type?: string;
    confidence?: string;
    timestamp?: string;
    source_kind?: string;
    evidence_id?: string;
    notes?: string;
  }>;
  recentErrors: Array<{
    error_key: string;
    timestamp?: string;
    severity: string;
    category: string;
    message: string;
    evidence_id?: string;
  }>;
  tools: Array<{ tool_name: string; calls: number; failed: number }>;
  daily: Array<{ day: string; events: number }>;
};

type DiagnoseResult = {
  agent: "codex" | "claude";
  mode: "analyze" | "fix";
  cwd: string;
  prompt: string;
  stdout: string;
  stderr: string;
  ok: boolean;
  code: number | null;
};

function SkillDetailModal({
  name,
  onClose,
  onOpenEvidence,
  onSelectRange,
}: {
  name: string;
  onClose: () => void;
  onOpenEvidence: (id?: string) => void;
  onSelectRange?: (from: string, to: string) => void;
}) {
  const dailyBrush = useChartDateBrush(onSelectRange || (() => {}));
  const [detail, setDetail] = useState<SkillDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  // Diagnose & fix state — null when idle, "analyzing"/"fixing" while in flight.
  const [diagnoseState, setDiagnoseState] = useState<"idle" | "analyzing" | "fixing">("idle");
  const [diagnoseResult, setDiagnoseResult] = useState<DiagnoseResult | null>(null);
  const [confirmFix, setConfirmFix] = useState<"codex" | "claude" | null>(null);

  async function runDiagnose(agent: "codex" | "claude", mode: "analyze" | "fix") {
    setDiagnoseState(mode === "fix" ? "fixing" : "analyzing");
    try {
      const res = await fetch(`/api/skills/${encodeURIComponent(name)}/diagnose`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ agent, mode })
      });
      const body = (await res.json()) as DiagnoseResult | { error: string };
      if ("error" in body) {
        setDiagnoseResult({
          agent,
          mode,
          cwd: "",
          prompt: "",
          stdout: "",
          stderr: body.error,
          ok: false,
          code: null
        });
      } else {
        setDiagnoseResult(body);
      }
    } catch (e) {
      setDiagnoseResult({
        agent,
        mode,
        cwd: "",
        prompt: "",
        stdout: "",
        stderr: e instanceof Error ? e.message : String(e),
        ok: false,
        code: null
      });
    } finally {
      setDiagnoseState("idle");
    }
  }

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`/api/metrics/skills/${encodeURIComponent(name)}`, { cache: "no-store" });
        if (!res.ok) {
          setError("Skill not found");
          return;
        }
        const body = await res.json();
        if (!cancelled) setDetail(body);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Failed to load");
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [name]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-3 sm:p-4">
      <div className="panel flex max-h-[92vh] w-full max-w-5xl flex-col overflow-hidden">
        <div className="flex items-center justify-between border-b border-line p-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-teal">
              {detail?.skill.kind || "Skill"}
            </div>
            <h2 className="truncate text-lg font-semibold text-ink">{name}</h2>
            {detail?.skill.description && (
              <p className="mt-0.5 line-clamp-2 text-xs text-slate-500">{detail.skill.description}</p>
            )}
          </div>
          <button
            onClick={onClose}
            className="ml-3 inline-flex h-9 w-9 items-center justify-center rounded-md border border-line hover:border-teal"
            aria-label="Close"
          >
            <X size={16} />
          </button>
        </div>
        <div className="overflow-auto p-4">
          {error ? (
            <div className="rounded-md border border-coral/40 bg-coral/5 p-3 text-sm text-coral">{error}</div>
          ) : !detail ? (
            <EmptyState text="Loading" />
          ) : (
            <div className="flex flex-col gap-5">
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <DetailMetric label="Events" value={detail.recentEvents.length === 25 ? "25+" : String(detail.recentEvents.length)} />
                <DetailMetric label="Recent Errors" value={String(detail.recentErrors.length)} tone={detail.recentErrors.length ? "coral" : "teal"} />
                <DetailMetric label="Active days" value={String(detail.daily.length)} />
              </div>

              {detail.daily.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Daily Activity</h3>
                  <div className="h-44">
                    <ResponsiveContainer width="100%" height="100%">
                      <AreaChart data={detail.daily} {...dailyBrush.chartProps}>
                        <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                        <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                        <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                        <Tooltip />
                        <Area type="monotone" dataKey="events" stroke="#0f8f8a" fill="#0f8f8a" fillOpacity={0.2} />
                        {dailyBrush.selectionOverlay()}
                      </AreaChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              )}

              {detail.tools.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Tools Used in Same Turns</h3>
                  <div className="overflow-hidden rounded-md border border-line">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-surface text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">Tool</th>
                          <th className="px-3 py-2 text-right">Calls</th>
                          <th className="px-3 py-2 text-right">Failed</th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.tools.map((t) => (
                          <tr key={t.tool_name} className="border-t border-line">
                            <td className="mono px-3 py-2 text-xs text-slate-700">{t.tool_name}</td>
                            <td className="px-3 py-2 text-right">{t.calls}</td>
                            <td className={`px-3 py-2 text-right ${t.failed ? "text-coral" : "text-slate-400"}`}>{t.failed}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              {detail.recentErrors.length > 0 && (
                <div className="rounded-md border border-amber/30 bg-amber/5 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-ink">Diagnose & Fix</h3>
                      <p className="mt-0.5 text-xs text-slate-600">
                        Have Codex or Claude investigate the recent errors and propose (or apply) a fix.
                        Analysis runs sandboxed read-only; fixes are blocked until you confirm.
                      </p>
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <button
                        disabled={diagnoseState !== "idle"}
                        onClick={() => runDiagnose("codex", "analyze")}
                        className="inline-flex items-center gap-1.5 rounded-md border border-codex bg-white px-3 py-1.5 text-xs font-medium text-codex hover:bg-codex hover:text-white disabled:cursor-wait disabled:opacity-60"
                      >
                        <CodexLogo size={12} /> Diagnose with Codex
                      </button>
                      <button
                        disabled={diagnoseState !== "idle"}
                        onClick={() => runDiagnose("claude", "analyze")}
                        className="inline-flex items-center gap-1.5 rounded-md border border-claude bg-white px-3 py-1.5 text-xs font-medium text-claude hover:bg-claude hover:text-white disabled:cursor-wait disabled:opacity-60"
                      >
                        <ClaudeLogo size={12} /> Diagnose with Claude
                      </button>
                    </div>
                  </div>

                  {diagnoseState !== "idle" && (
                    <div className="mt-3 flex items-center gap-2 text-xs text-slate-500">
                      <span className="inline-block h-3 w-3 animate-spin rounded-full border-2 border-slate-300 border-t-amber" />
                      {diagnoseState === "analyzing" ? "Investigating in sandbox…" : "Applying fix…"} (may take 30–120s)
                    </div>
                  )}

                  {diagnoseResult && diagnoseState === "idle" && (
                    <div className="mt-3 rounded-md border border-line bg-white">
                      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-3 py-2">
                        <span className="flex items-center gap-1.5 text-xs font-semibold text-ink">
                          {diagnoseResult.agent === "codex" ? <CodexLogo size={12} /> : <ClaudeLogo size={12} />}
                          {diagnoseResult.agent === "codex" ? "Codex" : "Claude"} ·{" "}
                          {diagnoseResult.mode === "fix" ? "Fix applied" : "Diagnosis"} ·{" "}
                          {diagnoseResult.ok ? <span className="text-teal">OK</span> : <span className="text-coral">exit {diagnoseResult.code}</span>}
                        </span>
                        {diagnoseResult.mode === "analyze" && diagnoseResult.ok && (
                          <button
                            onClick={() => setConfirmFix(diagnoseResult.agent)}
                            className="inline-flex items-center gap-1.5 rounded-md bg-coral px-2.5 py-1 text-xs font-semibold text-white hover:opacity-90"
                          >
                            Apply fix with {diagnoseResult.agent === "codex" ? "Codex" : "Claude"}…
                          </button>
                        )}
                      </div>
                      <pre className="mono max-h-80 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-slate-700">
                        {diagnoseResult.stdout || diagnoseResult.stderr || "(no output)"}
                      </pre>
                      {diagnoseResult.stderr && diagnoseResult.stdout && (
                        <details className="border-t border-line">
                          <summary className="cursor-pointer px-3 py-2 text-xs text-slate-500 hover:text-coral">Show stderr</summary>
                          <pre className="mono max-h-40 overflow-auto whitespace-pre-wrap break-words p-3 text-xs text-coral">
                            {diagnoseResult.stderr}
                          </pre>
                        </details>
                      )}
                    </div>
                  )}
                </div>
              )}

              {confirmFix && (
                <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/50 p-4">
                  <div className="w-full max-w-md rounded-md border border-line bg-white p-5 shadow-xl">
                    <h3 className="text-base font-semibold text-ink">Apply fix to {detail.skill.name}?</h3>
                    <p className="mt-2 text-sm text-slate-600">
                      This will run <span className="font-semibold">{confirmFix === "codex" ? "Codex" : "Claude"}</span>{" "}
                      with workspace-write permissions on{" "}
                      <span className="mono text-xs">{detail.skill.path || "the skill's directory"}</span>. Files may be modified.
                    </p>
                    <p className="mt-2 text-xs text-coral">
                      The agent will attempt to edit your skill file. Review changes in your editor after it finishes.
                    </p>
                    <div className="mt-4 flex justify-end gap-2">
                      <button
                        onClick={() => setConfirmFix(null)}
                        className="rounded-md border border-line px-3 py-1.5 text-sm hover:border-teal"
                      >
                        Cancel
                      </button>
                      <button
                        onClick={() => {
                          const agent = confirmFix;
                          setConfirmFix(null);
                          runDiagnose(agent, "fix");
                        }}
                        className="rounded-md bg-coral px-3 py-1.5 text-sm font-semibold text-white hover:opacity-90"
                      >
                        Yes, apply fix
                      </button>
                    </div>
                  </div>
                </div>
              )}

              {detail.recentErrors.length > 0 && (
                <div>
                  <h3 className="mb-2 text-sm font-semibold text-ink">Recent Errors</h3>
                  <div className="overflow-hidden rounded-md border border-line">
                    <table className="w-full border-collapse text-sm">
                      <thead className="bg-surface text-left text-xs uppercase text-slate-500">
                        <tr>
                          <th className="px-3 py-2">When</th>
                          <th className="px-3 py-2">Category</th>
                          <th className="px-3 py-2">Message</th>
                          <th className="px-3 py-2"></th>
                        </tr>
                      </thead>
                      <tbody>
                        {detail.recentErrors.map((e) => (
                          <tr key={e.error_key} className="border-t border-line align-top">
                            <td className="px-3 py-2 text-xs text-slate-500">{e.timestamp?.slice(0, 19) || "-"}</td>
                            <td className="px-3 py-2 text-xs">{e.category}</td>
                            <td className="px-3 py-2 text-xs text-slate-700">{e.message}</td>
                            <td className="px-3 py-2 text-right">
                              <button
                                onClick={() => onOpenEvidence(e.evidence_id)}
                                className="rounded border border-line px-2 py-0.5 text-xs hover:border-teal"
                              >
                                Evidence
                              </button>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}

              <div>
                <h3 className="mb-2 text-sm font-semibold text-ink">Recent Events</h3>
                <ul className="flex flex-col divide-y divide-line rounded-md border border-line">
                  {detail.recentEvents.slice(0, 15).map((e) => (
                    <li key={e.event_key} className="flex items-start justify-between gap-3 px-3 py-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2 text-xs">
                          <span className="font-medium text-ink">{e.event_type || "event"}</span>
                          <span className="rounded bg-surface px-1.5 py-0.5 text-[10px] text-slate-500">
                            {e.confidence}
                          </span>
                          <span className="text-slate-400">{e.timestamp?.slice(0, 19)}</span>
                        </div>
                        {e.notes && (
                          <div className="mt-1 line-clamp-2 text-xs text-slate-600">{e.notes}</div>
                        )}
                      </div>
                      {e.evidence_id && (
                        <button
                          onClick={() => onOpenEvidence(e.evidence_id)}
                          className="shrink-0 rounded border border-line px-2 py-0.5 text-xs hover:border-teal"
                        >
                          View
                        </button>
                      )}
                    </li>
                  ))}
                </ul>
              </div>

              {detail.skill.path && (
                <div className="border-t border-line pt-3">
                  <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</div>
                  <div className="mono break-all text-xs text-slate-500">{detail.skill.path}</div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function DetailMetric({ label, value, tone = "ink" }: { label: string; value: string; tone?: "ink" | "teal" | "coral" }) {
  const toneClass = tone === "teal" ? "text-teal" : tone === "coral" ? "text-coral" : "text-ink";
  return (
    <div className="rounded-md border border-line bg-white p-3">
      <div className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">{label}</div>
      <div className={`mt-1 text-xl font-semibold ${toneClass}`}>{value}</div>
    </div>
  );
}

function ComparisonView({
  data,
  onSelectRange,
}: {
  data: ComparisonData;
  onSelectRange?: (from: string, to: string) => void;
}) {
  // No-op fallback so the hook contract is satisfied even when parent
  // doesn't wire a setter (e.g. preview / storybook usage).
  const eventsBrush = useChartDateBrush(onSelectRange || (() => {}));
  const tokensBrushChart = useChartDateBrush(onSelectRange || (() => {}));
  const codex = data.sources?.find((s) => s.source === "codex");
  const claude = data.sources?.find((s) => s.source === "claude");
  const cursorSrc = data.sources?.find((s) => s.source === "cursor");

  if (!codex && !claude && !cursorSrc) {
    return (
      <section className="panel p-8">
        <EmptyState text="Run Import Data to populate comparison" />
      </section>
    );
  }

  const totalKeys: Array<{ key: string; label: string; fmt?: "num" | "tokens" }> = [
    { key: "turns", label: "Sessions" },
    { key: "skill_events", label: "Skill Events" },
    { key: "active_skills", label: "Active Skills" },
    { key: "skills", label: "Registered Skills" },
    { key: "tool_calls", label: "Tool Calls" },
    { key: "tool_failed", label: "Failed Calls" },
    { key: "errors", label: "Errors" },
    { key: "total_tokens", label: "Tokens", fmt: "tokens" }
  ];

  const mergeDaily = (
    sources: Array<{ key: string; rows: Array<{ day: string } & Record<string, unknown>> | undefined }>,
    valueKey: string
  ) => {
    const merged: Record<string, Record<string, string | number>> = {};
    for (const { key, rows } of sources) {
      (rows || []).forEach((d) => {
        if (!merged[d.day]) merged[d.day] = { day: d.day };
        merged[d.day][key] = Number(d[valueKey] || 0);
      });
    }
    return Object.values(merged).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  };
  const dailyMerged = mergeDaily(
    [{ key: "codex", rows: codex?.daily }, { key: "claude", rows: claude?.daily }, { key: "cursor", rows: cursorSrc?.daily }],
    "events"
  );
  const tokensMerged = mergeDaily(
    [{ key: "codex", rows: codex?.dailyTokens }, { key: "claude", rows: claude?.dailyTokens }, { key: "cursor", rows: cursorSrc?.dailyTokens }],
    "tokens"
  );

  // Hourly cadence overlay so the user can see when each tool is most active.
  const hourlyMerged = Array.from({ length: 24 }, (_, h) => {
    const c = codex?.hourly?.find((r) => Number(r.hour) === h);
    const cl = claude?.hourly?.find((r) => Number(r.hour) === h);
    const cu = cursorSrc?.hourly?.find((r) => Number(r.hour) === h);
    return {
      hour: `${String(h).padStart(2, "0")}h`,
      codex: c?.events || 0,
      claude: cl?.events || 0,
      cursor: cu?.events || 0
    };
  });

  const tokenBreakdownData = [
    { kind: "Input", codex: codex?.tokenBreakdown?.input_tokens || 0, claude: claude?.tokenBreakdown?.input_tokens || 0, cursor: cursorSrc?.tokenBreakdown?.input_tokens || 0 },
    { kind: "Cached", codex: codex?.tokenBreakdown?.cached_input_tokens || 0, claude: claude?.tokenBreakdown?.cached_input_tokens || 0, cursor: cursorSrc?.tokenBreakdown?.cached_input_tokens || 0 },
    { kind: "Output", codex: codex?.tokenBreakdown?.output_tokens || 0, claude: claude?.tokenBreakdown?.output_tokens || 0, cursor: cursorSrc?.tokenBreakdown?.output_tokens || 0 },
    { kind: "Reasoning", codex: codex?.tokenBreakdown?.reasoning_tokens || 0, claude: claude?.tokenBreakdown?.reasoning_tokens || 0, cursor: cursorSrc?.tokenBreakdown?.reasoning_tokens || 0 }
  ];
  const tokensTotalCodex = tokenBreakdownData.reduce((a, b) => a + b.codex, 0);
  const tokensTotalClaude = tokenBreakdownData.reduce((a, b) => a + b.claude, 0);
  const tokensTotalCursor = tokenBreakdownData.reduce((a, b) => a + b.cursor, 0);

  return (
    <section className="flex flex-col gap-5">
      {/* Heading */}
      <div className="grid gap-3 sm:grid-cols-3">
        <SourceHeader name="Codex" totals={codex?.totals} tone="codex" />
        <SourceHeader name="Claude" totals={claude?.totals} tone="claude" />
        <SourceHeader name="Cursor" totals={cursorSrc?.totals} tone="cursor" />
      </div>

      {/* Side-by-side totals table */}
      <div className="panel overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-lg font-semibold text-ink">Totals — All Sources</h2>
          <p className="text-sm text-slate-500">Within the selected date range.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Metric</th>
                <th className="px-3 py-2 text-right">Codex</th>
                <th className="px-3 py-2 text-right">Claude</th>
                <th className="px-3 py-2 text-right">Cursor</th>
                <th className="px-3 py-2">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {totalKeys.map(({ key, label, fmt }) => {
                const c = Number(codex?.totals?.[key] || 0);
                const cl = Number(claude?.totals?.[key] || 0);
                const cu = Number(cursorSrc?.totals?.[key] || 0);
                const total = c + cl + cu;
                const pctCodex = total > 0 ? (c / total) * 100 : 0;
                const pctClaude = total > 0 ? (cl / total) * 100 : 0;
                const formatVal = (n: number) =>
                  fmt === "tokens" ? new Intl.NumberFormat("en-US").format(n) : formatNumber(n);
                return (
                  <tr key={key} className="border-t border-line">
                    <td className="px-3 py-2 font-medium text-ink">{label}</td>
                    <td className="px-3 py-2 text-right font-semibold text-codex">{formatVal(c)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-claude">{formatVal(cl)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-cursor">{formatVal(cu)}</td>
                    <td className="px-3 py-2">
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
                        <div className="bg-codex" style={{ width: `${pctCodex}%` }} />
                        <div className="bg-claude" style={{ width: `${pctClaude}%` }} />
                        <div className="bg-cursor" style={{ width: `${100 - pctCodex - pctClaude}%` }} />
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      {/* Daily activity overlay */}
      <div className="panel p-4">
        <h2 className="text-lg font-semibold text-ink">Daily Activity</h2>
        <p className="mb-3 text-sm text-slate-500">Skill events per day, both sources.</p>
        {dailyMerged.length ? (
          <div className="h-64">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={dailyMerged} {...eventsBrush.chartProps}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="codex" stroke={BRAND.codex} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="claude" stroke={BRAND.claude} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="cursor" stroke={BRAND.cursor} strokeWidth={2} dot={false} />
                {eventsBrush.selectionOverlay()}
              </LineChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="No daily activity in this range" />
        )}
      </div>

      {/* Daily token burn — area chart with both sources stacked side by side */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Daily Token Usage</h2>
            <p className="text-sm text-slate-500">Cumulative tokens per session, summed per day.</p>
          </div>
          <div className="flex items-center gap-3 text-xs">
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-full bg-codex" /> Codex {formatNumber(tokensTotalCodex)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-full bg-claude" /> Claude {formatNumber(tokensTotalClaude)}
            </span>
            <span className="inline-flex items-center gap-1">
              <span className="h-2 w-3 rounded-full bg-cursor" /> Cursor {formatNumber(tokensTotalCursor)}
            </span>
          </div>
        </div>
        {tokensMerged.length ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={tokensMerged} {...tokensBrushChart.chartProps}>
                <defs>
                  <linearGradient id="g-codex" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.codex} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={BRAND.codex} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-claude" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.claude} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={BRAND.claude} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="g-cursor" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.cursor} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={BRAND.cursor} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatTokens(Number(v))} />
                <Tooltip formatter={(v: number) => formatNumber(v)} />
                <Legend />
                <Area type="monotone" dataKey="codex" stroke={BRAND.codex} fill="url(#g-codex)" strokeWidth={2} />
                <Area type="monotone" dataKey="claude" stroke={BRAND.claude} fill="url(#g-claude)" strokeWidth={2} />
                <Area type="monotone" dataKey="cursor" stroke={BRAND.cursor} fill="url(#g-cursor)" strokeWidth={2} />
                {tokensBrushChart.selectionOverlay()}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="No token data in this range" />
        )}
      </div>

      {/* Token breakdown — input vs cached vs output vs reasoning, grouped bars */}
      <div className="panel p-4">
        <h2 className="text-lg font-semibold text-ink">Token Breakdown</h2>
        <p className="mb-3 text-sm text-slate-500">Where tokens go: input, cached, output, reasoning.</p>
        <div className="h-64">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={tokenBreakdownData}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
              <XAxis dataKey="kind" tick={{ fontSize: 12 }} />
              <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatTokens(Number(v))} />
              <Tooltip formatter={(v: number) => formatNumber(v)} />
              <Legend />
              <Bar dataKey="codex" fill={BRAND.codex} radius={[4, 4, 0, 0]} />
              <Bar dataKey="claude" fill={BRAND.claude} radius={[4, 4, 0, 0]} />
              <Bar dataKey="cursor" fill={BRAND.cursor} radius={[4, 4, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Hourly cadence — see when each is actually used */}
      <div className="panel p-4">
        <h2 className="text-lg font-semibold text-ink">When You Use Each Tool</h2>
        <p className="mb-3 text-sm text-slate-500">Events by hour-of-day across the entire range.</p>
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={hourlyMerged}>
              <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
              <XAxis dataKey="hour" tick={{ fontSize: 10 }} interval={1} />
              <YAxis tick={{ fontSize: 11 }} allowDecimals={false} />
              <Tooltip />
              <Legend />
              <Bar dataKey="codex" fill={BRAND.codex} radius={[3, 3, 0, 0]} />
              <Bar dataKey="claude" fill={BRAND.claude} radius={[3, 3, 0, 0]} />
              <Bar dataKey="cursor" fill={BRAND.cursor} radius={[3, 3, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>

      {/* Top tools side-by-side */}
      <div className="grid gap-3 sm:grid-cols-3">
        <TopList title="Top Codex Tools" tone="codex" rows={codex?.topTools || []} />
        <TopList title="Top Claude Tools" tone="claude" rows={claude?.topTools || []} />
        <TopList title="Top Cursor Tools" tone="cursor" rows={cursorSrc?.topTools || []} />
      </div>

      {/* Top models side-by-side */}
      <div className="grid gap-3 sm:grid-cols-3">
        <ModelList title="Codex Models" tone="codex" rows={codex?.topModels || []} />
        <ModelList title="Claude Models" tone="claude" rows={claude?.topModels || []} />
        <ModelList title="Cursor Models" tone="cursor" rows={cursorSrc?.topModels || []} />
      </div>
    </section>
  );
}

type BrandTone = "codex" | "claude" | "cursor";

function brandClasses(tone: BrandTone) {
  if (tone === "claude") return { text: "text-claude", bg: "bg-claude", tint: "bg-claude-tint", border: "border-claude" };
  if (tone === "cursor") return { text: "text-cursor", bg: "bg-cursor", tint: "bg-cursor-tint", border: "border-cursor" };
  return { text: "text-codex", bg: "bg-codex", tint: "bg-codex-tint", border: "border-codex" };
}

function SourceHeader({
  name,
  totals,
  tone
}: {
  name: string;
  totals?: Record<string, number>;
  tone: BrandTone;
}) {
  const t = totals || {};
  const cls = brandClasses(tone);
  const Logo = tone === "claude" ? ClaudeLogo : tone === "cursor" ? CursorLogo : CodexLogo;
  return (
    <div className={`panel overflow-hidden border-2 ${cls.border}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${cls.tint}`}>
        <div className="flex items-center gap-2">
          <span className={`flex h-8 w-8 items-center justify-center rounded-md ${cls.bg} text-white`}>
            <Logo size={18} />
          </span>
          <h3 className={`text-lg font-semibold ${cls.text}`}>{name}</h3>
        </div>
        <span className={`h-1.5 w-12 rounded-full ${cls.bg}`} />
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 text-sm">
        <div>
          <div className="text-[10px] uppercase text-slate-500">Sessions</div>
          <div className="font-semibold text-ink">{formatNumber(t.turns)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Tool Calls</div>
          <div className="font-semibold text-ink">{formatNumber(t.tool_calls)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Errors</div>
          <div className="font-semibold text-coral">{formatNumber(t.errors)}</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Tokens</div>
          <div className="font-semibold text-ink">{formatNumber(t.total_tokens)}</div>
        </div>
      </div>
    </div>
  );
}

function TopList({
  title,
  rows,
  tone
}: {
  title: string;
  rows: Array<{ tool_name: string; calls: number; failed: number }>;
  tone: BrandTone;
}) {
  const cls = brandClasses(tone);
  const Logo = tone === "claude" ? ClaudeLogo : tone === "cursor" ? CursorLogo : CodexLogo;
  return (
    <div className="panel p-4">
      <h3 className={`mb-3 flex items-center gap-2 text-sm font-semibold ${cls.text}`}>
        <Logo size={14} /> {title}
      </h3>
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.tool_name} className="flex items-center justify-between py-1.5 text-sm">
              <span className="mono text-xs text-ink">{r.tool_name}</span>
              <span className="flex items-center gap-2 text-xs text-slate-500">
                <span>{formatNumber(r.calls)}</span>
                {r.failed > 0 && <span className="text-coral">{r.failed} failed</span>}
              </span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="No tool data" />
      )}
    </div>
  );
}

function ModelList({
  title,
  rows,
  tone
}: {
  title: string;
  rows: Array<{ model: string; turns: number }>;
  tone: BrandTone;
}) {
  const cls = brandClasses(tone);
  const Logo = tone === "claude" ? ClaudeLogo : tone === "cursor" ? CursorLogo : CodexLogo;
  return (
    <div className="panel p-4">
      <h3 className={`mb-3 flex items-center gap-2 text-sm font-semibold ${cls.text}`}>
        <Logo size={14} /> {title}
      </h3>
      {rows.length ? (
        <ul className="divide-y divide-line">
          {rows.map((r) => (
            <li key={r.model} className="flex items-center justify-between py-1.5 text-sm">
              <span className="mono text-xs text-ink">{r.model}</span>
              <span className="text-xs text-slate-500">{formatNumber(r.turns)} sessions</span>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState text="No model data" />
      )}
    </div>
  );
}

// =====================================================================
// Pricing view — applies live 2026 API pricing to recorded token usage.
// =====================================================================

function formatUsd(value: number) {
  if (!isFinite(value)) return "$0";
  if (Math.abs(value) >= 1_000_000) return `$${(value / 1_000_000).toFixed(2)}M`;
  if (Math.abs(value) >= 1_000) return `$${(value / 1_000).toFixed(2)}k`;
  if (Math.abs(value) >= 100) return `$${value.toFixed(0)}`;
  if (Math.abs(value) >= 1) return `$${value.toFixed(2)}`;
  return `$${value.toFixed(4)}`;
}

function PricingView({ data, loading }: { data: PricingData; loading: boolean }) {
  const totals = data.totals;
  const models = data.models || [];
  const daily = data.daily || [];
  const perSkill = data.perSkill || [];

  if (loading && !totals) {
    return (
      <section className="grid gap-3 sm:grid-cols-3">
        <div className="panel p-4"><span className="skeleton h-7 w-32">.</span></div>
        <div className="panel p-4"><span className="skeleton h-7 w-32">.</span></div>
        <div className="panel p-4"><span className="skeleton h-7 w-32">.</span></div>
      </section>
    );
  }
  if (!totals || totals.overall === 0) {
    return (
      <section className="panel p-8">
        <EmptyState text="No token data — run Import to populate pricing." />
      </section>
    );
  }

  // What the same workload would have cost WITHOUT caching, for the savings KPI banner.
  const wouldHaveCost = totals.overall + totals.saved_by_caching;
  const savingsPct = wouldHaveCost > 0 ? Math.round((totals.saved_by_caching / wouldHaveCost) * 100) : 0;

  // Codex tokens are actually billed by ChatGPT subscription. Pick the tier
  // whose monthly cap covers the spend so we can show "you'd break even at…".
  const monthsCodex = pickMonths(daily, "codex");
  const monthsClaude = pickMonths(daily, "claude");
  const codexPerMonth = monthsCodex > 0 ? totals.codex / monthsCodex : totals.codex;
  const claudePerMonth = monthsClaude > 0 ? totals.claude / monthsClaude : totals.claude;
  const codexTier = pickTier(codexPerMonth, "codex");
  const claudeTier = pickTier(claudePerMonth, "claude");

  // Bars for the cost-per-model chart, colored by source.
  const modelBarData = models.slice(0, 12).map((m) => ({
    label: m.model.replace("claude-", "").replace("gpt-", "GPT "),
    full: m.model,
    source: m.source,
    input: m.input_cost,
    cached: m.cached_cost,
    output: m.output_cost,
    total: m.cost
  }));

  return (
    <section className="flex flex-col gap-5">
      {/* Headline KPIs */}
      <div className="grid gap-3 md:grid-cols-3">
        <div className="panel border-2 border-ink p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">If paid via API</p>
              <p className="mt-2 text-3xl font-bold text-ink">{formatUsd(totals.overall)}</p>
              <p className="mt-1 text-xs text-slate-500">across {models.length} model{models.length === 1 ? "" : "s"}</p>
            </div>
            <span className="rounded-md bg-ink/10 p-2 text-ink"><Zap size={20} /></span>
          </div>
        </div>
        <div className="panel border-2 border-codex p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-codex">
                <CodexLogo size={11} /> Codex API spend
              </p>
              <p className="mt-2 text-3xl font-bold text-codex">{formatUsd(totals.codex)}</p>
              <p className="mt-1 text-xs text-slate-500">
                actually billed via {codexTier.name} ({formatUsd(codexTier.monthly)}/mo)
              </p>
            </div>
            <span className="rounded-md bg-codex-tint p-2 text-codex"><CodexLogo size={20} /></span>
          </div>
        </div>
        <div className="panel border-2 border-claude p-4">
          <div className="flex items-start justify-between">
            <div>
              <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-claude">
                <ClaudeLogo size={11} /> Claude API spend
              </p>
              <p className="mt-2 text-3xl font-bold text-claude">{formatUsd(totals.claude)}</p>
              <p className="mt-1 text-xs text-slate-500">
                actually billed via {claudeTier.name} ({formatUsd(claudeTier.monthly)}/mo)
              </p>
            </div>
            <span className="rounded-md bg-claude-tint p-2 text-claude"><ClaudeLogo size={20} /></span>
          </div>
        </div>
      </div>

      {/* Cache savings banner */}
      <div className="panel relative overflow-hidden p-5">
        <div className="absolute -right-12 -top-12 h-40 w-40 rounded-full bg-teal/10" />
        <div className="absolute -bottom-10 -left-10 h-32 w-32 rounded-full bg-amber/10" />
        <div className="relative flex flex-wrap items-center justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-teal">Prompt caching saved you</p>
            <p className="mt-2 text-4xl font-bold text-teal">{formatUsd(totals.saved_by_caching)}</p>
            <p className="mt-1 text-sm text-slate-600">
              Without caching, the same workload would have cost{" "}
              <span className="font-semibold text-ink">{formatUsd(wouldHaveCost)}</span>{" "}
              — that's <span className="font-semibold text-teal">{savingsPct}% off</span>.
            </p>
          </div>
          <div className="flex flex-col items-end text-xs text-slate-500">
            <span>Cached input tokens</span>
            <span className="mono text-lg font-semibold text-ink">{formatTokens(totals.total_cached)}</span>
            <span className="mt-2">Fresh input tokens</span>
            <span className="mono text-lg font-semibold text-ink">{formatTokens(totals.total_fresh_input)}</span>
          </div>
        </div>
      </div>

      {/* Cost per model — stacked bars */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-ink">Cost by Model</h2>
            <p className="text-sm text-slate-500">Stacked: fresh input + cached + output (incl. reasoning).</p>
          </div>
          <span className="flex items-center gap-3 text-xs text-slate-500">
            <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded bg-codex" /> Codex</span>
            <span className="inline-flex items-center gap-1"><span className="h-2 w-3 rounded bg-claude" /> Claude</span>
          </span>
        </div>
        {modelBarData.length ? (
          <div className="h-80">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={modelBarData} margin={{ left: 8, right: 8, bottom: 50 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} interval={0} angle={-25} textAnchor="end" height={70} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatUsd(Number(v))} />
                <Tooltip
                  formatter={(v: number) => formatUsd(v)}
                  labelFormatter={(label: string, payload) => {
                    const p = payload?.[0]?.payload as { full?: string; source?: string };
                    return `${p?.full || label}  ·  ${p?.source || ""}`;
                  }}
                />
                <Legend />
                <Bar dataKey="input" stackId="a" fill="#94a3b8" name="Fresh input" />
                <Bar dataKey="cached" stackId="a" fill="#0f8f8a" name="Cached input" />
                <Bar dataKey="output" stackId="a" fill="#d55c47" name="Output" />
              </BarChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="No priced models in this range" />
        )}
      </div>

      {/* Daily spend area chart */}
      <div className="panel p-4">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="text-lg font-semibold text-ink">Daily Spend</h2>
          <span className="text-xs text-slate-500">{daily.length} days in range</span>
        </div>
        {daily.length ? (
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={daily}>
                <defs>
                  <linearGradient id="spend-codex" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.codex} stopOpacity={0.4} />
                    <stop offset="95%" stopColor={BRAND.codex} stopOpacity={0} />
                  </linearGradient>
                  <linearGradient id="spend-claude" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="5%" stopColor={BRAND.claude} stopOpacity={0.5} />
                    <stop offset="95%" stopColor={BRAND.claude} stopOpacity={0} />
                  </linearGradient>
                </defs>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => formatUsd(Number(v))} />
                <Tooltip formatter={(v: number) => formatUsd(v)} />
                <Legend />
                <Area type="monotone" dataKey="codex" stroke={BRAND.codex} fill="url(#spend-codex)" strokeWidth={2} />
                <Area type="monotone" dataKey="claude" stroke={BRAND.claude} fill="url(#spend-claude)" strokeWidth={2} />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="No daily spend in this range" />
        )}
      </div>

      {/* Per-model detail table */}
      <div className="panel overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-lg font-semibold text-ink">Per-Model Breakdown</h2>
          <p className="text-sm text-slate-500">
            Token sums and costs for every model that produced tokens in the selected range.
          </p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[960px] border-collapse text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Source</th>
                <th className="px-3 py-2">Model</th>
                <th className="px-3 py-2 text-right">Sessions</th>
                <th className="px-3 py-2 text-right">Fresh input</th>
                <th className="px-3 py-2 text-right">Cached</th>
                <th className="px-3 py-2 text-right">Output</th>
                <th className="px-3 py-2 text-right">Reasoning</th>
                <th className="px-3 py-2 text-right">Cost</th>
                <th className="px-3 py-2">Share</th>
              </tr>
            </thead>
            <tbody>
              {models.map((m) => {
                const sharePct = totals.overall > 0 ? (m.cost / totals.overall) * 100 : 0;
                return (
                  <tr key={`${m.source}-${m.model}`} className="border-t border-line align-top">
                    <td className="px-3 py-2"><SourceBadge source={m.source} /></td>
                    <td className="mono px-3 py-2 text-xs text-ink">
                      {m.model}
                      {!m.priced && (
                        <span className="ml-1.5 rounded bg-amber/10 px-1.5 py-0.5 text-[10px] font-medium text-amber">
                          unpriced — using fallback
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right">{formatNumber(m.sessions)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatTokens(m.fresh_input_tokens)}</td>
                    <td className="px-3 py-2 text-right text-teal">{formatTokens(m.cached_input_tokens)}</td>
                    <td className="px-3 py-2 text-right text-slate-600">{formatTokens(m.output_tokens)}</td>
                    <td className="px-3 py-2 text-right text-slate-400">{formatTokens(m.reasoning_output_tokens)}</td>
                    <td className="px-3 py-2 text-right font-semibold text-ink">{formatUsd(m.cost)}</td>
                    <td className="px-3 py-2">
                      <div className="flex h-2 w-32 overflow-hidden rounded-full bg-line">
                        <div
                          className={m.source === "claude" ? "bg-claude" : "bg-codex"}
                          style={{ width: `${sharePct.toFixed(1)}%` }}
                        />
                      </div>
                      <span className="mt-0.5 block text-[10px] text-slate-400">{sharePct.toFixed(1)}%</span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
            <tfoot>
              <tr className="border-t-2 border-line bg-surface">
                <td className="px-3 py-2 font-semibold" colSpan={2}>Total</td>
                <td className="px-3 py-2 text-right">{formatNumber(models.reduce((a, m) => a + m.sessions, 0))}</td>
                <td className="px-3 py-2 text-right">{formatTokens(totals.total_fresh_input)}</td>
                <td className="px-3 py-2 text-right text-teal">{formatTokens(totals.total_cached)}</td>
                <td className="px-3 py-2 text-right">{formatTokens(totals.total_output)}</td>
                <td className="px-3 py-2 text-right">—</td>
                <td className="px-3 py-2 text-right font-bold text-ink">{formatUsd(totals.overall)}</td>
                <td className="px-3 py-2" />
              </tr>
            </tfoot>
          </table>
        </div>
      </div>

      {/* Subscription comparison */}
      <div className="grid gap-3 md:grid-cols-2">
        <SubscriptionCard
          tone="codex"
          source="Codex"
          apiSpend={totals.codex}
          tier={codexTier}
          months={monthsCodex}
          perMonth={codexPerMonth}
        />
        <SubscriptionCard
          tone="claude"
          source="Claude"
          apiSpend={totals.claude}
          tier={claudeTier}
          months={monthsClaude}
          perMonth={claudePerMonth}
        />
      </div>

      {/* Per-skill cost */}
      {perSkill.length > 0 && (
        <div className="panel p-4">
          <div className="mb-3 flex items-center justify-between">
            <h2 className="text-lg font-semibold text-ink">Top Skills by Cost</h2>
            <span className="text-xs text-slate-500">Token cost attributed via shared turn_id</span>
          </div>
          <div className="h-72">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={perSkill} layout="vertical" margin={{ left: 100 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#d8dde3" />
                <XAxis type="number" tick={{ fontSize: 11 }} tickFormatter={(v) => formatUsd(Number(v))} />
                <YAxis dataKey="skill_name" type="category" tick={{ fontSize: 11 }} width={140} />
                <Tooltip formatter={(v: number) => formatUsd(v)} />
                <Bar dataKey="cost" radius={[0, 4, 4, 0]}>
                  {perSkill.map((row, i) => (
                    <Cell key={i} fill={row.source === "claude" ? BRAND.claude : BRAND.codex} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <p className="text-xs text-slate-500">
        Pricing based on May 2026 published rates from{" "}
        <span className="font-medium text-ink">anthropic.com/pricing</span> and{" "}
        <span className="font-medium text-ink">platform.openai.com/docs/pricing</span>. Codex is normally
        billed via ChatGPT subscription; numbers above show what the equivalent API workload would cost.
      </p>
    </section>
  );
}

// Subscription tier definitions mirror src/lib/pricing.js (kept in sync manually
// since the client doesn't import server modules).
const TIERS = {
  codex: [
    { name: "ChatGPT Plus", monthly: 20 },
    { name: "ChatGPT Pro", monthly: 200 }
  ],
  claude: [
    { name: "Claude Pro", monthly: 20 },
    { name: "Claude Max 5x", monthly: 100 },
    { name: "Claude Max 20x", monthly: 200 }
  ]
};

function pickTier(spend: number, source: "codex" | "claude") {
  const tiers = TIERS[source];
  for (const t of tiers) if (spend <= t.monthly) return t;
  return tiers[tiers.length - 1];
}

function pickMonths(daily: Array<{ day: string }>, _source: string) {
  if (!daily.length) return 0;
  const first = new Date(daily[0].day);
  const last = new Date(daily[daily.length - 1].day);
  const ms = last.getTime() - first.getTime();
  return Math.max(1, ms / (1000 * 60 * 60 * 24 * 30.4));
}

function SubscriptionCard({
  tone,
  source,
  apiSpend,
  tier,
  months,
  perMonth
}: {
  tone: "codex" | "claude";
  source: string;
  apiSpend: number;
  tier: { name: string; monthly: number };
  months: number;
  perMonth: number;
}) {
  const accent = tone === "codex" ? "border-codex" : "border-claude";
  const text = tone === "codex" ? "text-codex" : "text-claude";
  const tint = tone === "codex" ? "bg-codex-tint" : "bg-claude-tint";
  const Logo = tone === "codex" ? CodexLogo : ClaudeLogo;
  const subscriptionCost = tier.monthly * Math.max(1, months);
  const savings = apiSpend - subscriptionCost;
  return (
    <div className={`panel overflow-hidden border-2 ${accent}`}>
      <div className={`flex items-center justify-between px-4 py-3 ${tint}`}>
        <h3 className={`flex items-center gap-2 text-base font-semibold ${text}`}>
          <Logo size={14} /> {source} — API vs Subscription
        </h3>
      </div>
      <div className="grid grid-cols-2 gap-3 p-4 text-sm">
        <div>
          <div className="text-[10px] uppercase text-slate-500">If paid via API</div>
          <div className={`font-semibold ${text}`}>{formatUsd(apiSpend)}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">≈ {formatUsd(perMonth)}/mo over {months.toFixed(1)} mo</div>
        </div>
        <div>
          <div className="text-[10px] uppercase text-slate-500">Subscription that covers it</div>
          <div className="font-semibold text-ink">{tier.name}</div>
          <div className="mt-0.5 text-[10px] text-slate-500">
            {formatUsd(tier.monthly)}/mo × {Math.max(1, months).toFixed(1)} = {formatUsd(subscriptionCost)}
          </div>
        </div>
        <div className="col-span-2 mt-1 rounded-md border border-line bg-surface p-3">
          <div className="text-[10px] uppercase text-slate-500">Savings via subscription</div>
          <div className={`text-2xl font-bold ${savings > 0 ? "text-teal" : "text-coral"}`}>
            {savings > 0 ? `+${formatUsd(savings)}` : formatUsd(savings)}
          </div>
          <div className="mt-1 text-xs text-slate-500">
            {savings > 0
              ? `You'd have paid ${formatUsd(savings)} more on API for the same usage.`
              : `API would have been cheaper than ${tier.name} for this usage level.`}
          </div>
        </div>
      </div>
    </div>
  );
}
