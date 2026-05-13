# Skill Analytics

Local dashboard for Codex skill and agent usage.

## Run

```bash
cd /Users/suketupatel/Desktop/project/ilit/tools/skill-analytics
npm run import
npm run dev
```

Open `http://127.0.0.1:4210`.

## Data

- SQLite database: `data/skill-analytics.sqlite`
- Historical inputs:
  - `~/.codex/sessions/**/*.jsonl`
  - `~/.codex/log/codex-tui.log`
  - `.codex/agents/*.toml`
  - `~/.codex/skills/**/SKILL.md`
  - `~/.codex/plugins/**/skills/**/SKILL.md`
- Future explicit events: `~/.codex/skill-analytics/events.jsonl`

## Explicit Skill Events

Use explicit events when a skill or agent can reliably announce its own lifecycle.

```bash
npm run skill-event -- start --skill update-migration-loop --notes "reviewing agent role files"
npm run skill-event -- success --skill update-migration-loop --notes "TOML validation passed"
npm run skill-event -- error --skill update-migration-loop --category validation --notes "missing developer_instructions"
npm run import
```

The dashboard separates explicit events from inferred mentions so historical data stays useful without overstating confidence.
