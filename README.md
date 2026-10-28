# cron-sentinel

**English** | [简体中文](README.zh-CN.md)

Zero-config watchdog for GitHub Actions `schedule:` workflows. GitHub [documents](https://docs.github.com/en/actions/reference/workflows-and-actions/events-that-trigger-workflows#schedule) that scheduled runs "can be delayed during periods of high loads" and "some queued jobs may be dropped", and that public repos get schedules disabled after 60 days without activity. Nothing tells you when that happens. cron-sentinel does.

## What it does

- Reads every workflow on the default branch and parses its `on.schedule` crons (UTC, or the optional `timezone`). Supports `*`, lists, ranges, steps, `JAN`/`MON` names, `7` = Sunday, and the cron rule that day-of-month and day-of-week are OR-ed when both are set.
- Computes expected fire times over a lookback window and matches them against the runs API (`event=schedule`).
- **Missed**: no run for an expected time after `grace-minutes` (default 90, because GitHub routinely delays).
- **Severely delayed**: a run started more than `delay-threshold-minutes` late (default 30).
- **Failing**: the latest scheduled runs failed. The issue includes job, failed step, exit code, duration and a cleaned log tail.
- **Disabled / about to be disabled**: workflow state `disabled_inactivity`, and a warning when the default branch has had no commit for `inactivity-warn-days` (default 45).
- Opens **one issue per workflow** (deduplicated with a hidden marker), updates it on later runs, and closes it when the workflow recovers.
- **Optional, off by default**: `rerun-on-incident: true` re-runs the failed jobs of the latest failed *schedule-triggered* run, only if [githubstatus.com](https://www.githubstatus.com/api/v2/incidents.json) reports an Actions incident overlapping that run, and only while `run_attempt <= max-reruns`.

No LLM, no external service, no config file.

## Usage

```yaml
name: cron-sentinel
on:
  schedule:
    - cron: '7,37 * * * *'
  workflow_dispatch:
permissions:
  actions: read
  contents: read
  issues: write
jobs:
  watch:
    runs-on: ubuntu-latest
    steps:
      - uses: tupils1/cron-sentinel@v0
```

> ⚠️ The sentinel can be delayed or dropped like any scheduled workflow. For best results trigger it from somewhere else too: an external cron calling `workflow_dispatch`, or run it from a different repo with `repository: owner/name` and a token that can read that repo.

## Inputs

| Input | Default | Meaning |
|---|---|---|
| `github-token` | `github.token` | Needs `actions:read`, `contents:read`, `issues:write` (`actions:write` for re-runs) |
| `repository` | current repo | `owner/name` to watch |
| `lookback-minutes` | `1440` | Window to check |
| `delay-threshold-minutes` | `30` | Later than this = severe delay |
| `grace-minutes` | `90` | Wait this long before calling a slot missed |
| `ignore-workflows` | | Comma/newline list of file names or paths |
| `create-issues` | `true` | Open/update issues |
| `close-on-recovery` | `true` | Close the issue when healthy |
| `inactivity-warn-days` | `45` | Warn before the 60-day disable |
| `rerun-on-incident` | `false` | See above |
| `max-reruns` | `1` | Retry cap |
| `log-tail-lines` | `40` | Log lines in the issue |
| `dry-run` | `false` | Only log |

Outputs: `workflows-checked`, `problems`, `issues` (JSON), `reruns` (JSON).

## Limits

- Workflow files are read from the default branch at check time; if a cron changed inside the window, older slots use the new cron.
- Expected times before the workflow was created are skipped.
- Very frequent schedules (every 5 min) are often thinned by GitHub; raise `grace-minutes` or ignore them.

## Development

```
npm ci && npm run all   # typecheck, lint, tests with coverage, ncc build
```

`dist/` is committed; CI fails if it is stale. MIT licensed.
