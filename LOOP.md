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

## Run it in GitHub Actions

`.github/workflows/loop.yml`, started by hand from the Actions tab (`workflow_dispatch`).
Nothing runs on a schedule or on push.

| Input | Meaning |
|-------|---------|
| `step` | `triage` / `pick` / `plan` / `build` / `verify` / `ship` / `full` |
| `slice` | the slice ID; required for every step except `triage` |
| `model` | optional `provider/model` override |
| `merge` | merge the PR into `develop` once it is opened. **On by default** — the pipeline exists so no PR waits for a person |

Required repository secret: `OPENCODE_API_KEY`. Optional `OPENCODE_PROVIDER` (defaults to
`opencode-go`, and must match the `provider/` prefix in `opencode.json`).

### What each step does to the repository

Two different commits, on purpose:

| Steps | Written | Where it goes |
|-------|---------|---------------|
| `triage`, `plan`, `verify` | `STATE.md`, `loop-run-log.md`, `docs/plans/**` | pushed **straight to `develop`** by the *Persist loop state* step |
| `ship`, `full` | source, tests, docs | feature branch → PR → merged into `develop` |

The first row matters because the runner is disposable. Without that push, a triage run would
update `STATE.md` and lose it, so the next run would read the same stale state and re-propose
the same slice forever.

### The two hard stops

1. **Gate at build time.** `gate check --action merge` must exit 0. If it does not, the slice is
   **thrown away** — the working tree is reverted and the run fails. It does not become a PR
   waiting for a human, because the whole point is that no such PR exists.
2. **Verifier before ship**, in `full` mode. The run aborts unless `loop-run-log.md` gained an
   `APPROVE` line.

`auto-merge` is deliberately *not* used: it also requires the path to be on
`autoMergeAllowlist`, so every path would escalate.

The workflow creates `develop` on its first run if it is missing.



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

Skills live in `.agents/skills/`, one of the project-local directories opencode discovers
(alongside `.opencode/skills/` and `.claude/skills/`). `.agents/skills/` also holds
`local-assets-ai`, so the loop skills live next to the project's own skills rather than in a
directory created only for them. Check discovery before blaming a prompt:

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
