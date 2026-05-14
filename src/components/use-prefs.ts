"use client";

import { useEffect, useState } from "react";

// Client-side mirror of the server-side /api/prefs store.
//
// Shape matches DEFAULT_PREFS in src/lib/prefs.js. We hydrate from the
// API on mount; subsequent changes write through with a fire-and-forget
// POST and broadcast a "dashboard:prefs" CustomEvent so any other
// component listening can re-read without prop-drilling.
//
// Theme has a special carve-out: it's mirrored into localStorage too
// (key: "dashboard.theme") so the pre-paint THEME_INIT inline script in
// layout.tsx can read it synchronously before React hydrates. The
// pre-paint mirror is a read-cache only — the DB is the source of truth.

export type Prefs = {
  hiddenTabs: string[];
  hiddenSources: string[]; // SourceId[] — kept as string[] to avoid a circular import
  syncIntervalMinutes: number;
  region: string;
  anonymize: boolean;
  paletteRecency: string[];
  theme: "light" | "dark" | "system";
};

export const DEFAULT_PREFS: Prefs = {
  hiddenTabs: [],
  hiddenSources: [],
  syncIntervalMinutes: 30,
  region: "auto",
  anonymize: false,
  paletteRecency: [],
  // Default to light so a fresh install doesn't render dark just
  // because the user's OS is dark. Server-side default in prefs.js
  // matches.
  theme: "light",
};

// Module-level in-memory cache so the second mount (HMR, route change)
// doesn't refetch. Hydrated lazily.
let cache: Prefs = { ...DEFAULT_PREFS };
let loaded = false;
const subscribers = new Set<() => void>();

// Legacy per-key CustomEvents declared up here so loadOnce can replay
// them on first hydration.
const LEGACY_EVENTS: Partial<Record<keyof Prefs, string>> = {
  hiddenTabs: "dashboard:hidden-tabs",
  hiddenSources: "dashboard:hidden-sources",
  region: "dashboard:region",
  syncIntervalMinutes: "dashboard:sync-interval",
  theme: "dashboard:theme",
  anonymize: "dashboard:anonymize",
};

function notify() {
  for (const fn of subscribers) fn();
  if (typeof window !== "undefined") {
    window.dispatchEvent(new CustomEvent("dashboard:prefs", { detail: cache }));
  }
}

async function loadOnce() {
  if (loaded || typeof window === "undefined") return;
  try {
    const r = await fetch("/api/prefs", { cache: "no-store" });
    const j = await r.json();
    if (j?.ok && j.prefs) {
      cache = { ...DEFAULT_PREFS, ...j.prefs };
    }
  } catch { /* network failure → defaults */ }
  loaded = true;
  notify();
  // Replay legacy per-key events so listeners that haven't migrated to
  // the unified `dashboard:prefs` event still pick up the loaded state.
  for (const [key, legacyName] of Object.entries(LEGACY_EVENTS)) {
    if (!legacyName) continue;
    window.dispatchEvent(
      new CustomEvent(legacyName, { detail: (cache as Record<string, unknown>)[key] })
    );
  }
  // Theme mirror is critical for matching the pre-paint script's choice
  // if the user logged in from another device and synced prefs.
  if (cache.theme && typeof window !== "undefined") {
    try { window.localStorage.setItem("dashboard.theme", cache.theme); } catch { /* */ }
  }
}

/**
 * Patch one or more prefs. Writes through to the API and updates the
 * in-memory cache + notifies subscribers. Fire-and-forget on the API
 * call — UI does not block on the round trip.
 */
export function setPref<K extends keyof Prefs>(key: K, value: Prefs[K]) {
  cache = { ...cache, [key]: value };
  // Theme is also mirrored into localStorage for FOUC prevention — the
  // pre-paint inline script in layout.tsx reads localStorage *before*
  // React hydrates, and SQLite is only reachable via /api/prefs.
  if (key === "theme" && typeof window !== "undefined") {
    try { window.localStorage.setItem("dashboard.theme", String(value)); }
    catch { /* private browsing — fine */ }
  }
  notify();
  if (typeof window !== "undefined") {
    const legacy = LEGACY_EVENTS[key];
    if (legacy) {
      window.dispatchEvent(new CustomEvent(legacy, { detail: value }));
    }
  }
  fetch("/api/prefs", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ [key]: value }),
  }).catch(() => { /* offline → next mount will resync */ });
}

/**
 * Hook that exposes the current prefs + a setter. Auto-subscribes to
 * cross-component changes via the "dashboard:prefs" event.
 */
export function usePrefs(): { prefs: Prefs; setPref: typeof setPref; loaded: boolean } {
  const [, force] = useState(0);
  const [hasLoaded, setHasLoaded] = useState(loaded);
  useEffect(() => {
    loadOnce().then(() => setHasLoaded(true));
    const fn = () => {
      force((n) => n + 1);
      setHasLoaded(loaded);
    };
    subscribers.add(fn);
    return () => { subscribers.delete(fn); };
  }, []);
  return { prefs: cache, setPref, loaded: hasLoaded };
}

/** Synchronous read — for code paths that need a value right now (e.g.
 *  fun-facts URL building during a render). Returns defaults if the
 *  prefs haven't loaded yet, so SSR doesn't crash. */
export function readPrefs(): Prefs {
  return cache;
}
