# Loop Configuration — Chien Quoc (opencode)

## The pipeline

Six steps, one human decision between each pair. No step starts the next one by itself.

| # | Step | Who | Command | Writes |
|---|------|-----|---------|--------|
| 1 | Propose | `loop-triage` | `/loop-triage` | `STATE.md` only |
| 2 | **Approve** | **you** | `/loop-pick <ID>` | `STATE.md`, `loop-run-log.md` |
| 3 | Plan | `planner` | `/loop-plan <ID>` | `docs/plans/` only |
| 4 | Build | `implementer` | `/loop-build <ID>` | source + tests |
| 5 | Verify | `verifier` | `/loop-verify <ID>` | `STATE.md`, `loop-run-log.md` |
| 6 | Ship | `shipper` | `/loop-ship <ID>` | branch, commit, PR (against `main`) |

Step 2 is the only step that is a decision rather than a task. Everything before it produces
candidates; everything after it is committed to one slice.

## Run it in the TUI

```bash
opencode
```

Then, in order:

```
/loop-triage          # produces the ranked table, then stops
/loop-pick ALERT-01   # you choose; the rest are marked "not this run"
/loop-plan ALERT-01   # writes docs/plans/12-....md, then stops
/loop-build ALERT-01  # code + tests, then stops
/loop-verify ALERT-01 # independent run, APPROVE or REJECT
/loop-ship ALERT-01   # branch, commit, push, PR — asks before each
```

## Run it headless

The same six steps as one-shot runs. `--agent` selects the agent; the command names are
TUI-only, so headless runs pass the instruction as text.

```bash
opencode run --agent loop-triage "Run daily triage"
opencode run --agent loop-triage "Run daily triage" --auto    # no approval prompts
```

`--auto` approves every tool call that is not explicitly denied. Use it only for step 1,
which cannot write source code. Steps 4-6 must stay interactive so you see every edit.

## Status vocabulary in STATE.md

A slice moves through these values in its `Next action` column. Each command refuses to run
if the row is not in the state it expects, which is what stops a skipped step.

| Status | Set by | Means |
|--------|--------|-------|
| `candidate` | step 1 | proposed, not chosen |
| `APPROVED <date> — awaiting plan` | step 2 | you picked it |
| `PLANNED <date> — awaiting build` | step 3 | plan file exists |
| `BUILT <date> — awaiting verify` | step 4 | tests written, not independent |
| `VERIFIED <date> — awaiting ship` | step 5 | verifier returned APPROVE |
| `SHIPPED <date> — <PR url>` | step 6 | PR open, not merged |

## Gates that hold at every step

- `gate.yaml` denylist: auth, sessions, persistence, `packages/shared/**`, loop tooling.
  A slice touching one of those needs a human edit, not an agent.
- `maxFiles: 12` — a slice that needs more is split before anyone codes it.
- Protocol changes (`NetworkMessage`, `@type()` schema fields) need a human decision first.
- Max 3 build attempts per slice, then it goes back to `STATE.md`. The verifier is a fresh
  run every time; a verifier in the implementer's session is theater.
- No merge. `shipper` opens the PR and stops. `autoMergeAllowlist` stays empty.

## Test commands the verifier must run

```bash
pnpm --filter @chien-quoc/client test
pnpm --filter @chien-quoc/server test
pnpm build
```

## Troubleshooting

Skills live in `.opencode/skills/`. Check discovery before blaming a prompt:

```bash
opencode debug skill | grep -oE '"name": "loop-[a-z]+"'
opencode debug agent planner
opencode debug config | grep -c '"loop-'
```

The project pins `model: opencode-go/beam-free` in `opencode.json`, because the global
config names a model the provider has deprecated.

## Budget

- Max 1 promoted slice per run.
- Prune `loop-run-log.md` entries older than 30 days.
- At 80% of the daily cap in `loop-budget.md`, drop back to step 1 only.

## Links

- Pattern: https://github.com/cobusgreyling/loop-engineering/blob/main/patterns/daily-triage.md
- Checklist: https://github.com/cobusgreyling/loop-engineering/blob/main/docs/loop-design-checklist.md
- Project plans: `docs/plans/README.md`
