"use client";

import CostOverviewView from "./cost-overview-view";
import GlobalFooter from "./global-footer";
import { ALL_SOURCES, readHiddenSources, readHiddenTabs, readSyncIntervalMinutes, type SourceId } from "./settings-view";
import { setPref, usePrefs } from "./use-prefs";
import JudgmentsView from "./judgments-view";
import SettingsView from "./settings-view";
import { useChartDateBrush } from "./use-chart-date-brush";
import {
  CommandPalette,
  HeaderSparkline,
  MilestoneConfetti,
} from "./ux-bits";
import WrappedView from "./wrapped-view";
import {
  Activity,
  AlertTriangle,
  BarChart3,
  Clock,
  Database,
  EyeOff,
  Eye,
  Flame,
  Hammer,
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

// Cursor IDE mark — generic cursor/stack glyph, used to badge cursor rows.
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
  if (source === "cursor") {
    return (
      <span className="inline-flex items-center gap-1 rounded bg-cursor-tint px-1.5 py-0.5 text-[10px] font-semibold text-cursor">
        <CursorLogo size={10} /> Cursor
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

function StatCard({
  label,
  value,
  detail,
  icon: Icon,
  tone = "teal",
  loading = false,
  onClick,
}: {
  label: string;
  value: string;
  detail: string;
  icon: typeof Activity;
  tone?: "teal" | "coral" | "amber" | "violet" | "emerald";
  loading?: boolean;
  onClick?: () => void;
}) {
  const toneClass = {
    teal: "bg-teal/10 text-teal",
    coral: "bg-coral/10 text-coral",
    amber: "bg-amber/10 text-amber",
    violet: "bg-violet/10 text-violet",
    emerald: "bg-emerald-500/10 text-emerald-600 dark:text-emerald-400"
  }[tone];
  const Wrap = onClick
    ? ({ children }: { children: React.ReactNode }) => (
        <button
          type="button"
          onClick={onClick}
          className="metric-card p-4 text-left transition-colors hover:border-teal/40 hover:bg-teal/5 focus:outline-none focus:ring-2 focus:ring-teal"
        >
          {children}
        </button>
      )
    : ({ children }: { children: React.ReactNode }) => (
        <div className="metric-card p-4">{children}</div>
      );
  return (
    <Wrap>
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
    </Wrap>
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

/**
 * Compact "synced N ago" indicator with a toggle for the 30-minute auto
 * import. Lives next to the manual Import / Refresh buttons.
 */
function SyncStatus({
  lastSyncedAt,
  importing,
  autoSyncEnabled,
  onToggle,
}: {
  lastSyncedAt: number | null;
  importing: boolean;
  autoSyncEnabled: boolean;
  onToggle: () => void;
}) {
  // Re-render the relative-time label every 30s so "synced X min ago"
  // stays accurate without nagging the rest of the app.
  const [, setTick] = useState(0);
  useEffect(() => {
    const id = window.setInterval(() => setTick((n) => n + 1), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const label = (() => {
    if (importing) return "Syncing…";
    if (!lastSyncedAt) return autoSyncEnabled ? "Auto-sync on" : "Auto-sync off";
    const secs = Math.floor((Date.now() - lastSyncedAt) / 1000);
    if (secs < 60) return "Synced just now";
    const mins = Math.floor(secs / 60);
    if (mins < 60) return `Synced ${mins}m ago`;
    return `Synced ${Math.floor(mins / 60)}h ago`;
  })();

  return (
    <button
      type="button"
      onClick={onToggle}
      title={
        autoSyncEnabled
          ? "Auto-sync runs every 30 minutes. Click to disable."
          : "Auto-sync disabled. Click to re-enable."
      }
      className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-xs font-medium tabular-nums ${
        autoSyncEnabled
          ? "border-emerald-300 bg-emerald-50 text-emerald-800 hover:border-emerald-400"
          : "border-line bg-white text-slate-500 hover:border-rose-400"
      }`}
    >
      <span
        className={`inline-block h-2 w-2 rounded-full ${
          importing
            ? "animate-pulse bg-amber-500"
            : autoSyncEnabled
            ? "bg-emerald-500"
            : "bg-slate-400"
        }`}
      />
      {label}
    </button>
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
  // "cost" is the new default landing — tokens/sessions/cost are the
  // center stage after the pivot away from skill-centric analytics.
  // Consolidated post-pivot tab set. "overview", "errors", and "pricing"
  // accept-but-render-as "skills" so deep links from older bookmarks
  // still land somewhere sensible.
  const [active, setActive] = useState<"cost" | "wrapped" | "skills" | "timeline" | "comparison" | "judgments" | "settings">("cost");
  // Tabs the user has hidden from the Settings tab. Settings itself can
  // never be hidden — it's the user's escape hatch back to visibility.
  //
  // Must start as [] on both server and client. Lazy-reading localStorage
  // here would render a different nav on hydrate (server sees all tabs,
  // client sees the filtered set) and trigger a hydration mismatch. We
  // hydrate from localStorage in the effect below; the user briefly sees
  // all tabs for one paint, then the hidden ones disappear — acceptable.
  const [hiddenTabs, setHiddenTabs] = useState<string[]>([]);
  useEffect(() => {
    // Read from the prefs cache once it loads; setPref + the loader
    // both fire the legacy "dashboard:hidden-tabs" event so this
    // single listener handles both initial hydrate AND user toggles.
    setHiddenTabs(readHiddenTabs());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<string[]>).detail;
      if (Array.isArray(next)) setHiddenTabs(next);
    };
    window.addEventListener("dashboard:hidden-tabs", onChange);
    return () => window.removeEventListener("dashboard:hidden-tabs", onChange);
  }, []);
  // If the user hides the currently-active tab from Settings, bump them
  // to "cost" (always allowed) or "settings" if even cost is hidden.
  useEffect(() => {
    if (active !== "settings" && hiddenTabs.includes(active)) {
      setActive(hiddenTabs.includes("cost") ? "settings" : "cost");
    }
  }, [hiddenTabs, active]);

  // Per-source visibility. Mirrors the Settings → Sources toggles, with
  // the same SSR-safe init pattern (start empty → hydrate in effect).
  // Consumers (FilterBar pills, Comparison columns, ⌘K source picks)
  // all read from `visibleSources` below.
  const [hiddenSources, setHiddenSources] = useState<SourceId[]>([]);
  useEffect(() => {
    setHiddenSources(readHiddenSources());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<SourceId[]>).detail;
      if (Array.isArray(next)) setHiddenSources(next);
    };
    window.addEventListener("dashboard:hidden-sources", onChange);
    return () => window.removeEventListener("dashboard:hidden-sources", onChange);
  }, []);
  const visibleSourceIds = useMemo(
    () => ALL_SOURCES.filter((s) => !hiddenSources.includes(s)),
    [hiddenSources]
  );
  // If the user hides the currently-selected source, snap back to "all"
  // so they're not staring at a confusingly empty filtered view.
  useEffect(() => {
    if (sourceFilter !== "all" && hiddenSources.includes(sourceFilter as SourceId)) {
      setSourceFilter("all");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hiddenSources]);

  // Single source of truth for the tab nav. Both the rendered buttons
  // and the digit-shortcut map derive from this list, so hiding a tab
  // from Settings re-numbers everything consistently — pressing "5"
  // jumps to whatever sits in position 5 right now, never to a tab the
  // user can't see.
  const ALL_TABS: Array<[typeof active, string]> = [
    ["cost", "Cost & Tokens"],
    ["wrapped", "Wrapped"],
    ["comparison", "Claude vs Codex"],
    ["timeline", "Timeline"],
    ["judgments", "Judgments"],
    ["skills", "Skills"],
    ["settings", "Settings"],
  ];
  const visibleTabs = useMemo(
    () => ALL_TABS.filter(([id]) => id === "settings" || !hiddenTabs.includes(id)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [hiddenTabs]
  );
  // Inside the Skills tab: four focused subviews so the page isn't a
  // four-section vertical scroll. The 'top' subview is the eye-candy
  // (bar charts of busiest skills + hourly cadence); Health is the
  // detailed table; Errors is the failures stream; Pricing is the cost
  // breakdown per skill.
  const [skillsSubtab, setSkillsSubtab] = useState<"top" | "health" | "errors" | "pricing">("top");
  const [loading, setLoading] = useState(true);
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string>("");
  // Auto-sync: timestamp of the last successful import this session. Used
  // both to display "synced X ago" and to power the 30-min interval below.
  const [lastSyncedAt, setLastSyncedAt] = useState<number | null>(null);
  const [autoSyncEnabled, setAutoSyncEnabled] = useState(true);
  // User-configurable auto-sync cadence in minutes. Read from
  // localStorage post-mount to avoid an SSR/client hydration mismatch
  // (server has no localStorage → falls back to the default). 0 = off.
  // SettingsView writes the value and dispatches "dashboard:sync-interval"
  // so this state stays in sync without coupling the two components.
  const [syncIntervalMin, setSyncIntervalMin] = useState<number>(30);
  // Bumped after every successful import. Child views that load their
  // own data (CostOverviewView, WrappedView) use it as a useEffect dep
  // to silently refetch without flashing skeletons — the old data stays
  // on screen until the new fetch resolves.
  const [refreshNonce, setRefreshNonce] = useState(0);
  // One-shot "just refreshed" toast. Shown for ~2s after a sync
  // completes so the user knows the screen they're looking at is fresh.
  const [justRefreshed, setJustRefreshed] = useState(false);
  // Ensure the prefs cache loads (the hook subscribes everywhere
  // including SettingsView; calling it here is enough to start hydration
  // if SettingsView isn't mounted yet).
  usePrefs();
  useEffect(() => {
    setSyncIntervalMin(readSyncIntervalMinutes());
    const onChange = (e: Event) => {
      const next = (e as CustomEvent<number>).detail;
      if (typeof next === "number") setSyncIntervalMin(next);
    };
    window.addEventListener("dashboard:sync-interval", onChange);
    return () => window.removeEventListener("dashboard:sync-interval", onChange);
  }, []);
  // Update-from-GitHub state. `available` is null when we haven't asked
  // yet (don't show the button); a number when we know how many commits
  // we're behind upstream; 0 when we've checked and are current.
  const [updating, setUpdating] = useState(false);
  const [updateMsg, setUpdateMsg] = useState<string | null>(null);
  const [updateAvailable, setUpdateAvailable] = useState<number | null>(null);
  const [updateCommits, setUpdateCommits] = useState<{ sha: string; subject: string }[]>([]);
  // Command palette open state (⌘K toggles).
  const [paletteOpen, setPaletteOpen] = useState(false);
  // Project scope: when set to a cwd string, EVERY endpoint call gets
  // &project=<cwd> appended, so cost / wrapped / comparison / etc. all
  // re-scope to just that project. Cleared via the dismiss chip below.
  // Initial value comes from ?project= in the URL on first mount, so
  // scoped views are shareable / bookmarkable. Must init to null on both
  // server and client — reading window.location during render would
  // produce mismatched HTML when SSR returns null and the client returns
  // the URL value. Hydrated in the effect below.
  const [projectScope, setProjectScope] = useState<string | null>(null);
  useEffect(() => {
    const fromUrl = new URL(window.location.href).searchParams.get("project");
    if (fromUrl) setProjectScope(fromUrl);
  }, []);

  // Mirror projectScope back into the URL whenever it changes so reloads
  // preserve scope and the address bar always reflects the current view.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const url = new URL(window.location.href);
    if (projectScope) url.searchParams.set("project", projectScope);
    else url.searchParams.delete("project");
    window.history.replaceState(null, "", url.toString());
  }, [projectScope]);
  // List of project cwds we know about — populated from cost-overview's
  // byProject list so the ⌘K palette can offer them.
  const [knownProjects, setKnownProjects] = useState<{ cwd: string; cwd_short: string; cost: number }[]>([]);
  // Snapshot the milestone-relevant numbers so <MilestoneConfetti> can
  // detect crossings. Pulled from the cost-overview endpoint.
  const [milestoneSnap, setMilestoneSnap] = useState<{
    spend: number; saved: number; tokens: number;
  } | null>(null);
  const [evidence, setEvidence] = useState<Record<string, unknown> | null>(null);
  const [categoryFilter, setCategoryFilter] = useState<SkillCategoryFilter>("all");
  const [projectFilter, setProjectFilter] = useState<string>("all");
  const [projects, setProjects] = useState<string[]>([]);
  const [hideUnused, setHideUnused] = useState(false);
  const [severityFilter, setSeverityFilter] = useState<"all" | "error" | "warn">("all");
  const [insights, setInsights] = useState<Insights>({});
  const [skillDetailName, setSkillDetailName] = useState<string | null>(null);
  const [authoredModalOpen, setAuthoredModalOpen] = useState(false);
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
    // Project scope rides on every metric endpoint call. When set, the
    // ENTIRE dashboard re-renders against just that one cwd's data.
    if (projectScope) p.set("project", projectScope);
    return p.toString();
  }, [sourceFilter, dateFrom, dateTo, projectScope]);

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

  // `silent: true` keeps the existing data visible while a refetch is in
  // flight. We only flip the loading flag when we have nothing to show
  // (cold start). Background syncs use silent=true so panels don't
  // flash skeletons during auto-import — the new data swaps in
  // atomically when the parallel fetches resolve.
  async function loadData({ silent = false }: { silent?: boolean } = {}) {
    if (!silent) setLoading(true);
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
      if (!silent) setLoading(false);
    }
  }

  async function runImport() {
    setImporting(true);
    setImportError("");
    try {
      const response = await fetch("/api/import", { method: "POST" });
      const body = await response.json();
      if (!body.ok) {
        setImportError(String(body.error || "Import failed"));
        // Failed import → don't swap visible data; user still sees the
        // previous (still-valid) snapshot. Bail without refetching.
        return;
      }
      setLastSyncedAt(Date.now());
      // Silent refresh: old data stays mounted, new data arrives in one
      // batch when fetches resolve. This is the "zero-downtime" swap —
      // no skeleton flash, no flicker between the two snapshots.
      await loadData({ silent: true });
      // Tell child views (CostOverviewView, WrappedView) that the
      // underlying numbers changed so they can silently refetch too.
      setRefreshNonce((n) => n + 1);
      // Briefly surface a "just refreshed" toast — gives the user a
      // visible confirmation that the screen they're looking at now
      // reflects the latest data, instead of leaving them wondering.
      setJustRefreshed(true);
      window.setTimeout(() => setJustRefreshed(false), 2200);
    } catch (error) {
      setImportError(error instanceof Error ? error.message : String(error));
    } finally {
      setImporting(false);
    }
  }

  async function runUpdate() {
    setUpdating(true);
    setUpdateMsg(null);
    try {
      const r = await fetch("/api/update", { method: "POST" });
      const j = await r.json();
      if (!j.ok) {
        setUpdateMsg(
          `${j.step || "update"} failed: ${j.error || "unknown"}${
            j.details ? "\n" + j.details : ""
          }`
        );
        return;
      }
      if (j.already_up_to_date) {
        setUpdateMsg("Already up to date.");
      } else {
        setUpdateMsg(
          `Pulled new commits.${
            j.install_ran ? " Dependencies installed." : ""
          }${j.needs_restart ? " Server restart recommended for native changes." : ""}`
        );
      }
      // Re-check availability so the button hides itself after a
      // successful pull (no more commits to fetch).
      checkForUpdates();
    } catch (e) {
      setUpdateMsg(`update failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setUpdating(false);
      setTimeout(() => setUpdateMsg(null), 12_000);
    }
  }

  async function checkForUpdates() {
    try {
      const r = await fetch("/api/update/check");
      const j = await r.json();
      if (!j.ok) {
        // Silent — this is a background poll. Failures (no remote, not a
        // repo, no network) shouldn't shout at the user.
        setUpdateAvailable(null);
        return;
      }
      setUpdateAvailable(j.behind_by || 0);
      setUpdateCommits(j.commits || []);
    } catch {
      setUpdateAvailable(null);
    }
  }

  // Check on mount, then every 15 minutes thereafter, and whenever the
  // tab regains focus (covers "I left it open overnight" cases).
  useEffect(() => {
    checkForUpdates();
    const id = window.setInterval(checkForUpdates, 15 * 60 * 1000);
    const onFocus = () => checkForUpdates();
    window.addEventListener("focus", onFocus);
    return () => {
      window.clearInterval(id);
      window.removeEventListener("focus", onFocus);
    };
  }, []);

  // Prefetch endpoints for tabs the user hasn't opened yet, so switching
  // is instantaneous. Browser cache picks these up; the per-tab views
  // fire the same fetches and get cache hits. Fires once on mount with
  // a small delay so the initial paint isn't competing with these.
  // While we're at it: grab the cost headline numbers for milestone
  // confetti detection.
  useEffect(() => {
    const t = window.setTimeout(() => {
      // Prefetch list intentionally excludes /api/metrics/fun-facts:
      // it depends on the user's chosen region (US/IN/UK/…), and
      // prefetching without the region would warm the wrong cache key.
      // CostOverviewView fires the region-aware fetch once region is
      // hydrated from /api/prefs.
      const urls = [
        "/api/metrics/cost-overview",
        "/api/metrics/wrapped",
        "/api/metrics/comparison",
        "/api/metrics/judgments",
        "/api/metrics/sparkline",
      ];
      for (const u of urls) {
        fetch(u).catch(() => { /* prefetch is best-effort */ });
      }
      // Milestone snapshot + project list — reads the same prefetched cost-overview.
      // Always uses the UNscoped endpoint so the palette shows every project,
      // not just the currently-scoped one.
      fetch("/api/metrics/cost-overview")
        .then((r) => r.json())
        .then((j) => {
          if (!j?.ok) return;
          const h = j.headline;
          setMilestoneSnap({
            spend: Number(h.spend_total || 0),
            saved: Number(h.cache_savings || 0),
            tokens: Number(h.tokens_billable || 0),
          });
          if (Array.isArray(j.byProject)) {
            setKnownProjects(
              j.byProject.map((p: { cwd: string; cwd_short: string; cost: number }) => ({
                cwd: p.cwd,
                cwd_short: p.cwd_short,
                cost: p.cost,
              }))
            );
          }
        })
        .catch(() => {});
    }, 400);
    return () => window.clearTimeout(t);
  }, []);

  // Keyboard shortcuts. 1–6 jumps tabs, ⌘I (or Ctrl+I) imports, "/"
  // focuses the Skills search box, ⌘K is reserved for a future palette.
  // Disabled when the user is typing in an input / textarea so we don't
  // hijack normal text editing.
  useEffect(() => {
    // Digit shortcuts mirror the *visible* tab order. Hiding "Judgments"
    // in Settings means "5" now jumps to whatever tab took its slot
    // (Skills if both still visible, Settings if not). The map is
    // recomputed on every keymap-effect re-run, so changes from Settings
    // propagate immediately.
    const tabsByDigit: Record<string, typeof active> = {};
    visibleTabs.slice(0, 9).forEach(([id], i) => {
      tabsByDigit[String(i + 1)] = id;
    });
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement | null;
      const inField =
        target &&
        (target.tagName === "INPUT" ||
          target.tagName === "TEXTAREA" ||
          target.isContentEditable);
      // ⌘I / Ctrl+I always — even from inputs — to import without losing focus.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "i") {
        e.preventDefault();
        if (!importing) runImport();
        return;
      }
      // ⌘K / Ctrl+K toggles the command palette regardless of focus.
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      if (inField) return;
      if (e.key === "/" && active === "skills") {
        const el = document.getElementById("skills-search") as HTMLInputElement | null;
        if (el) {
          e.preventDefault();
          el.focus();
          el.select();
        }
        return;
      }
      // Esc closes the topmost dismissible. Order matters — modals first,
      // then the project scope chip. Modals install their own listeners too
      // (for the cases where they own nested state like confirmFix), but
      // having the global fallback means Esc is wired consistently no matter
      // which surface is focused.
      if (e.key === "Escape") {
        if (evidence) {
          e.preventDefault();
          setEvidence(null);
          return;
        }
        if (skillDetailName) {
          e.preventDefault();
          setSkillDetailName(null);
          return;
        }
        if (authoredModalOpen) {
          e.preventDefault();
          setAuthoredModalOpen(false);
          return;
        }
        if (projectScope) {
          e.preventDefault();
          setProjectScope(null);
          return;
        }
        if (sourceFilter !== "all") {
          e.preventDefault();
          setSourceFilter("all");
          return;
        }
      }
      if (tabsByDigit[e.key]) {
        e.preventDefault();
        setActive(tabsByDigit[e.key]);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active, importing, projectScope, evidence, skillDetailName, visibleTabs, sourceFilter, authoredModalOpen]);

  // Auto-sync at the user-configured cadence while the tab is open.
  // Skip if a manual import is already in flight (avoids overlapping
  // POSTs and the associated VACUUM contention on SQLite). The
  // setInterval is paused when the tab is hidden so we don't burn CPU
  // in the background. syncIntervalMin === 0 means the user disabled
  // auto-sync from Settings; the manual Import button still works.
  useEffect(() => {
    if (!autoSyncEnabled) return;
    if (syncIntervalMin <= 0) return;
    const periodMs = Math.max(10, syncIntervalMin) * 60 * 1000;
    const tick = () => {
      if (document.hidden) return;
      if (importing) return;
      runImport();
    };
    const id = window.setInterval(tick, periodMs);
    return () => window.clearInterval(id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoSyncEnabled, importing, syncIntervalMin]);

  async function openEvidence(id?: string) {
    if (!id) return;
    const response = await fetch(`/api/evidence/${id}`, { cache: "no-store" });
    setEvidence(await response.json());
  }

  useEffect(() => {
    loadData();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filterQS]);

  // Background pricing validation. Fires once per mount; the server-side
  // validator dedupes against any successful run in the last ~24h, so
  // hot-reloading the page during dev doesn't burn Haiku quota. If the
  // background run actually updates pricing, we show the "Dashboard
  // refreshed" toast — the cost numbers may have just shifted.
  useEffect(() => {
    const t = window.setTimeout(() => {
      fetch("/api/pricing/validate", { method: "POST" })
        .then((r) => r.json())
        .then((j) => {
          if (j?.ok && j.updated) {
            setJustRefreshed(true);
            window.setTimeout(() => setJustRefreshed(false), 2200);
          }
        })
        .catch(() => { /* validator failures don't affect the dashboard */ });
    }, 2000); // small delay so the first paint isn't competing with subprocess spawn
    return () => window.clearTimeout(t);
  }, []);

  // ─── Dynamic ⌘K palette items ─────────────────────────────────────────
  //
  // Built from live state instead of hand-listed JSX. Each source
  // (visible tabs, settings actions, source filter, region picks, date
  // presets, projects, skills, panel anchors, top sessions) appends to
  // one array under its own group header. Hidden tabs (Settings →
  // Visible Tabs) are absent because we read straight from
  // `visibleTabs`. Adding a new dynamic surface = adding one block here
  // rather than touching <CommandPalette> internals.
  const paletteItems = useMemo(() => {
    const items: Array<{
      id: string;
      group: string;
      label: string;
      hint?: string;
      keywords?: string[];
      onPick: () => void;
    }> = [];

    // — Tabs (filtered to visible). Tag with both the digit hint and a
    //   couple synonyms so e.g. typing "wrapped" or "share" both surface
    //   the Wrapped tab.
    const TAB_KEYWORDS: Record<string, string[]> = {
      cost: ["money", "spend", "tokens", "$", "billing", "usage"],
      wrapped: ["share", "screenshot", "year in review", "card"],
      comparison: ["compare", "vs", "codex", "claude", "cursor", "side by side"],
      timeline: ["chart", "graph", "history", "trend"],
      judgments: ["judge", "haiku", "drift", "quality"],
      skills: ["skill", "agent", "tool", "errors", "pricing"],
      settings: ["preferences", "config", "options", "appearance", "theme", "dark", "light"],
    };
    visibleTabs.forEach(([id, label], i) => {
      items.push({
        id: `tab-${id}`,
        group: "Tab",
        label,
        hint: String(i + 1),
        keywords: ["go to", "open", "tab", ...(TAB_KEYWORDS[id] || [])],
        onPick: () => setActive(id),
      });
    });

    // — Settings actions. Theme picks + sync-interval presets + region
    //   picks all write via setPref which:
    //     1. updates the in-memory prefs cache,
    //     2. POSTs /api/prefs (DB write-through),
    //     3. fires the legacy per-key CustomEvents that other components
    //        still listen for (dashboard:theme etc.).
    items.push(
      { id: "settings-open", group: "Settings", label: "Open Settings…", hint: "7",
        keywords: ["preferences", "config", "options"],
        onPick: () => setActive("settings") },
      { id: "settings-theme-light", group: "Theme", label: "Theme: Light",
        keywords: ["light", "bright", "white", "appearance"],
        onPick: () => {
          setPref("theme", "light");
          document.documentElement.classList.remove("dark");
        } },
      { id: "settings-theme-dark", group: "Theme", label: "Theme: Dark",
        keywords: ["dark", "night", "black", "appearance"],
        onPick: () => {
          setPref("theme", "dark");
          document.documentElement.classList.add("dark");
        } },
      { id: "settings-theme-system", group: "Theme", label: "Theme: System",
        keywords: ["auto", "system", "os", "appearance"],
        onPick: () => {
          setPref("theme", "system");
          const dark = window.matchMedia("(prefers-color-scheme: dark)").matches;
          document.documentElement.classList.toggle("dark", dark);
        } },
    );

    // — Region picks (drives AI fun-fact metaphors).
    const REGION_KEYWORDS: Record<string, string[]> = {
      US: ["united states", "america", "usa", "dollars"],
      IN: ["india", "indian", "inr", "rupee", "rupees", "₹"],
      UK: ["united kingdom", "britain", "british", "pounds", "gbp", "£"],
      EU: ["europe", "european", "euros", "eur", "€"],
      JP: ["japan", "japanese", "yen", "jpy", "¥"],
      AU: ["australia", "australian", "aud"],
      GLOBAL: ["global", "international", "world", "neutral"],
    };
    (["US", "IN", "UK", "EU", "JP", "AU", "GLOBAL"] as const).forEach((r) => {
      items.push({
        id: `region-${r}`,
        group: "Region",
        label: `Region: ${r}`,
        keywords: ["fun facts", "tidbits", "currency", "metaphors", ...(REGION_KEYWORDS[r] || [])],
        onPick: () => setPref("region", r),
      });
    });

    // — Source filter picks AND per-source hide/show actions. The big
    //   smart-palette unlock: typing "cursor" surfaces *everything*
    //   cursor-related — filter, hide-from-settings, show-from-settings,
    //   comparison jump — without the user having to remember where any
    //   of those live.
    const SOURCE_SYNONYMS: Record<SourceId, string[]> = {
      codex: ["codex", "openai", "gpt", "chatgpt"],
      claude: ["claude", "anthropic", "haiku", "sonnet", "opus"],
      cursor: ["cursor", "ide"],
    };
    (Object.keys(SOURCE_LABEL) as SourceFilter[])
      .filter((s) => s === "all" || !hiddenSources.includes(s as SourceId))
      .forEach((s) => {
        const syn = s === "all" ? ["all", "everything", "both"] : SOURCE_SYNONYMS[s as SourceId];
        items.push({
          id: `source-${s}`,
          group: "Source filter",
          label: `Filter source: ${SOURCE_LABEL[s]}`,
          keywords: ["source", "filter", "only", ...syn],
          onPick: () => setSourceFilter(s),
        });
      });
    // Hide/Show actions per source — typing "cursor" should find the
    // disable toggle just as easily as "Settings → Sources" does.
    ALL_SOURCES.forEach((s) => {
      const hidden = hiddenSources.includes(s);
      const syn = SOURCE_SYNONYMS[s] || [];
      const label = SOURCE_LABEL[s as SourceFilter];
      const toggle = () => {
        const next = hidden ? hiddenSources.filter((x) => x !== s) : [...hiddenSources, s];
        setPref("hiddenSources", next);
      };
      items.push({
        id: `source-toggle-${s}`,
        group: "Source visibility",
        label: hidden ? `Show ${label} everywhere` : `Hide ${label} everywhere`,
        keywords: ["disable", "enable", "toggle", "settings", "sources", ...syn],
        onPick: toggle,
      });
    });

    // — Sync-interval presets.
    [10, 15, 30, 60, 120].forEach((m) => {
      items.push({
        id: `sync-${m}`,
        group: "Sync interval",
        label: `Auto-sync every ${m} min`,
        keywords: ["interval", "refresh", "background", "import", "cadence"],
        onPick: () => setPref("syncIntervalMinutes", m),
      });
    });
    items.push({
      id: "sync-off",
      group: "Sync interval",
      label: "Auto-sync off",
      keywords: ["disable", "stop", "pause", "off", "manual"],
      onPick: () => setPref("syncIntervalMinutes", 0),
    });

    // — Date range presets.
    const presetDays = (days: number) => {
      const to = new Date();
      const from = new Date();
      from.setDate(from.getDate() - days + 1);
      setDateFrom(from.toISOString().slice(0, 10));
      setDateTo(to.toISOString().slice(0, 10));
    };
    items.push(
      { id: "date-7d", group: "Date range", label: "Last 7 days",
        keywords: ["week", "recent", "filter"], onPick: () => presetDays(7) },
      { id: "date-30d", group: "Date range", label: "Last 30 days",
        keywords: ["month", "filter"], onPick: () => presetDays(30) },
      { id: "date-90d", group: "Date range", label: "Last 90 days",
        keywords: ["quarter", "3 months", "filter"], onPick: () => presetDays(90) },
      { id: "date-clear", group: "Date range", label: "Clear date filter",
        keywords: ["reset", "remove", "all time"],
        onPick: () => { setDateFrom(""); setDateTo(""); } },
    );

    // — Project scope.
    if (projectScope) {
      items.push({
        id: "project-all",
        group: "Project",
        label: "← Show all projects (clear scope)",
        hint: "Esc",
        keywords: ["clear", "reset", "all"],
        onPick: () => { setProjectScope(null); setActive("cost"); },
      });
    }
    knownProjects.forEach((p) => {
      items.push({
        id: `project-${p.cwd}`,
        group: "Project",
        label: p.cwd_short,
        hint: `$${Math.round(p.cost).toLocaleString()}`,
        keywords: ["scope", "cwd", "project", "folder", "repo"],
        onPick: () => { setProjectScope(p.cwd); setActive("cost"); },
      });
    });

    // — Panel anchors inside the Cost & Tokens view.
    const ANCHOR_KW: Record<string, string[]> = {
      "daily-spend": ["chart", "graph", "trend", "$", "money"],
      "claude-vs-codex": ["pie", "split", "compare"],
      "cache-effectiveness": ["cache", "savings", "saved", "hit rate"],
      "burn-alerts": ["spike", "expensive", "outlier"],
      "spend-by-model": ["model", "opus", "sonnet", "haiku", "gpt"],
      "spend-by-project": ["project", "cwd", "folder"],
      "hour-of-day": ["time", "hour", "when", "schedule"],
      "top-sessions": ["session", "expensive", "biggest"],
    };
    (Object.entries(ANCHOR_KW) as [string, string[]][]).forEach(([anchor, kws]) => {
      const labelMap: Record<string, string> = {
        "daily-spend": "Cost: Daily Spend",
        "claude-vs-codex": "Cost: Claude vs Codex",
        "cache-effectiveness": "Cost: Cache Effectiveness",
        "burn-alerts": "Cost: Burn Alerts",
        "spend-by-model": "Cost: Spend by Model",
        "spend-by-project": "Cost: Spend by Project",
        "hour-of-day": "Cost: Hour of Day",
        "top-sessions": "Cost: Most Expensive Sessions",
      };
      items.push({
        id: `anchor-${anchor}`,
        group: "Panel",
        label: labelMap[anchor],
        keywords: ["jump", "scroll", "panel", "cost", ...kws],
        onPick: () => {
          setActive("cost");
          window.setTimeout(() => {
            const el = document.getElementById(anchor);
            if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
            history.replaceState(null, "", `#${anchor}`);
          }, 80);
        },
      });
    });

    // — Top-level actions worth surfacing on common typed words.
    items.push(
      {
        id: "action-import",
        group: "Actions",
        label: "Import / Sync now",
        hint: "⌘I",
        keywords: ["refresh", "reload", "fetch", "import", "sync", "update"],
        onPick: () => { if (!importing) runImport(); },
      },
      {
        id: "action-refresh-pricing",
        group: "Actions",
        label: "Refresh pricing accuracy",
        keywords: ["price", "pricing", "rates", "validate", "websearch", "current"],
        onPick: () => {
          fetch("/api/pricing/validate?force=1", { method: "POST" }).catch(() => {});
          setActive("settings");
        },
      },
      {
        id: "action-authored-skills",
        group: "Actions",
        label: "Skills you made: open the list",
        keywords: [
          "authored", "mine", "my skills", "user-made", "you made",
          "made yourself", "what did i build", "personal", "custom", "homemade",
        ],
        onPick: () => setAuthoredModalOpen(true),
      },
      {
        id: "action-source-banner-clear",
        group: "Actions",
        label: "Clear source filter",
        hint: "Esc",
        keywords: ["source", "filter", "reset", "all sources", "clear"],
        onPick: () => setSourceFilter("all"),
      },
    );

    // — Auto-discovery: pick up any element in the page tagged with
    //   data-palette-label="..." so new features become reachable from
    //   ⌘K without manually editing this registry. Drop the same
    //   attribute on a new button/link and it shows up here on the
    //   palette's next open. Optional data-palette-keywords (comma-list)
    //   widens the search index for that entry.
    //
    //   This runs at palette-build time which is whenever the memo
    //   deps change; the palette opens on demand, so even slow rebuilds
    //   are invisible to the user.
    if (typeof document !== "undefined") {
      const seen = new Set(items.map((i) => i.id));
      document.querySelectorAll<HTMLElement>("[data-palette-label]").forEach((el, idx) => {
        const label = el.dataset.paletteLabel || "";
        if (!label) return;
        const id = el.dataset.paletteId || `auto-${label.replace(/\s+/g, "-").toLowerCase()}-${idx}`;
        if (seen.has(id)) return;
        seen.add(id);
        const group = el.dataset.paletteGroup || "Page";
        const keywords = (el.dataset.paletteKeywords || "")
          .split(",")
          .map((k) => k.trim())
          .filter(Boolean);
        items.push({
          id,
          group,
          label,
          keywords,
          onPick: () => {
            el.scrollIntoView({ behavior: "smooth", block: "center" });
            // Synthesize a click so the element's own handler fires (open
            // modal, toggle filter, etc.). Buttons + links both respond.
            (el as HTMLElement).click?.();
          },
        });
      });
    }

    // — Skills (capped at 30 to keep the palette snappy; query
    //   narrows further).
    skills.slice(0, 30).forEach((s) => {
      items.push({
        id: `skill-${s.name}`,
        group: "Skill",
        label: s.name,
        hint: s.kind || undefined,
        // Path + category + source so typing the path or "agent" /
        // "plugin" finds the right skill.
        keywords: [
          s.kind || "",
          s.category || "",
          s.source || "",
          s.project || "",
        ].filter(Boolean),
        onPick: () => { setActive("skills"); setSkillDetailName(s.name); },
      });
    });

    return items;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [visibleTabs, knownProjects, skills, projectScope, hiddenSources, importing]);

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
  const totals: Record<string, unknown> = categoryActive
    ? (() => {
        const skillNames = new Set(filteredSkills.map((s) => s.name));
        const eventsSum = filteredSkills.reduce((acc, s) => acc + (s.events || 0), 0);
        const tokensSum = filteredSkills.reduce((acc, s) => acc + (s.total_tokens || 0), 0);
        const errorsSum = filteredSkills.reduce((acc, s) => acc + (s.errors || 0), 0);
        const activeCount = filteredSkills.filter((s) => (s.events || 0) > 0).length;
        // Avg turn, average the visible skills' avg_duration_ms (skip zeros)
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
          turns: Number((serverTotals as Record<string, unknown>).turns || 0),
          // user_skills is a count of skills on disk, doesn't change with
          // the category/project filter. Carry through from the server.
          user_skills: (serverTotals as Record<string, unknown>).user_skills || 0,
          user_skills_by_source: (serverTotals as Record<string, unknown>).user_skills_by_source || {},
        };
      })()
    : (serverTotals as Record<string, unknown>);
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
      {/* Background-sync indicator. While `importing` is true we render
          a slim teal pulse at the very top so the user knows new data
          is being pulled — without dimming the existing dashboard
          (zero-downtime swap). After the sync resolves, the
          `justRefreshed` toast confirms the screen reflects fresh data. */}
      {importing && !loading && (
        <div className="fixed inset-x-0 top-0 z-40">
          <div className="loader-bar" />
        </div>
      )}
      {justRefreshed && (
        <div
          className="fixed right-4 top-4 z-50 flex items-center gap-2 rounded-md border border-teal bg-teal px-3 py-1.5 text-xs font-semibold text-white shadow-lg"
          role="status"
          aria-live="polite"
          style={{ animation: "fade-in-out 2.2s ease both" }}
        >
          <span className="inline-block h-1.5 w-1.5 rounded-full bg-white" />
          Dashboard refreshed
        </div>
      )}
      <header className="flex flex-col gap-4 border-b border-line pb-5 lg:flex-row lg:items-end lg:justify-between">
        <div className="min-w-0">
          <div className="flex items-center gap-2 text-sm font-semibold text-teal">
            <BarChart3 size={18} />
            AI Tab
          </div>
          <h1 className="mt-2 text-2xl font-semibold tracking-normal text-ink sm:text-3xl">
            Your AI coding tab
          </h1>
        </div>
        {/* Header right rail: three controls only. Used to be five
            (search + sync + update + refresh + import) which overflowed
            to a second line on common laptop widths. The search lived
            here from the skill-centric era and is now part of the
            Skills tab's FilterBar; the manual Refresh is redundant
            since Import already calls loadData() after it completes. */}
        <div className="flex shrink-0 items-center gap-2">
          {/* Two 24h sparklines side-by-side: cost (teal) and tokens
              (violet). Always-on glance at both activity dimensions. */}
          <HeaderSparkline metric="cost" />
          <HeaderSparkline metric="tokens" />
          {/* ⌘K palette trigger — clickable hint for users who don't read kbd lists */}
          <button
            type="button"
            onClick={() => setPaletteOpen(true)}
            title="Open command palette (⌘K)"
            className="hidden h-10 items-center gap-1.5 rounded-md border border-line bg-white px-3 text-xs font-medium text-slate-500 hover:border-teal hover:text-ink md:inline-flex"
          >
            <span>Jump…</span>
            <kbd className="rounded bg-slate-100 px-1 text-[10px] tabular-nums">⌘K</kbd>
          </button>
          <SyncStatus
            lastSyncedAt={lastSyncedAt}
            importing={importing}
            autoSyncEnabled={autoSyncEnabled}
            onToggle={() => setAutoSyncEnabled((v) => !v)}
          />
          {(() => {
            const hasUpdate = !!(updateAvailable && updateAvailable > 0);
            return (
              <button
                onClick={runUpdate}
                disabled={updating}
                title={
                  updateCommits.length > 0
                    ? `${updateAvailable} new commit${updateAvailable === 1 ? "" : "s"}:\n` +
                      updateCommits.slice(0, 6).map((c) => `  ${c.sha} ${c.subject}`).join("\n")
                    : hasUpdate
                    ? `${updateAvailable} new commits available`
                    : "git pull --ff-only + npm install if deps changed"
                }
                className={
                  hasUpdate
                    ? "inline-flex h-10 items-center gap-2 rounded-md border-2 border-amber-400 bg-amber-50 px-3 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:cursor-wait disabled:opacity-50"
                    : "inline-flex h-10 items-center gap-2 rounded-md border border-line bg-white px-3 text-sm font-medium text-ink hover:border-teal disabled:cursor-wait disabled:opacity-50"
                }
              >
                <span className={updating ? "inline-block animate-spin" : hasUpdate ? "animate-pulse" : ""}>⤓</span>
                <span className="hidden sm:inline">
                  {updating ? "Updating…" : hasUpdate ? `Update (${updateAvailable})` : "Update"}
                </span>
              </button>
            );
          })()}
          <button
            onClick={runImport}
            disabled={importing}
            title="Re-scan ~/.claude and ~/.codex transcripts (⌘I)"
            className="inline-flex h-10 items-center gap-2 rounded-md bg-ink px-3 text-sm font-medium text-white hover:bg-teal disabled:cursor-wait disabled:opacity-70"
          >
            <Database size={16} />
            <span className="hidden sm:inline">{importing ? "Importing" : "Import"}</span>
          </button>
        </div>
        {importError && (
          <div className="mt-2 text-xs text-rose-600" title={importError}>
            Import failed: {importError.slice(0, 200)}
          </div>
        )}
        {updateMsg && (
          <div
            className={`mt-2 whitespace-pre-wrap text-xs ${
              updateMsg.includes("failed") ? "text-rose-600" : "text-emerald-700"
            }`}
            title={updateMsg}
          >
            {updateMsg}
          </div>
        )}
      </header>

      {/* FilterBar moved into the Skills tab — its controls (category,
          project, hide-unused) only make sense for the skill-centric
          views. Date range is now driven by click-and-drag on the
          time-series charts (see useChartDateBrush). Source filter
          (claude vs codex) still lives here when on Skills, where it
          changes the per-source counts shown in those panels. */}

      {/* Project-scope banner. Only rendered when the user picks a
          project from ⌘K. Highly visible — bold teal strip — so you
          never forget the dashboard is filtered. Click ✕ to clear. */}
      {projectScope && (
        <div className="flex items-center justify-between gap-3 rounded-lg border-2 border-teal bg-teal/10 px-4 py-2.5">
          <div className="flex min-w-0 items-baseline gap-2">
            <span className="text-xs font-semibold uppercase tracking-wider text-teal">
              Project scope
            </span>
            <span className="truncate font-mono text-sm text-ink" title={projectScope}>
              {knownProjects.find((p) => p.cwd === projectScope)?.cwd_short || projectScope}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              · entire dashboard filtered to this cwd
            </span>
          </div>
          <button
            type="button"
            onClick={() => setProjectScope(null)}
            title="Clear scope (or press Esc)"
            className="shrink-0 rounded-md border border-teal bg-white px-2.5 py-1 text-xs font-medium text-teal hover:bg-teal hover:text-white"
          >
            ✕ Clear (Esc)
          </button>
        </div>
      )}

      {/* Source-filter banner. Same shape as the project-scope banner.
          Picks the source's brand color so the strip is unmistakeable
          (Codex black, Claude coral, Cursor blue). Hidden when "all". */}
      {sourceFilter !== "all" && (
        <div
          className={`flex items-center justify-between gap-3 rounded-lg border-2 px-4 py-2.5 ${
            sourceFilter === "claude"
              ? "border-claude bg-claude/10"
              : sourceFilter === "cursor"
                ? "border-cursor bg-cursor/10"
                : "border-codex bg-codex/10"
          }`}
        >
          <div className="flex min-w-0 items-baseline gap-2">
            <span
              className={`text-xs font-semibold uppercase tracking-wider ${
                sourceFilter === "claude"
                  ? "text-claude"
                  : sourceFilter === "cursor"
                    ? "text-cursor"
                    : "text-codex"
              }`}
            >
              Source filter
            </span>
            <span className="truncate text-sm font-semibold text-ink">
              {SOURCE_LABEL[sourceFilter]}
            </span>
            <span className="hidden text-xs text-slate-500 sm:inline">
              · only sessions tagged {SOURCE_LABEL[sourceFilter].toLowerCase()} are counted
            </span>
          </div>
          <button
            type="button"
            onClick={() => setSourceFilter("all")}
            title="Show all sources"
            className={`shrink-0 rounded-md border bg-white px-2.5 py-1 text-xs font-medium hover:text-white ${
              sourceFilter === "claude"
                ? "border-claude text-claude hover:bg-claude"
                : sourceFilter === "cursor"
                  ? "border-cursor text-cursor hover:bg-cursor"
                  : "border-codex text-codex hover:bg-codex"
            }`}
          >
            ✕ Clear
          </button>
        </div>
      )}

      {/* Global date-range bar. Centralized here so every tab — Cost,
          Wrapped, Comparison, Timeline, Skills — picks up the same
          ?from/?to via filterQS. Used to live inside the Skills FilterBar,
          which made it look like a Skills-only control even though every
          endpoint honors it. */}
      <GlobalDateRange
        dateFrom={dateFrom}
        dateTo={dateTo}
        onDateFrom={setDateFrom}
        onDateTo={setDateTo}
      />

      <nav
        className="flex flex-wrap gap-2"
        aria-label="Dashboard sections (1–6 to jump)"
      >
        {/* Derived from the visibleTabs memo so the digit shortcuts and
            the rendered buttons always agree on order — pressing "5"
            jumps to whatever tab is sitting at index 4 right now. */}
        {visibleTabs.map(([id, label], i) => {
          const isWrapped = id === "wrapped";
          const isActive = active === id;
          const base =
            "group inline-flex h-9 items-center gap-1.5 rounded-md border px-3 text-sm font-medium transition-colors";
          let cls = "";
          if (isWrapped) {
            cls = isActive
              ? "border-teal bg-teal text-white"
              : "border-teal bg-white text-teal hover:bg-teal hover:text-white";
          } else if (isActive) {
            cls = "border-ink bg-ink text-white";
          } else {
            cls = "border-line bg-white text-slate-600 hover:border-teal";
          }
          // Small numeric hint shows the keyboard shortcut. Dimmed
          // unless hovered/active — discoverable, not noisy.
          const digit = i + 1;
          return (
            <button
              key={id}
              onClick={() => setActive(id as typeof active)}
              className={`${base} ${cls}`}
              title={`Jump with ${digit}`}
              aria-keyshortcuts={String(digit)}
            >
              <span>{label}</span>
              <kbd
                className={`hidden rounded px-1 text-[10px] tabular-nums sm:inline ${
                  isActive
                    ? "bg-white/20 text-white/80"
                    : "bg-slate-100 text-slate-400 group-hover:bg-slate-200"
                }`}
              >
                {digit}
              </kbd>
            </button>
          );
        })}
      </nav>

      {/* Skill-totals row (incl. the coral Errors card) — only shown on
          the Skills tab. Used to sit above every tab, which made Errors
          the first thing a user saw on Cost / Wrapped / Comparison etc.
          The cost pivot moved that real estate to cost headlines. */}
      {active === "skills" && (
      <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-5">
        <StatCard
          label="Active Skills"
          value={`${formatNumber(totals.active_skills)} / ${formatNumber(totals.skills)}`}
          detail={`${activeSkillRate}% of known skills seen in sessions`}
          icon={Activity}
          tone="teal"
          loading={loading && !overview.totals}
        />
        <StatCard
          label="You Made"
          value={formatNumber(Number(totals.user_skills || 0))}
          detail={(() => {
            const bySrc = (totals as Record<string, unknown>).user_skills_by_source as
              | { claude?: number; codex?: number }
              | undefined;
            const claude = Number(bySrc?.claude || 0);
            const codex = Number(bySrc?.codex || 0);
            if (!claude && !codex) return "Click to see the list";
            const parts: string[] = [];
            if (claude) parts.push(`${claude} Claude`);
            if (codex) parts.push(`${codex} Codex`);
            return `${parts.join(" · ")} · click to view`;
          })()}
          icon={Hammer}
          tone="emerald"
          loading={loading && !overview.totals}
          onClick={() => setAuthoredModalOpen(true)}
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
      )}

      {active === "cost" && (
        <CostOverviewView filterQS={filterQS} onSelectRange={handleChartDateSelect} refreshNonce={refreshNonce} />
      )}
      {active === "wrapped" && (
        <WrappedView
          filterQS={filterQS}
          refreshNonce={refreshNonce}
          onOpenAuthored={() => setAuthoredModalOpen(true)}
        />
      )}

      {active === "skills" && (
        <div className="flex flex-col gap-3">
          {/* Skill-scoped free-text search lives inside the Skills tab
              now (used to be in the global header). Keeps the cost
              experience uncluttered. Press "/" anywhere on this tab to
              focus the input. */}
          <div className="relative">
            <Search
              size={16}
              className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400"
            />
            <input
              id="skills-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Filter skills or errors  (press /)"
              className="h-10 w-full rounded-md border border-line bg-white pl-9 pr-3 text-sm outline-none focus:border-teal sm:w-72"
            />
          </div>
          <FilterBar
            skills={skills}
            projects={projects}
            category={categoryFilter}
            project={projectFilter}
            hideUnused={hideUnused}
            source={sourceFilter}
            hiddenSources={hiddenSources}
            onCategory={setCategoryFilter}
            onProject={setProjectFilter}
            onHideUnused={setHideUnused}
            onSource={setSourceFilter}
            filteredCount={filteredSkills.length}
          />
          {/* Sub-nav so the four big skill panels don't dogpile onto one
              endless scroll. Each pill swaps in one section at a time. */}
          <div className="flex flex-wrap gap-2">
            {([
              ["top", "Top Skills"],
              ["health", "Skill Health"],
              ["errors", "Errors"],
              ["pricing", "Pricing"],
            ] as const).map(([id, label]) => (
              <button
                key={id}
                onClick={() => setSkillsSubtab(id)}
                className={`h-8 rounded-md border px-3 text-xs font-medium transition ${
                  skillsSubtab === id
                    ? "border-teal bg-teal text-white"
                    : "border-line bg-white text-slate-600 hover:border-teal"
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* "overview" was a deprecated tab id that was removed from the
       *  active union but the original render-gate kept it for back-
       *  compat. Stripped because the type narrowing now flags it. */}
      {active === "skills" && skillsSubtab === "top" && (
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

      {active === "skills" && skillsSubtab === "health" && (
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

      {active === "skills" && skillsSubtab === "errors" && (
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
                    {/* Without tickFormatter the raw ints (e.g. 300000000)
                     *  overflow the axis margin and render clipped as
                     *  "30000000" / "0000000". formatTokens produces
                     *  compact labels ("300M"). */}
                    <YAxis tick={{ fontSize: 12 }} tickFormatter={(v) => formatTokens(Number(v))} width={60} />
                    <Tooltip formatter={(v: number) => formatNumber(v)} />
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
        <ComparisonView data={comparison} onSelectRange={handleChartDateSelect} visibleSources={visibleSourceIds} />
      )}
      {active === "skills" && skillsSubtab === "pricing" && (
        <PricingView data={pricing} loading={loading} />
      )}
      {active === "judgments" && <JudgmentsView />}
      {active === "settings" && <SettingsView />}

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
            setSkillDetailName(null);
          }}
        />
      ) : null}
      {authoredModalOpen ? (
        <AuthoredSkillsModal onClose={() => setAuthoredModalOpen(false)} />
      ) : null}

      {/* Global overlays: ⌘K palette + milestone confetti. Palette
          items are computed from current state (top skills, recent
          projects, etc.) so it always reflects current data. */}
      <CommandPalette
        open={paletteOpen}
        onClose={() => setPaletteOpen(false)}
        items={paletteItems}
      />
      <MilestoneConfetti snapshot={milestoneSnap} />
      <GlobalFooter />
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

type AuthoredSkillRow = {
  name: string;
  kind: string;
  source: "claude" | "codex";
  path: string;
  description: string | null;
};

function AuthoredSkillsModal({ onClose }: { onClose: () => void }) {
  const [items, setItems] = useState<AuthoredSkillRow[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch("/api/skills/authored")
      .then((r) => r.json())
      .then((d) => setItems(Array.isArray(d.items) ? d.items : []))
      .finally(() => setLoading(false));
  }, []);

  const grouped = useMemo(() => {
    const m: Record<string, AuthoredSkillRow[]> = { claude: [], codex: [] };
    items.forEach((it) => {
      (m[it.source] ||= []).push(it);
    });
    return m;
  }, [items]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/35 p-4"
      onClick={onClose}
    >
      <div
        className="panel flex max-h-[85vh] w-full max-w-2xl flex-col overflow-hidden"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-line p-4">
          <div>
            <h2 className="text-lg font-semibold text-ink">Skills you made</h2>
            <p className="text-xs text-slate-500">
              {loading ? "Loading..." : `${items.length} skills authored locally, vendor and plugin skills excluded`}
            </p>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md border border-line px-3 py-1 text-xs font-medium hover:border-coral"
          >
            ✕ Close (Esc)
          </button>
        </div>
        <div className="overflow-y-auto p-4">
          {loading ? (
            <div className="py-12 text-center text-sm text-slate-500">Loading...</div>
          ) : items.length === 0 ? (
            <div className="py-12 text-center text-sm text-slate-500">
              No user-authored skills yet. Drop a SKILL.md in ~/.claude/skills/&lt;name&gt;/
              or a .toml in .codex/agents/ and re-import.
            </div>
          ) : (
            (["claude", "codex"] as const).map((src) =>
              grouped[src].length === 0 ? null : (
                <section key={src} className="mb-5 last:mb-0">
                  <h3 className="mb-2 flex items-center gap-2 text-xs font-semibold uppercase tracking-wider text-slate-500">
                    <span
                      className={`inline-block h-2 w-2 rounded-full ${
                        src === "claude" ? "bg-claude" : "bg-codex"
                      }`}
                    />
                    {src === "claude" ? "Claude" : "Codex"} ({grouped[src].length})
                  </h3>
                  <ul className="flex flex-col gap-1.5">
                    {grouped[src].map((row) => (
                      <li
                        key={row.path}
                        className="rounded-md border border-line bg-white p-3 dark:bg-slate-900"
                      >
                        <div className="flex items-baseline justify-between gap-3">
                          <span className="font-mono text-sm font-semibold text-ink">{row.name}</span>
                          <span className="shrink-0 text-[10px] uppercase tracking-wider text-slate-400">
                            {row.kind.replace("_", " ")}
                          </span>
                        </div>
                        {row.description && (
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{row.description}</p>
                        )}
                        <p className="mt-1 truncate font-mono text-[10px] text-slate-400" title={row.path}>
                          {row.path}
                        </p>
                      </li>
                    ))}
                  </ul>
                </section>
              )
            )
          )}
        </div>
      </div>
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

// Global date-range bar. Lives above the tab nav because every metric
// endpoint accepts ?from=&to=, not just the Skills-tab ones — Cost,
// Comparison, Timeline, Wrapped and Skills all read the same filterQS.
// Kept compact (single row) so it doesn't eat real estate, and hides
// itself entirely when no range is set + collapses to a single pill.
function GlobalDateRange({
  dateFrom,
  dateTo,
  onDateFrom,
  onDateTo,
}: {
  dateFrom: string;
  dateTo: string;
  onDateFrom: (v: string) => void;
  onDateTo: (v: string) => void;
}) {
  const presetRange = (days: number) => {
    const to = new Date();
    const from = new Date();
    from.setDate(from.getDate() - days + 1);
    onDateFrom(from.toISOString().slice(0, 10));
    onDateTo(to.toISOString().slice(0, 10));
  };
  const active = !!(dateFrom || dateTo);
  return (
    <div
      className={`flex flex-wrap items-center gap-2 rounded-md border px-3 py-2 text-xs ${
        active
          ? "border-teal/50 bg-teal/5"
          : "border-line bg-white"
      }`}
      role="group"
      aria-label="Date range filter (applies to every tab)"
    >
      <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">
        Date range
      </span>
      <input
        type="date"
        value={dateFrom}
        onChange={(e) => onDateFrom(e.target.value)}
        className="h-8 rounded-md border border-line bg-white px-2 text-xs outline-none focus:border-teal"
        aria-label="From date"
      />
      <span className="text-slate-400">→</span>
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
          { label: "90d", days: 90 },
        ].map((p) => (
          <button
            key={p.label}
            onClick={() => presetRange(p.days)}
            className="h-8 rounded-md border border-line bg-white px-2 text-xs font-medium text-slate-600 hover:border-teal"
          >
            {p.label}
          </button>
        ))}
        {active && (
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
      {active && (
        <span className="ml-auto text-[10px] font-medium text-teal">
          filters every tab
        </span>
      )}
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
  hiddenSources,
  onCategory,
  onProject,
  onHideUnused,
  onSource,
  filteredCount
}: {
  skills: SkillRow[];
  projects: string[];
  category: SkillCategoryFilter;
  project: string;
  hideUnused: boolean;
  source: SourceFilter;
  hiddenSources: SourceId[];
  onCategory: (v: SkillCategoryFilter) => void;
  onProject: (v: string) => void;
  onHideUnused: (v: boolean) => void;
  onSource: (v: SourceFilter) => void;
  filteredCount: number;
}) {
  // The date range used to live here too, but it filters every metric
  // endpoint — not just the Skills views — so it now sits in a global
  // <GlobalDateRange /> bar above the tab content. Keeping FilterBar to
  // genuinely skill-scoped controls (category / project / hide-unused).
  return (
    <div className="panel flex flex-col gap-3 p-3 sm:p-4">
      {/* Row 1: source toggle */}
      <div className="flex flex-wrap items-center gap-2 sm:gap-3">
        <span className="text-[10px] font-semibold uppercase tracking-wide text-slate-500">Source</span>
        <div className="flex flex-wrap gap-1.5">
          {(Object.keys(SOURCE_LABEL) as SourceFilter[])
            .filter((key) => key === "all" || !hiddenSources.includes(key as SourceId))
            .map((key) => {
            const active = source === key;
            const activeColor =
              key === "claude"
                ? "border-claude bg-claude text-white"
                : key === "codex"
                  ? "border-codex bg-codex text-white"
                  : key === "cursor"
                    ? "border-cursor bg-cursor text-white"
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
                {key === "cursor" && <CursorLogo size={12} className={active ? "" : "text-cursor"} />}
                {SOURCE_LABEL[key]}
              </button>
            );
          })}
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
    return <span className="text-xs text-slate-400">n/a</span>;
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

  // Esc precedence inside this modal: if the nested confirm overlay is up,
  // Esc closes that first; otherwise the global handler closes the modal.
  // We use capture+stopPropagation so we win the race with the global one.
  useEffect(() => {
    if (!confirmFix) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        e.stopPropagation();
        setConfirmFix(null);
      }
    };
    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [confirmFix]);

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
  visibleSources,
}: {
  data: ComparisonData;
  onSelectRange?: (from: string, to: string) => void;
  visibleSources: SourceId[];
}) {
  // No-op fallback so the hook contract is satisfied even when parent
  // doesn't wire a setter (e.g. preview / storybook usage).
  const eventsBrush = useChartDateBrush(onSelectRange || (() => {}));
  const tokensBrushChart = useChartDateBrush(onSelectRange || (() => {}));
  // Source data is gated by Settings → Sources. Hiding cursor here
  // means: cursorSrc resolves to undefined, every chart's cursor
  // <Line>/<Area>/<Bar> renders to null, the SourceHeader / ModelList
  // columns drop out, and the totals table's Cursor column hides. The
  // grids re-flow to 2 columns automatically via showCursor checks.
  const showCodex = visibleSources.includes("codex");
  const showClaude = visibleSources.includes("claude");
  const showCursor = visibleSources.includes("cursor");
  const codex = showCodex ? data.sources?.find((s) => s.source === "codex") : undefined;
  const claude = showClaude ? data.sources?.find((s) => s.source === "claude") : undefined;
  const cursorSrc = showCursor ? data.sources?.find((s) => s.source === "cursor") : undefined;

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

  // 3-way merge (codex/claude/cursor). Each source contributes its
  // own per-day rows; we widen the row schema to one column per source
  // and zero-fill the gaps so Recharts can plot all three lines.
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

  // hourlyMerged removed alongside the "When You Use Each Tool" chart.
  // tokenBreakdownData stays — its sole remaining job is to feed the
  // per-source totals shown as legend chips on the area chart above.
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
      {/* Heading. Grid flexes to the count of visible sources so hiding
       *  cursor doesn't leave an empty third column. */}
      <div
        className={`grid gap-3 ${
          visibleSources.length === 1
            ? "sm:grid-cols-1"
            : visibleSources.length === 2
              ? "sm:grid-cols-2"
              : "sm:grid-cols-3"
        }`}
      >
        {showCodex && <SourceHeader name="Codex" totals={codex?.totals} tone="codex" />}
        {showClaude && <SourceHeader name="Claude" totals={claude?.totals} tone="claude" />}
        {showCursor && <SourceHeader name="Cursor" totals={cursorSrc?.totals} tone="cursor" />}
      </div>

      {/* Side-by-side totals table — Codex / Claude / Cursor */}
      <div className="panel overflow-hidden">
        <div className="border-b border-line p-4">
          <h2 className="text-lg font-semibold text-ink">Totals across all sources</h2>
          <p className="text-sm text-slate-500">Within the selected date range.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead className="bg-surface text-left text-xs uppercase text-slate-500">
              <tr>
                <th className="px-3 py-2">Metric</th>
                {showCodex && <th className="px-3 py-2 text-right">Codex</th>}
                {showClaude && <th className="px-3 py-2 text-right">Claude</th>}
                {showCursor && <th className="px-3 py-2 text-right">Cursor</th>}
                <th className="px-3 py-2">Distribution</th>
              </tr>
            </thead>
            <tbody>
              {totalKeys.map(({ key, label, fmt }) => {
                const c = showCodex ? Number(codex?.totals?.[key] || 0) : 0;
                const cl = showClaude ? Number(claude?.totals?.[key] || 0) : 0;
                const cu = showCursor ? Number(cursorSrc?.totals?.[key] || 0) : 0;
                const total = c + cl + cu;
                const pctCodex = total > 0 ? (c / total) * 100 : 0;
                const pctClaude = total > 0 ? (cl / total) * 100 : 0;
                const pctCursor = total > 0 ? (cu / total) * 100 : 0;
                const formatVal = (n: number) =>
                  fmt === "tokens" ? new Intl.NumberFormat("en-US").format(n) : formatNumber(n);
                return (
                  <tr key={key} className="border-t border-line">
                    <td className="px-3 py-2 font-medium text-ink">{label}</td>
                    {showCodex && (
                      <td className="px-3 py-2 text-right font-semibold text-codex">{formatVal(c)}</td>
                    )}
                    {showClaude && (
                      <td className="px-3 py-2 text-right font-semibold text-claude">{formatVal(cl)}</td>
                    )}
                    {showCursor && (
                      <td className="px-3 py-2 text-right font-semibold text-cursor">{formatVal(cu)}</td>
                    )}
                    <td className="px-3 py-2">
                      <div className="flex h-2 w-full overflow-hidden rounded-full bg-line">
                        {showCodex && <div className="bg-codex" style={{ width: `${pctCodex}%` }} />}
                        {showClaude && <div className="bg-claude" style={{ width: `${pctClaude}%` }} />}
                        {showCursor && <div className="bg-cursor" style={{ width: `${pctCursor}%` }} />}
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
                {showCodex && <Line type="monotone" dataKey="codex" stroke={BRAND.codex} strokeWidth={2} dot={false} />}
                {showClaude && <Line type="monotone" dataKey="claude" stroke={BRAND.claude} strokeWidth={2} dot={false} />}
                {showCursor && <Line type="monotone" dataKey="cursor" stroke={BRAND.cursor} strokeWidth={2} dot={false} />}
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
            {showCodex && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-3 rounded-full bg-codex" /> Codex {formatNumber(tokensTotalCodex)}
              </span>
            )}
            {showClaude && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-3 rounded-full bg-claude" /> Claude {formatNumber(tokensTotalClaude)}
              </span>
            )}
            {showCursor && (
              <span className="inline-flex items-center gap-1">
                <span className="h-2 w-3 rounded-full bg-cursor" /> Cursor {formatNumber(tokensTotalCursor)}
              </span>
            )}
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
                {showCodex && <Area type="monotone" dataKey="codex" stroke={BRAND.codex} fill="url(#g-codex)" strokeWidth={2} />}
                {showClaude && <Area type="monotone" dataKey="claude" stroke={BRAND.claude} fill="url(#g-claude)" strokeWidth={2} />}
                {showCursor && <Area type="monotone" dataKey="cursor" stroke={BRAND.cursor} fill="url(#g-cursor)" strokeWidth={2} />}
                {tokensBrushChart.selectionOverlay()}
              </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <EmptyState text="No token data in this range" />
        )}
      </div>

      {/* Viz-audit cuts: Token Breakdown (input/cached/output/reasoning
       *  bars) — the Daily Token Usage area chart above already conveys
       *  the volume story. Hourly cadence ("When You Use Each Tool") —
       *  third copy of hour-of-day. Top Tools per source — raw tool
       *  names like `Bash`/`Read` are inscrutable to a casual viewer.
       *  All three deleted in favor of fewer-but-better signals.
       *  Top Models stays — it's the answer to "what am I actually
       *  paying for" per source, which is the comparison story. */}

      {/* Top models. Grid flexes to visible source count. */}
      <div
        className={`grid gap-3 ${
          visibleSources.length === 1
            ? "sm:grid-cols-1"
            : visibleSources.length === 2
              ? "sm:grid-cols-2"
              : "sm:grid-cols-3"
        }`}
      >
        {showCodex && <ModelList title="Codex Models" tone="codex" rows={codex?.topModels || []} />}
        {showClaude && <ModelList title="Claude Models" tone="claude" rows={claude?.topModels || []} />}
        {showCursor && <ModelList title="Cursor Models" tone="cursor" rows={cursorSrc?.topModels || []} />}
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

// Single lookup so SourceHeader/TopList/ModelList don't each repeat the
// chain of ternaries when a fourth source eventually shows up.
function brandLogo(tone: BrandTone) {
  if (tone === "claude") return ClaudeLogo;
  if (tone === "cursor") return CursorLogo;
  return CodexLogo;
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
  const Logo = brandLogo(tone);
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
  const Logo = brandLogo(tone);
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
  const Logo = brandLogo(tone);
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
        <EmptyState text="No token data. Run Import to populate pricing." />
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
              <span className="font-semibold text-ink">{formatUsd(wouldHaveCost)}</span>.{" "}
              That's <span className="font-semibold text-teal">{savingsPct}% off</span>.
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
                          unpriced, using fallback
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
                <td className="px-3 py-2 text-right">n/a</td>
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
          <Logo size={14} /> {source}: API vs Subscription
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
