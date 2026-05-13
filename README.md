# AI Tab

Your AI coding tab — a local **Next.js dashboard** that tracks **cost, tokens, and sessions** across **Claude Code**, **Codex**, and **Cursor** by reading the JSONL/state files already on your machine. SQLite-backed, no data leaves your laptop.

The center stage is "Cost & Tokens": daily spend, model leaderboards, project breakdowns, hour-of-day patterns, burn alerts, and AI-generated reality-check facts. A shareable **Wrapped** tab pulls the highlights into a clean side-by-side card layout you can screenshot. Optional **Judgments** tab runs Haiku-as-judge over your invocations with a Codex tiebreaker.

![Cost & Tokens — the default landing tab](docs/screenshots/01-cost-overview.png)
*Cost & Tokens — daily spend, cache savings, model & project breakdowns, expensive sessions.*

![Wrapped — shareable card](docs/screenshots/02-wrapped.png)
*Wrapped — side-by-side Codex / Claude card with cache savings, worst burn day, top model, and a region-aware AI tidbit. Made to screenshot.*

![Claude vs Codex vs Cursor](docs/screenshots/03-comparison.png)
*Three-way comparison — totals scoreboard, daily activity, daily token usage, per-source model lists.*

http://127.0.0.1:4210/

---

## Quick start

```bash
git clone https://github.com/Suketu-Patel/skill-analytics.git
cd skill-analytics
npm install
npm run import    # ingests ~/.claude/projects/ + ~/.codex/sessions/ into local SQLite
npm run dev       # http://127.0.0.1:4210
```

Requires Node >= 18 and a C++ toolchain (`better-sqlite3` builds natively — on macOS run `xcode-select --install`).

---

## What you'll see

### Cost & Tokens (default landing tab)
The new center stage. Surfaces every dimension of spend & token usage from your JSONLs:

- **Headline tiles** — total spend, last 7d / 30d, sessions, cache hit rate, total tokens (split across fresh input / cached / output / reasoning)
- **✨ Reality Check** — AI-generated 1-2 line fun facts with American comparisons (Costco chickens, NYC subway swipes, Pop-Tarts, etc.). Cached per data hash so refreshes are free. Click **↻ Regenerate** to pay Haiku a tenth of a cent for a fresh take.
- **Daily Spend** — stacked area chart: fresh input / cached input / output costs over time
- **Claude vs Codex** pie + **Cache Effectiveness** panel + **Burn Alerts** (days where spend exceeded 3× your median)
- **Spend by Model** and **Spend by Project (cwd)** leaderboards
- **Hour of Day** + **Day of Week** charts — when do you actually use these tools?
- **Most Expensive Sessions** table — single sessions ranked by spend

### Other tabs
- **Claude vs Codex** — side-by-side totals + daily charts
- **Timeline** — daily skill events / errors / token usage
- **Judgments** — LLM-as-judge (Haiku) ratings, with codex 2nd-opinion tiebreaker
- **Skill Overview / Skill Health / Errors / Pricing** — the original skill-centric views (kept for reference)

All time-series charts support **click-and-drag horizontal date selection** to filter every panel by date range.

---

## Auto-sync (new in v2)

The dashboard imports new transcripts automatically every **30 minutes** while the browser tab is open. The header shows a `Synced X ago` chip that you can click to disable. The auto-sync skips when:
- A manual Import is already in flight
- The browser tab is hidden (saves CPU while in the background)

---

## In-app updates (new in v2)

A **⤓ Update** button in the header runs `git pull --ff-only` + `npm install` (if deps changed) without leaving the dashboard. It refuses to pull on a dirty working tree to avoid clobbering your changes. Useful when new versions ship — no need to drop back to the terminal for updates.

---

## Optional features

These need additional CLIs on PATH but the dashboard works without them:

- **Haiku judge** (`⚖ Run Haiku judge` in the Judgments tab) — needs the `claude` CLI. Sweeps unjudged invocations, ~$0.001 each.
- **Codex 2nd opinion** (`⚖⚖ Run Codex 2nd opinion`) — needs the `codex` CLI. Tiebreaks where Haiku and the user's next-turn behavior disagree.
- **Reality Check (fun facts)** — needs the `claude` CLI. Calls Haiku once per unique data snapshot.

---

## Data

- SQLite DB at `data/skill-analytics.sqlite` (gitignored; never leaves your machine).
- Importer reads only your local `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` plus `~/.codex/log/codex-tui.log` and any `.codex/agents/*.toml`. Nothing is uploaded anywhere.
- Re-run `npm run import` anytime to refresh. Idempotent — re-imports are safe.

---

## One-shot setup prompt (paste into any agent)

For a **fresh install** on a new machine. Paste into Claude Code, Cursor, Codex CLI, or any agent that can run shell:

````
Set up the skill-analytics dashboard on this machine and start it.

Repo: https://github.com/Suketu-Patel/skill-analytics
Stack: Next.js 15 + React 19 + SQLite (better-sqlite3) + Tailwind
Port: 4210 (fixed in package.json)

Do these steps in order, then stop and report the final URL:

1. **Verify prerequisites.** Run `node --version` (need >= 18), `npm --version`, and `python3 --version`. better-sqlite3 needs native build tools — on macOS that's `xcode-select --install`; on Linux it's `build-essential`. If anything is missing, stop and tell me what to install.

2. **Clone the repo into ~/Desktop/skill-analytics/.** If the directory already exists, ask before overwriting. Use `git clone https://github.com/Suketu-Patel/skill-analytics.git ~/Desktop/skill-analytics`.

3. **Install dependencies.** `cd ~/Desktop/skill-analytics && npm install`. Expect ~30 seconds and a native-module compile for better-sqlite3.

4. **Personalize the data.** Run `npm run import` once. This scans the CLONING USER's local `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` into a fresh SQLite DB at `data/skill-analytics.sqlite`. It writes data ONLY for this machine — none of the original author's data is in the repo.

5. **Start the dev server in the background** so I can keep using the shell: `npm run dev` with `run_in_background: true`. Wait until you see "Ready in" in the output, or curl `http://127.0.0.1:4210/` returns HTTP 200 (whichever comes first, max 30s).

6. **Verify it works.** Curl `http://127.0.0.1:4210/api/metrics/cost-overview` and confirm it returns `{"ok":true,...}` with a `headline` block.

7. **Report:**
   - The URL: `http://127.0.0.1:4210/`
   - Total invocations imported, total spend, sessions (pull from the headline object)
   - How to stop the server (Ctrl-C in the background task)
   - Mention: auto-sync runs every 30 min; click the ⤓ Update button to pull new versions of the dashboard.
   - Optional: install `claude` CLI for the Reality Check fun facts + Haiku judge, and `codex` CLI for the codex tiebreaker.

Do not commit, push, or modify any files in the cloned repo. This is a read + run task only.
````

---

## Upgrade prompt for v1 users (paste into any agent)

If you already cloned an earlier version of this dashboard, paste this into Claude Code, Cursor, or Codex to update in place:

````
Update my existing skill-analytics install to the latest version.

Repo: https://github.com/Suketu-Patel/skill-analytics
The clone almost certainly lives at ~/Desktop/skill-analytics — confirm with the user first if it's elsewhere.

Do these steps in order, then stop and report:

1. **cd into the existing clone.** If `~/Desktop/skill-analytics` doesn't exist, fall back to asking where it is.

2. **Check the working tree is clean.** Run `git status --porcelain`. If anything is dirty, stop and tell me — I'll decide whether to stash or commit before you proceed. Do not auto-stash.

3. **Stop the existing dev server.** Run `pkill -f "next dev.*4210"` (macOS/Linux) or its Windows equivalent. Don't error out if nothing was running — that's fine.

4. **Pull latest.** `git pull --ff-only origin main`. If git complains about divergence, stop and tell me — don't merge or rebase from a script.

5. **Reinstall dependencies** in case new packages were added: `npm install --no-audit --no-fund`. If `better-sqlite3` needs to rebuild for a new Node ABI, run `npm rebuild better-sqlite3`.

6. **Re-run the importer** to apply any schema migrations and pick up new transcripts since the last sync: `npm run import`.

7. **Restart the dev server in the background**: `npm run dev` with `run_in_background: true`. Wait for HTTP 200 at `http://127.0.0.1:4210/`.

8. **Verify the new features are live.** Curl `http://127.0.0.1:4210/api/metrics/cost-overview` — it should return `{"ok":true,"headline":{...}}`. If that endpoint 404s, the pull didn't take or the server didn't restart cleanly.

9. **Report what's new since the version they had:**
   - Cost & Tokens is now the default landing tab (was Skill Overview)
   - ✨ Reality Check panel with AI-generated 1-2 line sarcastic fun facts (needs `claude` CLI for fresh ones; cached otherwise)
   - Auto-sync runs every 30 min while the browser tab is open
   - ⤓ Update button in the header — pulls new versions of the dashboard without leaving the page
   - Click-and-drag horizontal date selection on all time-series charts
   - Burn Alerts panel — surfaces days where spend exceeded 3× the user's median
   - Spend-by-project (cwd) leaderboard
   - Hour-of-day and Day-of-week charts

Do not delete the existing SQLite database — schema migrations are idempotent and existing judgments + import history are preserved.
````

---

## Explicit skill events

If a skill or agent can reliably announce its own lifecycle, write explicit events to `~/.codex/skill-analytics/events.jsonl`:

```bash
npm run skill-event -- start   --skill my-skill --notes "starting"
npm run skill-event -- success --skill my-skill --notes "done"
npm run skill-event -- error   --skill my-skill --category validation --notes "..."
npm run import
```

The dashboard separates explicit events from inferred mentions so historical data stays useful without overstating confidence.

---

## License

MIT.
