"use client";

import { useEffect, useState } from "react";
import { Sun, Moon, Monitor, Eye, EyeOff, RefreshCw, Globe2 } from "lucide-react";
import { readPrefs, setPref, usePrefs } from "./use-prefs";

// ─── settings model ────────────────────────────────────────────────────
//
// User preferences (theme, hidden tabs, hidden sources, region, sync
// interval, anonymize, palette recency) live in SQLite via /api/prefs.
// Reads consult an in-memory mirror managed by `./use-prefs.ts`; writes
// go through `setPref(key, value)` which write-through to the DB.
//
// Theme is also mirrored into localStorage purely so the pre-paint
// inline script in layout.tsx can apply the right class before React
// hydrates (avoids FOUC). The DB is the source of truth; localStorage
// is a read-cache.

export type Theme = "light" | "dark" | "system";

// All known sources. Adding a new source (e.g. "windsurf") later means
// appending here AND updating the comparison/cost views to read from it
// — kept in one place so the Settings UI and dashboard nav stay in sync.
export const ALL_SOURCES = ["codex", "claude", "cursor"] as const;
export type SourceId = (typeof ALL_SOURCES)[number];

export function readHiddenSources(): SourceId[] {
  return (readPrefs().hiddenSources || []).filter((s): s is SourceId =>
    ALL_SOURCES.includes(s as SourceId)
  );
}

export function visibleSources(): SourceId[] {
  const hidden = new Set(readHiddenSources());
  return ALL_SOURCES.filter((s) => !hidden.has(s));
}

// Region codes shared with the fun-facts route (src/app/api/metrics/fun-facts).
// "auto" means: detect from the browser's IANA timezone at read time.
export type Region = "auto" | "US" | "IN" | "UK" | "EU" | "JP" | "AU" | "GLOBAL";

const REGION_LABELS: Record<Exclude<Region, "auto">, string> = {
  US: "United States",
  IN: "India",
  UK: "United Kingdom",
  EU: "Europe",
  JP: "Japan",
  AU: "Australia",
  GLOBAL: "Global (USD)",
};

// IANA timezone → region. Anything not matched falls through to GLOBAL,
// which keeps the prompt locale-neutral instead of shoving the user
// into the US bucket by default.
function detectRegionFromTimezone(): Exclude<Region, "auto"> {
  try {
    const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "";
    if (tz.startsWith("Asia/Kolkata") || tz.startsWith("Asia/Calcutta")) return "IN";
    if (tz === "Europe/London") return "UK";
    if (tz.startsWith("Europe/")) return "EU";
    if (tz.startsWith("Asia/Tokyo")) return "JP";
    if (tz.startsWith("Australia/")) return "AU";
    if (tz.startsWith("America/") || tz.startsWith("US/")) return "US";
  } catch { /* Intl unavailable on legacy runtimes */ }
  return "GLOBAL";
}

export function readRegion(): Region {
  const v = readPrefs().region as Region;
  if (v === "auto" || (typeof v === "string" && v in REGION_LABELS)) return v;
  return "auto";
}

/** Resolves "auto" to a concrete code by reading the system timezone. */
export function resolveRegion(): Exclude<Region, "auto"> {
  const stored = readRegion();
  if (stored !== "auto") return stored;
  return detectRegionFromTimezone();
}

// Floor on auto-sync cadence. Below this the importer + cache rebuild
// dominate the user's runtime experience, and the underlying data
// rarely changes faster than 10 min anyway.
export const MIN_SYNC_MINUTES = 10;
export const DEFAULT_SYNC_MINUTES = 30;

export function readSyncIntervalMinutes(): number {
  const n = Number(readPrefs().syncIntervalMinutes);
  if (!Number.isFinite(n)) return DEFAULT_SYNC_MINUTES;
  if (n <= 0) return 0;
  return Math.max(MIN_SYNC_MINUTES, Math.round(n));
}

export function readTheme(): Theme {
  const v = readPrefs().theme;
  return v === "light" || v === "dark" ? v : "system";
}

export function readHiddenTabs(): string[] {
  return (readPrefs().hiddenTabs || []).filter((s) => typeof s === "string");
}

// Resolves "system" to "light" or "dark" and updates the <html> class.
// Called whenever the user picks a new theme. Also wires up a media
// query listener while "system" is active so the dashboard re-syncs if
// the OS theme flips at runtime.
function applyTheme(theme: Theme) {
  if (typeof document === "undefined") return;
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const dark = theme === "dark" || (theme === "system" && prefersDark);
  document.documentElement.classList.toggle("dark", dark);
}

// ─── view ──────────────────────────────────────────────────────────────

const TAB_OPTIONS: Array<{ id: string; label: string; description: string }> = [
  { id: "cost", label: "Cost & Tokens", description: "Center stage. Hiding this is bold." },
  { id: "wrapped", label: "Wrapped", description: "Shareable year-in-review card." },
  { id: "comparison", label: "Claude vs Codex", description: "Side-by-side source breakdown." },
  { id: "timeline", label: "Timeline", description: "Hourly token flow." },
  { id: "judgments", label: "Judgments", description: "Haiku/Codex skill verdicts." },
  { id: "skills", label: "Skills", description: "Legacy skill analytics + errors + pricing." },
];

export default function SettingsView() {
  const [theme, setTheme] = useState<Theme>("system");
  const [hidden, setHidden] = useState<string[]>([]);
  // Sync interval in minutes. 0 = auto-sync off. Stored separately from
  // the autoSyncEnabled toggle so flipping the toggle off and back on
  // restores the user's chosen cadence.
  const [syncMin, setSyncMin] = useState<number>(DEFAULT_SYNC_MINUTES);
  const [syncDraft, setSyncDraft] = useState<string>(String(DEFAULT_SYNC_MINUTES));
  // Region for AI fun-fact metaphors. "auto" derives from the system
  // timezone so the default is sensible without forcing the user to pick.
  const [region, setRegion] = useState<Region>("auto");
  const [resolvedRegion, setResolvedRegion] = useState<Exclude<Region, "auto">>("US");
  // Per-source visibility. Each source the user hides disappears from
  // every chart, source-filter pill, and the comparison view's columns.
  const [hiddenSources, setHiddenSources] = useState<SourceId[]>([]);

  // usePrefs ensures the in-memory cache is hydrated from /api/prefs;
  // `prefsLoaded` flips true on first successful load (or default fallback).
  const { loaded: prefsLoaded } = usePrefs();
  // Hydrate local mirror state once prefs are loaded — and re-sync on
  // every subsequent change so cross-component updates (e.g. ⌘K
  // toggling theme) keep this panel in sync.
  useEffect(() => {
    if (!prefsLoaded) return;
    setTheme(readTheme());
    setHidden(readHiddenTabs());
    const cur = readSyncIntervalMinutes();
    setSyncMin(cur);
    setSyncDraft(cur === 0 ? "" : String(cur));
    setRegion(readRegion());
    setResolvedRegion(resolveRegion());
    setHiddenSources(readHiddenSources());
  }, [prefsLoaded]);

  useEffect(() => {
    // Live-follow OS theme flips while "system" is selected. The
    // listener is cleaned up on unmount.
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => {
      if (readTheme() === "system") applyTheme("system");
    };
    mq.addEventListener?.("change", onChange);
    return () => mq.removeEventListener?.("change", onChange);
  }, []);

  // All writers below go through setPref → the DB. setPref also fires
  // the legacy per-key CustomEvents (dashboard:hidden-tabs etc.) so any
  // listener that hasn't migrated to the unified dashboard:prefs event
  // still works.

  function pickTheme(next: Theme) {
    setTheme(next);
    setPref("theme", next);
    applyTheme(next);
  }

  function toggleTab(id: string) {
    const next = hidden.includes(id) ? hidden.filter((t) => t !== id) : [...hidden, id];
    setHidden(next);
    setPref("hiddenTabs", next);
  }

  function resetTabs() {
    setHidden([]);
    setPref("hiddenTabs", []);
  }

  function toggleSource(id: SourceId) {
    const next = hiddenSources.includes(id)
      ? hiddenSources.filter((s) => s !== id)
      : [...hiddenSources, id];
    setHiddenSources(next);
    setPref("hiddenSources", next);
  }

  function pickRegion(next: Region) {
    setRegion(next);
    setResolvedRegion(next === "auto" ? detectRegionFromTimezone() : next);
    setPref("region", next);
  }

  // Commit the typed-in interval. Empty string disables auto-sync;
  // anything below the floor clamps up to MIN_SYNC_MINUTES. We commit
  // on blur and on Enter so the user doesn't have to click away.
  function commitSync(raw: string) {
    const trimmed = raw.trim();
    let next: number;
    if (trimmed === "") {
      next = 0;
    } else {
      const n = Number(trimmed);
      if (!Number.isFinite(n) || n <= 0) {
        next = 0;
      } else {
        next = Math.max(MIN_SYNC_MINUTES, Math.round(n));
      }
    }
    setSyncMin(next);
    setSyncDraft(next === 0 ? "" : String(next));
    setPref("syncIntervalMinutes", next);
  }

  return (
    <div className="flex flex-col gap-6">
      {/* ── Appearance ── */}
      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-ink">Appearance</h2>
        <p className="mt-1 text-sm text-slate-500">
          Pick a theme. &quot;System&quot; follows your OS preference and updates live if you flip it.
        </p>
        <div className="mt-4 flex flex-wrap gap-2">
          {(
            [
              { id: "light", label: "Light", icon: Sun },
              { id: "dark", label: "Dark", icon: Moon },
              { id: "system", label: "System", icon: Monitor },
            ] as const
          ).map(({ id, label, icon: Icon }) => {
            const active = theme === id;
            return (
              <button
                key={id}
                onClick={() => pickTheme(id)}
                className={`inline-flex h-10 items-center gap-2 rounded-md border px-3 text-sm font-medium transition ${
                  active
                    ? "border-teal bg-teal text-white"
                    : "border-line bg-white text-slate-700 hover:border-teal"
                }`}
              >
                <Icon size={16} />
                {label}
              </button>
            );
          })}
        </div>
      </section>

      {/* ── Auto-sync ── */}
      <section className="panel p-5">
        <div className="flex items-start gap-3">
          <RefreshCw size={20} className="mt-0.5 text-teal" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-ink">Auto-sync</h2>
            <p className="mt-1 text-sm text-slate-500">
              How often the dashboard re-imports{" "}
              <span className="mono text-xs">~/.claude</span> and{" "}
              <span className="mono text-xs">~/.codex</span> in the background. The minimum is{" "}
              {MIN_SYNC_MINUTES} minutes — anything faster pegs the importer. Leave blank to disable.
            </p>
            <div className="mt-4 flex flex-wrap items-center gap-2">
              <input
                type="number"
                min={MIN_SYNC_MINUTES}
                step={5}
                value={syncDraft}
                onChange={(e) => setSyncDraft(e.target.value)}
                onBlur={(e) => commitSync(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    commitSync((e.target as HTMLInputElement).value);
                    (e.target as HTMLInputElement).blur();
                  }
                }}
                placeholder="off"
                className="h-10 w-28 rounded-md border border-line bg-white px-3 text-sm outline-none focus:border-teal"
              />
              <span className="text-sm text-slate-500">minutes</span>
              <span
                className={`ml-1 inline-flex h-6 items-center rounded-full px-2 text-xs font-medium ${
                  syncMin === 0
                    ? "bg-slate-100 text-slate-500"
                    : "bg-teal/10 text-teal"
                }`}
              >
                {syncMin === 0 ? "Auto-sync off" : `Every ${syncMin} min`}
              </span>
            </div>
            {/* Quick preset chips so the user doesn't have to type. */}
            <div className="mt-3 flex flex-wrap gap-1.5">
              {[10, 15, 30, 60, 120].map((m) => (
                <button
                  key={m}
                  onClick={() => commitSync(String(m))}
                  className={`h-7 rounded-md border px-2 text-xs font-medium ${
                    syncMin === m
                      ? "border-teal bg-teal text-white"
                      : "border-line bg-white text-slate-600 hover:border-teal"
                  }`}
                >
                  {m} min
                </button>
              ))}
              <button
                onClick={() => commitSync("")}
                className={`h-7 rounded-md border px-2 text-xs font-medium ${
                  syncMin === 0
                    ? "border-teal bg-teal text-white"
                    : "border-line bg-white text-slate-600 hover:border-teal"
                }`}
              >
                Off
              </button>
            </div>
          </div>
        </div>
      </section>

      {/* ── Region (for AI fun facts) ── */}
      <section className="panel p-5">
        <div className="flex items-start gap-3">
          <Globe2 size={20} className="mt-0.5 text-teal" />
          <div className="flex-1">
            <h2 className="text-lg font-semibold text-ink">Region</h2>
            <p className="mt-1 text-sm text-slate-500">
              Picks the metaphor bank for AI-generated &quot;did you know&quot; tidbits.
              India → auto-rickshaw rides &amp; ₹ conversions. UK → pints &amp; £. Etc.
              &quot;Auto&quot; reads your system timezone.
            </p>
            <div className="mt-4 flex flex-wrap gap-2">
              {(["auto", "US", "IN", "UK", "EU", "JP", "AU", "GLOBAL"] as Region[]).map((id) => {
                const active = region === id;
                const label =
                  id === "auto"
                    ? `Auto (${REGION_LABELS[resolvedRegion]})`
                    : REGION_LABELS[id as Exclude<Region, "auto">];
                return (
                  <button
                    key={id}
                    onClick={() => pickRegion(id)}
                    className={`h-9 rounded-md border px-3 text-xs font-medium transition ${
                      active
                        ? "border-teal bg-teal text-white"
                        : "border-line bg-white text-slate-700 hover:border-teal"
                    }`}
                  >
                    {label}
                  </button>
                );
              })}
            </div>
          </div>
        </div>
      </section>

      {/* ── Visible sources ── */}
      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-ink">Sources</h2>
        <p className="mt-1 text-sm text-slate-500">
          Pick the AI tools you actually use. Hidden sources disappear from every
          chart, the Comparison columns, and the source-filter pills.
        </p>
        <ul className="mt-4 grid gap-2 sm:grid-cols-3">
          {ALL_SOURCES.map((id) => {
            const isHidden = hiddenSources.includes(id);
            const sourceLabels: Record<SourceId, string> = {
              codex: "Codex",
              claude: "Claude",
              cursor: "Cursor",
            };
            const sourceClass: Record<SourceId, string> = {
              codex: "border-codex/40",
              claude: "border-claude/40",
              cursor: "border-cursor/40",
            };
            return (
              <li
                key={id}
                className={`flex items-center justify-between gap-3 rounded-md border bg-white p-3 transition ${
                  isHidden ? "border-line opacity-60" : sourceClass[id]
                }`}
              >
                <span className="text-sm font-semibold text-ink">{sourceLabels[id]}</span>
                <button
                  onClick={() => toggleSource(id)}
                  className={`inline-flex h-7 w-7 items-center justify-center rounded-md border ${
                    isHidden
                      ? "border-line bg-white text-slate-400"
                      : "border-teal bg-teal text-white"
                  }`}
                  aria-label={isHidden ? `Show ${sourceLabels[id]}` : `Hide ${sourceLabels[id]}`}
                  title={isHidden ? "Hidden — click to show" : "Visible — click to hide"}
                >
                  {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Visible tabs ── */}
      <section className="panel p-5">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-lg font-semibold text-ink">Visible Tabs</h2>
            <p className="mt-1 text-sm text-slate-500">
              Hide tabs you don&apos;t use. Settings always stays visible. Changes apply instantly.
            </p>
          </div>
          {hidden.length > 0 && (
            <button
              onClick={resetTabs}
              className="h-8 rounded-md border border-line bg-white px-3 text-xs font-medium text-slate-600 hover:border-teal"
            >
              Show all
            </button>
          )}
        </div>
        <ul className="mt-4 grid gap-2 sm:grid-cols-2">
          {TAB_OPTIONS.map((opt) => {
            const isHidden = hidden.includes(opt.id);
            return (
              <li
                key={opt.id}
                className={`flex items-start gap-3 rounded-md border bg-white p-3 transition ${
                  isHidden ? "border-line opacity-60" : "border-teal/40"
                }`}
              >
                <button
                  onClick={() => toggleTab(opt.id)}
                  className={`mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border ${
                    isHidden
                      ? "border-line bg-white text-slate-400"
                      : "border-teal bg-teal text-white"
                  }`}
                  aria-label={isHidden ? `Show ${opt.label}` : `Hide ${opt.label}`}
                  title={isHidden ? "Hidden — click to show" : "Visible — click to hide"}
                >
                  {isHidden ? <EyeOff size={14} /> : <Eye size={14} />}
                </button>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-ink">{opt.label}</div>
                  <div className="text-xs text-slate-500">{opt.description}</div>
                </div>
              </li>
            );
          })}
        </ul>
      </section>

      {/* ── Pricing validation ── */}
      <PricingValidatorPanel />

      {/* ── About ── */}
      <section className="panel p-5">
        <h2 className="text-lg font-semibold text-ink">About</h2>
        <p className="mt-1 text-sm text-slate-500">
          Local-first dashboard. Everything you see is computed from{" "}
          <span className="mono text-xs">~/.claude</span> and{" "}
          <span className="mono text-xs">~/.codex</span> transcripts on this machine —
          your usage data stays here. Three surfaces reach out:
          AI fun facts call{" "}
          <span className="mono text-xs">claude -p</span> (Haiku) via your existing
          CLI auth; the Contributors modal queries{" "}
          <span className="mono text-xs">gh pr list</span> against the public
          dashboard repo; and the background pricing validator uses Haiku +
          WebSearch to keep the per-million-token rates current. None send
          your usage data.
        </p>
      </section>
    </div>
  );
}

// ─── pricing validator panel ────────────────────────────────────────────
//
// Shows when the local pricing table was last refreshed from
// claude.com/pricing + OpenAI's docs, and lets the user force a refresh.
// The validator runs `claude -p --allowed-tools WebSearch` in the
// background, so this button just kicks the API route and waits.
function PricingValidatorPanel() {
  const [info, setInfo] = useState<{
    last_validated_at?: string;
    as_of?: string | null;
    counts?: { claude: number; codex: number };
    present?: boolean;
  } | null>(null);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);

  useEffect(() => {
    fetch("/api/pricing/validate")
      .then((r) => r.json())
      .then((j) => setInfo(j))
      .catch(() => setInfo({ present: false }));
  }, []);

  function refresh() {
    setBusy(true);
    setMsg(null);
    fetch("/api/pricing/validate?force=1", { method: "POST" })
      .then((r) => r.json())
      .then((j) => {
        if (j?.ok) {
          setMsg(j.updated ? "Prices updated." : "Already current.");
          setInfo({
            present: true,
            last_validated_at: j.payload?.last_validated_at,
            as_of: j.payload?.as_of,
            counts: {
              claude: Object.keys(j.payload?.claude || {}).length,
              codex: Object.keys(j.payload?.codex || {}).length,
            },
          });
        } else {
          setMsg(j?.error || "Validation failed.");
        }
      })
      .catch((e) => setMsg(String(e)))
      .finally(() => setBusy(false));
  }

  const lastIso = info?.last_validated_at;
  const lastAgo = lastIso
    ? Math.max(0, Math.round((Date.now() - new Date(lastIso).getTime()) / 60000))
    : null;
  return (
    <section className="panel p-5">
      <div className="flex items-start gap-3">
        <RefreshCw size={20} className="mt-0.5 text-teal" />
        <div className="flex-1">
          <h2 className="text-lg font-semibold text-ink">Pricing accuracy</h2>
          <p className="mt-1 text-sm text-slate-500">
            On every launch the dashboard quietly asks Haiku to web-search
            current Anthropic + OpenAI pricing, and patches a local override
            file so cost numbers stay accurate even when the hardcoded
            defaults age. Dedupes to once per ~24h.
          </p>
          <div className="mt-4 flex flex-wrap items-center gap-3 text-xs">
            <button
              onClick={refresh}
              disabled={busy}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-line bg-white px-3 text-xs font-medium text-ink hover:border-teal disabled:cursor-wait disabled:opacity-60"
            >
              <RefreshCw size={14} className={busy ? "animate-spin" : ""} />
              {busy ? "Validating…" : "Refresh now"}
            </button>
            {info?.present && (
              <span className="text-slate-500">
                Last checked{" "}
                {lastAgo === 0 ? "just now" : `${lastAgo} min ago`}
                {info.as_of && (
                  <>
                    {" · "}
                    <span className="text-slate-400">claimed as-of {info.as_of}</span>
                  </>
                )}
                {info.counts && (
                  <>
                    {" · "}
                    <span className="text-slate-400">
                      {info.counts.claude} Claude / {info.counts.codex} Codex models
                    </span>
                  </>
                )}
              </span>
            )}
            {!info?.present && (
              <span className="text-slate-400">
                No validation run yet — &quot;Refresh now&quot; to seed.
              </span>
            )}
            {msg && (
              <span className={msg.includes("failed") || msg.includes("Error") ? "text-coral" : "text-teal"}>
                {msg}
              </span>
            )}
          </div>
        </div>
      </div>
    </section>
  );
}
