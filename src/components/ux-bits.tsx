"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// ─── Skeleton ────────────────────────────────────────────────────────────
//
// Generic shimmery block for "loading" states. Compose into card or chart
// shapes per panel — beats a "Loading…" text label every time because the
// page no longer collapses to nothing during fetch.

export function Skeleton({
  className = "h-4 w-full",
  rounded = "rounded",
}: {
  className?: string;
  rounded?: string;
}) {
  return (
    <div
      className={`relative overflow-hidden bg-slate-100 ${rounded} ${className}`}
      aria-hidden="true"
    >
      <div
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.4s_ease-in-out_infinite] bg-gradient-to-r from-transparent via-white/60 to-transparent"
      />
    </div>
  );
}

/** Pre-shaped skeleton for the main Cost & Tokens layout — six tiles + chart */
export function CostOverviewSkeleton() {
  return (
    <div className="flex flex-col gap-5">
      <div className="grid gap-3 sm:grid-cols-2 md:grid-cols-3 xl:grid-cols-6">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="panel p-4">
            <Skeleton className="h-3 w-1/2" />
            <Skeleton className="mt-3 h-7 w-3/4" />
            <Skeleton className="mt-2 h-3 w-2/3" />
          </div>
        ))}
      </div>
      <div className="panel p-4">
        <Skeleton className="h-4 w-32" />
        <Skeleton className="mt-4 h-64 w-full" rounded="rounded-md" />
      </div>
    </div>
  );
}

// ─── Sparkline ───────────────────────────────────────────────────────────
//
// Tiny inline SVG of recent activity. No axes, no tooltip, just shape —
// belongs next to a headline number, not as a chart panel.

export function Sparkline({
  values,
  width = 120,
  height = 28,
  stroke = "#0f8f8a",
  fill = "rgba(15, 143, 138, 0.12)",
}: {
  values: number[];
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
}) {
  if (!values?.length) return null;
  const max = Math.max(...values, 0);
  const min = 0;
  const range = max - min || 1;
  const n = values.length;
  const points = values.map((v, i) => {
    const x = n === 1 ? width / 2 : (i / (n - 1)) * width;
    const y = height - ((v - min) / range) * (height - 2) - 1;
    return [x, y] as [number, number];
  });
  const path = points.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const closed = `${path} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`} aria-hidden="true">
      <path d={closed} fill={fill} stroke="none" />
      <path d={path} fill="none" stroke={stroke} strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ─── HeaderSparkline ─────────────────────────────────────────────────────
//
// Fetches the last 24h sparkline and renders it with a small dollar label
// next to it. Self-contained — drop it anywhere in the header.

type SparkPayload = {
  ok: boolean;
  points?: { hour_iso: string; cost: number; tokens: number }[];
  end_iso?: string | null;
  total_cost?: number;
};

/**
 * Header pill: "24h ~~~~~ $585" or "24h ~~~~~ 1.4M". Single shared
 * fetch + render, parameterized by metric. Renders two side-by-side in
 * the header — one for cost, one for tokens — so the user sees both
 * dimensions of recent activity at a glance.
 */
export function HeaderSparkline({ metric = "cost" }: { metric?: "cost" | "tokens" }) {
  const [data, setData] = useState<SparkPayload | null>(null);
  useEffect(() => {
    let cancelled = false;
    const load = () => {
      fetch("/api/metrics/sparkline")
        .then((r) => r.json())
        .then((j) => { if (!cancelled) setData(j); })
        .catch(() => {});
    };
    load();
    const id = window.setInterval(load, 5 * 60 * 1000);
    return () => { cancelled = true; window.clearInterval(id); };
  }, []);

  if (!data?.ok || !data.points?.length) return null;
  const values =
    metric === "tokens" ? data.points.map((p) => p.tokens) : data.points.map((p) => p.cost);
  const total = values.reduce((a, b) => a + b, 0);

  const label = metric === "tokens" ? formatTokens(total) : formatUsd(total);
  const stroke = metric === "tokens" ? "#6157a8" : "#0f8f8a";
  const fill = metric === "tokens" ? "rgba(97, 87, 168, 0.12)" : "rgba(15, 143, 138, 0.12)";

  return (
    <div
      className="hidden items-center gap-2 rounded-md border border-line bg-white px-3 py-1.5 text-xs lg:flex"
      title={`Last 24h ${metric === "tokens" ? "billable tokens" : "spend"} ending ${data.end_iso?.slice(0, 16) || ""}`}
    >
      <span className="text-slate-500">24h</span>
      <Sparkline values={values} width={96} height={22} stroke={stroke} fill={fill} />
      <span className="font-semibold tabular-nums text-ink">{label}</span>
    </div>
  );
}

function formatUsd(n: number) {
  if (n >= 100) return `$${Math.round(n).toLocaleString()}`;
  if (n >= 1) return `$${n.toFixed(2)}`;
  if (n > 0) return `$${n.toFixed(3)}`;
  return "$0";
}
function formatTokens(n: number) {
  if (!n) return "0";
  if (n < 1_000) return String(n);
  if (n < 1_000_000) return `${(n / 1_000).toFixed(1)}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  return `${(n / 1_000_000_000).toFixed(2)}B`;
}

// ─── Confetti ────────────────────────────────────────────────────────────
//
// Pure-canvas confetti, no library. Triggers on milestone crossings —
// tracked via localStorage so each milestone fires exactly once per
// browser. Self-cleans after ~2.5s.

type MilestoneSnapshot = {
  spend: number;
  saved: number;
  tokens: number;
};

const SPEND_STEPS = [100, 500, 1000, 2500, 5000, 10_000, 25_000, 50_000];
const SAVED_STEPS = [100, 500, 1_000, 5_000, 10_000, 50_000, 100_000];
const TOKEN_STEPS = [1_000_000, 10_000_000, 100_000_000, 1_000_000_000];

function crossedSteps(prev: number, curr: number, steps: number[]): number[] {
  return steps.filter((s) => prev < s && curr >= s);
}

export function MilestoneConfetti({ snapshot }: { snapshot: MilestoneSnapshot | null }) {
  const [bursting, setBursting] = useState<{ id: number; label: string } | null>(null);
  const lastSeenRef = useRef<MilestoneSnapshot | null>(null);

  useEffect(() => {
    if (!snapshot) return;
    const raw = localStorage.getItem("ai-tab.milestones");
    const seen = raw ? (JSON.parse(raw) as MilestoneSnapshot) : { spend: 0, saved: 0, tokens: 0 };
    const triggered: string[] = [];
    crossedSteps(seen.spend, snapshot.spend, SPEND_STEPS).forEach((s) =>
      triggered.push(`Crossed $${s.toLocaleString()} in lifetime spend`)
    );
    crossedSteps(seen.saved, snapshot.saved, SAVED_STEPS).forEach((s) =>
      triggered.push(`Cached $${s.toLocaleString()} of input — that's a lot of cheap reads`)
    );
    crossedSteps(seen.tokens, snapshot.tokens, TOKEN_STEPS).forEach((s) => {
      const lbl = s >= 1_000_000_000 ? `${s / 1_000_000_000}B` : `${s / 1_000_000}M`;
      triggered.push(`${lbl} billable tokens consumed`);
    });
    if (triggered.length > 0) {
      setBursting({ id: Date.now(), label: triggered[0] });
    }
    // Always update high-water mark so we don't re-fire on next mount.
    localStorage.setItem(
      "ai-tab.milestones",
      JSON.stringify({
        spend: Math.max(seen.spend, snapshot.spend),
        saved: Math.max(seen.saved, snapshot.saved),
        tokens: Math.max(seen.tokens, snapshot.tokens),
      })
    );
    lastSeenRef.current = snapshot;
  }, [snapshot]);

  if (!bursting) return null;
  return <ConfettiBurst key={bursting.id} label={bursting.label} onDone={() => setBursting(null)} />;
}

function ConfettiBurst({ label, onDone }: { label: string; onDone: () => void }) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.offsetWidth * dpr;
    canvas.height = canvas.offsetHeight * dpr;
    ctx.scale(dpr, dpr);
    const w = canvas.offsetWidth;
    const h = canvas.offsetHeight;
    const colors = ["#0f8f8a", "#d97c52", "#6157a8", "#b78318", "#d55c47", "#3f7fbc"];
    const N = 90;
    const particles = Array.from({ length: N }, () => ({
      x: w / 2,
      y: h / 3,
      vx: (Math.random() - 0.5) * 8,
      vy: -Math.random() * 7 - 3,
      g: 0.18,
      r: Math.random() * 4 + 3,
      color: colors[Math.floor(Math.random() * colors.length)],
      rot: Math.random() * Math.PI,
      vr: (Math.random() - 0.5) * 0.3,
    }));
    let raf = 0;
    const start = performance.now();
    function frame(t: number) {
      ctx!.clearRect(0, 0, w, h);
      let alive = 0;
      for (const p of particles) {
        p.vy += p.g;
        p.x += p.vx;
        p.y += p.vy;
        p.rot += p.vr;
        if (p.y < h + 40) alive += 1;
        ctx!.save();
        ctx!.translate(p.x, p.y);
        ctx!.rotate(p.rot);
        ctx!.fillStyle = p.color;
        ctx!.fillRect(-p.r, -p.r * 0.6, p.r * 2, p.r * 1.2);
        ctx!.restore();
      }
      if (alive > 0 && t - start < 2500) raf = requestAnimationFrame(frame);
      else onDone();
    }
    raf = requestAnimationFrame(frame);
    return () => cancelAnimationFrame(raf);
  }, [onDone]);

  return (
    <div className="pointer-events-none fixed inset-0 z-[100]" aria-live="polite">
      <canvas ref={canvasRef} className="absolute inset-0 h-full w-full" />
      <div className="absolute left-1/2 top-12 -translate-x-1/2 rounded-full border-2 border-teal bg-white px-5 py-2 text-sm font-semibold text-teal shadow-lg">
        {label}
      </div>
    </div>
  );
}

// ─── CommandPalette ──────────────────────────────────────────────────────
//
// ⌘K modal. Searches across tabs, skills, models, projects, and recent
// expensive sessions. Picks call back to the parent to switch tabs.

// Palette entries are intentionally a free-form list keyed by `group`,
// not a closed union. Anything in the app can declare its own group and
// it'll render in insertion order under that header. Keeping `group` as
// `string` makes new dynamic surfaces (Settings actions, Panel anchors,
// Region picks, Source filters, Recent sessions) trivial to plug in.
export type PaletteItem = {
  id: string;
  label: string;
  hint?: string;
  group: string;
  // Free-form match tags. Typing any of these surfaces the item even
  // when the label doesn't contain the typed text. Example: a "Source:
  // Cursor" item tagged with ["cursor", "ide"] surfaces when the user
  // types either "cursor" or "ide".
  keywords?: string[];
  onPick: () => void;
};

// ─── matching ───────────────────────────────────────────────────────────
//
// Score-based search. For each item we compute the best score across
// label / group / keywords / hint using a couple of heuristics:
//
//   exact match              → 1000
//   prefix match              → 500
//   substring match            → 200 - position (earlier = better)
//   fuzzy subsequence match     → 50 + density bonus
//   recency boost            → +120  (item picked within the last ~12 picks)
//
// Items below the threshold are dropped entirely; the rest are sorted
// by score descending, then by original insertion order for stability.
// "Smart" doesn't mean LLM-backed — it means the right rules so the
// obvious top hit actually shows up first.

import { readPrefs, setPref } from "./use-prefs";

const RECENCY_LIMIT = 12;

function readRecency(): string[] {
  return (readPrefs().paletteRecency || []).filter((s) => typeof s === "string");
}

function pushRecency(id: string) {
  const cur = readRecency().filter((x) => x !== id);
  cur.unshift(id);
  cur.length = Math.min(cur.length, RECENCY_LIMIT);
  setPref("paletteRecency", cur);
}

function fuzzySubsequenceScore(haystack: string, needle: string): number {
  // Returns 0 if `needle` isn't a subsequence of `haystack`. Otherwise:
  // 50 base + a density bonus (smaller matched span = higher score).
  if (!needle) return 0;
  let i = 0;
  let firstHit = -1;
  let lastHit = -1;
  for (let h = 0; h < haystack.length && i < needle.length; h++) {
    if (haystack[h] === needle[i]) {
      if (firstHit === -1) firstHit = h;
      lastHit = h;
      i += 1;
    }
  }
  if (i !== needle.length) return 0;
  const span = lastHit - firstHit + 1;
  const density = needle.length / span; // 1.0 = perfect contiguous
  return 50 + Math.round(density * 40);
}

function scoreItem(it: PaletteItem, q: string, recencyRank: number): number {
  if (!q) return 1000 - recencyRank; // empty query → keep insertion + recency
  const needle = q.toLowerCase();
  const label = it.label.toLowerCase();
  const group = it.group.toLowerCase();
  const hint = (it.hint || "").toLowerCase();
  const kws = (it.keywords || []).map((k) => k.toLowerCase());

  let best = 0;

  // Exact / prefix / substring on label (the strongest signal).
  if (label === needle) best = Math.max(best, 1000);
  else if (label.startsWith(needle)) best = Math.max(best, 500);
  else {
    const idx = label.indexOf(needle);
    if (idx >= 0) best = Math.max(best, 200 - Math.min(idx, 150));
  }

  // Same scoring on keywords (slightly discounted vs label).
  for (const k of kws) {
    if (k === needle) best = Math.max(best, 900);
    else if (k.startsWith(needle)) best = Math.max(best, 420);
    else if (k.includes(needle)) best = Math.max(best, 180);
  }

  // Group / hint as weaker substring hits.
  if (group.includes(needle)) best = Math.max(best, 90);
  if (hint.includes(needle)) best = Math.max(best, 60);

  // Fallback: fuzzy subsequence on label AND keywords so "cmpre" can
  // surface "Comparison" via its `compare` keyword. Keyword fuzz is
  // discounted slightly (×0.9) so a label-fuzz match still wins ties.
  if (best < 50) {
    const fuzz = fuzzySubsequenceScore(label, needle);
    if (fuzz > 0) best = Math.max(best, fuzz);
    for (const k of kws) {
      const kf = fuzzySubsequenceScore(k, needle);
      if (kf > 0) best = Math.max(best, Math.round(kf * 0.9));
    }
  }

  // Recency boost — only meaningful if we actually matched.
  if (best > 0 && recencyRank >= 0) {
    best += Math.max(0, 120 - recencyRank * 10);
  }
  return best;
}

export function CommandPalette({
  open,
  onClose,
  items,
}: {
  open: boolean;
  onClose: () => void;
  items: PaletteItem[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const [recency, setRecency] = useState<string[]>([]);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (!open) {
      setQ("");
      setActive(0);
      return;
    }
    setRecency(readRecency());
    const t = window.setTimeout(() => inputRef.current?.focus(), 30);
    return () => window.clearTimeout(t);
  }, [open]);

  const filtered = useMemo(() => {
    const scored = items
      .map((it) => {
        const rank = recency.indexOf(it.id);
        return { it, score: scoreItem(it, q, rank) };
      })
      .filter(({ score }) => score > (q ? 25 : 0));
    scored.sort((a, b) => b.score - a.score);
    return scored.map(({ it }) => it);
  }, [items, q, recency]);

  const onKey = useCallback(
    (e: React.KeyboardEvent) => {
      if (e.key === "Escape") {
        e.preventDefault();
        onClose();
      } else if (e.key === "ArrowDown") {
        e.preventDefault();
        setActive((a) => Math.min(a + 1, filtered.length - 1));
      } else if (e.key === "ArrowUp") {
        e.preventDefault();
        setActive((a) => Math.max(a - 1, 0));
      } else if (e.key === "Enter") {
        e.preventDefault();
        const pick = filtered[active];
        if (pick) {
          pushRecency(pick.id);
          pick.onPick();
          onClose();
        }
      }
    },
    [active, filtered, onClose]
  );

  if (!open) return null;

  // Group items in display order, preserving the filtered selection map.
  const groups: Record<string, PaletteItem[]> = {};
  filtered.forEach((it) => {
    (groups[it.group] = groups[it.group] || []).push(it);
  });

  return (
    <div
      className="fixed inset-0 z-[80] flex items-start justify-center bg-black/40 p-4 pt-24"
      onClick={onClose}
    >
      <div
        className="w-full max-w-xl overflow-hidden rounded-xl border border-line bg-white shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            setActive(0);
          }}
          onKeyDown={onKey}
          placeholder="Jump to anything…  (↑↓ Enter · Esc to close)"
          className="w-full border-b border-line bg-white px-4 py-3 text-sm outline-none"
        />
        <div className="max-h-96 overflow-y-auto">
          {filtered.length === 0 ? (
            <div className="px-4 py-6 text-center text-sm text-slate-500">No matches.</div>
          ) : (
            Object.entries(groups).map(([group, list]) => (
              <div key={group}>
                <div className="bg-slate-50 px-4 py-1.5 text-[10px] font-semibold uppercase tracking-wider text-slate-500">
                  {group}
                </div>
                {list.map((it) => {
                  const isActive = filtered[active]?.id === it.id;
                  return (
                    <button
                      key={it.id}
                      onMouseEnter={() => setActive(filtered.indexOf(it))}
                      onClick={() => {
                        pushRecency(it.id);
                        it.onPick();
                        onClose();
                      }}
                      className={`flex w-full items-baseline justify-between gap-3 border-b border-line px-4 py-2 text-left text-sm ${
                        isActive ? "bg-teal/10 text-ink" : "bg-white text-slate-700 hover:bg-slate-50"
                      }`}
                    >
                      <span className="truncate">{it.label}</span>
                      {it.hint && <span className="shrink-0 text-xs text-slate-400">{it.hint}</span>}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>
        <div className="border-t border-line bg-slate-50 px-4 py-1.5 text-[10px] text-slate-500">
          Tip: type to filter · ↑↓ to navigate · Enter to pick
        </div>
      </div>
    </div>
  );
}

// ─── PanelAnchor ─────────────────────────────────────────────────────────
//
// Drop-in wrapper to give a panel an id + a hover-reveal "#" link so the
// user can deep-link to a specific section.

export function PanelAnchor({ id }: { id: string }) {
  return (
    <a
      href={`#${id}`}
      onClick={(e) => {
        // Update the URL hash without triggering a full scroll-jump if
        // we're already there.
        if (typeof window !== "undefined" && window.location.hash === `#${id}`) {
          e.preventDefault();
        }
      }}
      className="ml-1 inline-block text-slate-300 opacity-0 transition-opacity hover:text-teal group-hover:opacity-100"
      aria-label={`Link to ${id}`}
    >
      #
    </a>
  );
}

// ─── shimmer keyframe (global) ───────────────────────────────────────────
//
// Tailwind doesn't ship a shimmer keyframe by default. Inject one
// globally on first mount so <Skeleton> works without tailwind.config
// changes. Cheap — re-execution is a no-op since the rule already exists.

if (typeof document !== "undefined" && !document.getElementById("__ux_shimmer__")) {
  const style = document.createElement("style");
  style.id = "__ux_shimmer__";
  style.textContent = `@keyframes shimmer { 100% { transform: translateX(100%); } }`;
  document.head.appendChild(style);
}
