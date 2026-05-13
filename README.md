# Skill Analytics

Local Next.js dashboard for analyzing **Claude Code** and **Codex** usage on your own machine. SQLite-backed, no data leaves your laptop. Includes an LLM-as-judge that rates each skill / subagent invocation, with a codex tiebreaker for cases where the cheap judge and the user's behavior disagree.

http://127.0.0.1:4210/

## Quick start

```bash
git clone https://github.com/Suketu-Patel/skill-analytics.git
cd skill-analytics
npm install
npm run import    # ingests ~/.claude/projects/ + ~/.codex/sessions/ into local SQLite
npm run dev       # http://127.0.0.1:4210
```

Requires Node >= 18 and a C++ toolchain (`better-sqlite3` builds natively — on macOS run `xcode-select --install`).

## What it shows

- **Overview** — per-skill event counts, errors, sources (Claude vs Codex), with timeline + token-load charts.
- **Skill Health** — top skills by activity, hourly cadence, per-skill drill-down.
- **Errors** — failures grouped by category, with full evidence modals.
- **Timeline** — daily skill events / errors / token usage.
- **Claude vs Codex** — side-by-side totals, daily activity, token breakdown.
- **Pricing** — estimated spend per source.
- **Judgments** — LLM-as-judge ratings (`fit`, `value`, `corrections`) for each skill / subagent invocation. Drift watch panel surfaces where Haiku and Codex disagree.

All time-series charts support **click-and-drag horizontal selection** to filter every panel by date range.

## Optional features

- **Haiku judge** (`⚖ Run Haiku judge` in the Judgments tab) — needs the `claude` CLI on PATH. Sweeps unjudged invocations, ~$0.001 each. Anomalous ones (user corrected, tool errors) prioritized first.
- **Codex 2nd opinion** (`⚖⚖ Run Codex 2nd opinion`) — needs the `codex` CLI on PATH. Tiebreaks where Haiku and the user's next-turn behavior disagree.

Neither is required for the dashboard itself.

## Data

- SQLite DB at `data/skill-analytics.sqlite` (gitignored; never leaves your machine).
- Importer reads only your local `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` plus `~/.codex/log/codex-tui.log` and any `.codex/agents/*.toml`. Nothing is uploaded anywhere.
- Re-run `npm run import` whenever you want fresh data. It's idempotent.

## One-shot agent prompt

Paste this into Claude Code, Cursor, Codex CLI, or any agent that can run shell commands to bring up the dashboard on a fresh machine:

````
Set up the skill-analytics dashboard on this machine and start it.

Repo: https://github.com/Suketu-Patel/skill-analytics
Stack: Next.js 15 + React 19 + SQLite (better-sqlite3) + Tailwind
Port: 4210 (fixed in package.json)

Do these steps in order, then stop and report the final URL:

1. **Verify prerequisites.** Run `node --version` (need >= 18), `npm --version`, and `python3 --version`. better-sqlite3 needs native build tools — on macOS that's `xcode-select --install`; on Linux it's `build-essential`. If anything is missing, stop and tell me what to install.

2. **Clone the repo into ~/Desktop/skill-analytics/.** If the directory already exists, ask before overwriting. Use `git clone https://github.com/Suketu-Patel/skill-analytics.git ~/Desktop/skill-analytics`.

3. **Install dependencies.** `cd ~/Desktop/skill-analytics && npm install`. Expect ~30 seconds and a native-module compile for better-sqlite3.

4. **Personalize the data.** Run `npm run import` once. This scans the CLONING USER's local `~/.claude/projects/**/*.jsonl` and `~/.codex/sessions/**/*.jsonl` into a fresh SQLite DB at `data/skill-analytics.sqlite`. It writes data ONLY for this machine — none of the original author's data is in the repo. If both directories are empty (user has never run Claude Code or Codex), the dashboard will still come up but will show no skill events; that's expected.

5. **Start the dev server in the background** so I can keep using the shell: `npm run dev` with `run_in_background: true`. Wait until you see "Ready in" in the output, or curl `http://127.0.0.1:4210/` returns HTTP 200 (whichever comes first, max 30s).

6. **Verify it actually works.** Curl `http://127.0.0.1:4210/api/metrics/judgments` and confirm it returns `{"ok":true,...}`. If you get an error about better-sqlite3 ABI mismatch, run `npm rebuild better-sqlite3` and restart.

7. **Report:**
   - The URL: `http://127.0.0.1:4210/`
   - How many invocations were imported (from the `total_invocations` field of the metrics endpoint)
   - How to stop the server (Ctrl-C in the background task)
   - Two optional next steps for me to try:
     - The Judgments tab has a "Run Haiku judge" button — requires the `claude` CLI on PATH. ~$0.001 per invocation judged.
     - The same tab has "Run Codex 2nd opinion" — requires the `codex` CLI on PATH. Slower, used for tiebreaking.
   - Mention that all charts on the Overview and Comparison tabs support click-and-drag horizontal date selection.

Do not commit, push, or modify any files in the cloned repo. This is a read + run task only.
````

## Explicit skill events

If a skill or agent can reliably announce its own lifecycle, write explicit events to `~/.codex/skill-analytics/events.jsonl`:

```bash
npm run skill-event -- start   --skill my-skill --notes "starting"
npm run skill-event -- success --skill my-skill --notes "done"
npm run skill-event -- error   --skill my-skill --category validation --notes "..."
npm run import
```

The dashboard separates explicit events from inferred mentions so historical data stays useful without overstating confidence.

## License

MIT.
