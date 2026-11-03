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
/loop-pick ALERT-01   # you choose; the other candidates are left alone
/loop-plan ALERT-01   # writes docs/plans/12-....md, then stops
/loop-build ALERT-01  # code + tests, then stops
/loop-verify ALERT-01 # independent run, PASS or FAIL
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

`.github/workflows/loop.yml`, started by hand from the Actions tab (`workflow_dispatch`) or
dispatched by `.github/workflows/loop-schedule.yml`. Never on push: a push-triggered agent
would react to its own commits.

| Input | Meaning |
|-------|---------|
| `step` | `triage` / `pick` / `plan` / `build` / `verify` / `ship` / `full` |
| `slice` | the slice ID; required for every step except `triage` |
| `model` | optional `provider/model` override |
| `merge` | merge the PR into `develop` once it is opened. **On by default** — the pipeline exists so no PR waits for a person |

Required repository secret: `OPENCODE_API_KEY`. Optional `OPENCODE_PROVIDER` (defaults to
`opencode-go`, and must match the `provider/` prefix in `opencode.json`).

### The five-hour schedule

`.github/workflows/loop-schedule.yml` runs on `cron: '0 */5 * * *'` (UTC: 00, 05, 10, 15, 20 →
07:00, 12:00, 17:00, 22:00, 03:00 in Asia/Ho_Chi_Minh) and dispatches `loop.yml`. It is a
separate file on purpose: a schedule event carries no inputs, so `loop.yml` keeps real
`workflow_dispatch` inputs and stays identical whether a person or the cron starts it.

Each slot does exactly one thing, decided by `STATE.md`:

| Queue state | Dispatched step | Why |
|-------------|-----------------|-----|
| has a `candidate` row | `full` | build, verify, browser-check and merge the first candidate |
| no `candidate` row | `triage` | propose the next batch; nothing else to build |

That is what stops the schedule from idling forever once every candidate shipped — triage
refills the queue, and the next slot builds. Override it by dispatching the scheduler by hand
with `step = full` or `step = triage`.

Turn it off with `gh workflow disable loop-schedule`. GitHub treats cron as best-effort: a busy
queue can delay a slot, and a repository without pushes for 60 days has its schedules paused by
GitHub itself.

### What each step does to the repository

Two different PRs, and only one of them needs you:

| Steps | Written | Delivered as |
|-------|---------|--------------|
| `triage`, `plan`, `verify` | `STATE.md`, `loop-run-log.md`, `docs/plans/**` | **a PR you review and merge** |
| `ship`, `full` | source, tests, docs, state | a PR that merges itself |

### Approving a feature

For `triage` the `STATE.md` diff **is** the deliverable, so the PR is the proposal:

1. Run `step = triage`, `slice` blank.
2. The run opens a PR titled `loop(triage): state update`.
3. In that PR, edit `STATE.md` and change the `Next action` cell of the feature you
   want from `candidate` to `APPROVED <date> — awaiting plan`. Anything you leave as
   `candidate` is not approved.
4. Merge the PR. That merge is the approval — nothing else records it.
5. Run `step = plan` with `slice = <ID>`.

You can also edit `STATE.md` on `develop` directly, or use `/loop-pick <ID>` in the TUI.
All three produce the same thing: one row reading `APPROVED`.

### The four hard stops

1. **Gate before anything is committed.** `gate check --action merge` must exit 0. If it does
   not, the slice is **thrown away** — the working tree is reverted and the run fails. It does
   not become a PR waiting for a human.
2. **Verifier before ship**, in `full` mode. The run aborts unless `loop-run-log.md` gained a
   `PASS` line.
3. **Tests before merge.** In `ship`/`full`, the `Run tests` step runs build + both suites on
   the exact tree that is about to be committed. Red suite, no PR, no merge. After the PR is
   opened the workflow also waits for the `Tests` check that `ci.yml` records against it, and
   merges only when that check is green.
4. **Browser check before merge.** Unit tests cannot see a rendered page, so the same tree is
   served (`:2567` API, `:5173` client) and an agent drives it in real headless Chrome. The run
   stops unless the agent ends with `BROWSER_VERDICT: PASS`.

`APPROVE`/`APPROVED` belongs to you alone. The verifier's verdict is `PASS` or `FAIL`, so the
word `approve` in this repo always means a human decision and never a machine one.

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
| `VERIFIED <date> — awaiting ship` | step 5 | verifier returned PASS |
| `SHIPPED <date> — <PR url>` | workflow, after the merge | merged into `develop` |

`SHIPPED` is written by `scripts/mark-shipped.sh` in the `Mark the slice shipped` step, not by
an agent: the row has to record the merge whether or not a model feels like summarising. That
script rewrites exactly one cell and refuses if the table is not the shape it expects, so a
malformed row is a visible failure instead of a silent rewrite.

`not this run` is a human annotation. No loop step writes it: `pick` changes only the row it was
given, so approving `ALERT-01` leaves `SAVE-01` a `candidate` and the next run picks it. The
earlier prompt told the agent to blank the rest of the table, which emptied the queue after one
run — that is why the rule is now stated the other way around.

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

## CI on `develop`

`.github/workflows/ci.yml` is the test gate for the integration branch. It runs on every push
to `develop`, every PR aimed at `develop`, and on demand. One job, `Tests`:

```
pnpm install --frozen-lockfile
bash scripts/run-tests.sh
```

`scripts/run-tests.sh` is the single definition of the gate — shared build → prisma generate →
tsc + vite build → client tests → server tests. `ci.yml` and `loop.yml` both call it, so the
loop's "pass" and GitHub's `Tests` check can never mean different things.

`prisma generate` is not optional: `@prisma/client` is a build artifact, so a fresh runner
cannot resolve it without that step. `dist/` is gitignored, so the builds leave the tree that
`git add -A` commits untouched.

Every failure mode is a red run, never a skipped step: a broken build, a failing test, or a
missing `pnpm-lock.yaml` entry all stop the job.

To make the check mandatory for humans as well, protect `develop` once:

```bash
gh api -X PUT "repos/{owner}/{repo}/branches/develop/protection" \
  -F required_status_checks[strict]=true \
  -F required_status_checks[contexts][]=Tests \
  -F enforce_admins=false \
  -F required_pull_request_reviews=null \
  -F restrictions=null
```

The loop still works with that protection on, because it waits for `Tests` to go green before
calling `gh pr merge`. Without `LOOP_PAT` the loop's PRs do not trigger `pull_request` at all
(GitHub suppresses workflow runs caused by `GITHUB_TOKEN`), so the wait step falls back to the
in-job test run and says so in the log.

## Browser check

`browser-verifier` is the only agent that looks at the running game. It has no edit permission
and no shell beyond `curl` against the local API, so it can report a broken page but never
patch one. Its instructions come from `.agents/skills/browser-testing-with-devtools/SKILL.md`,
and the browser comes from the `chrome-devtools` MCP server registered in `opencode.json`
(`chrome-devtools-mcp`, headless, isolated profile, wiped on exit).

```bash
# what the loop does before the agent runs
pnpm --filter @chien-quoc/server run start                                  # :2567
pnpm --filter @chien-quoc/client exec vite --host 127.0.0.1 --port 5173 --strictPort
```

The report is one line per acceptance criterion, then console findings, then network findings,
and a last line of `BROWSER_VERDICT: PASS` or `BROWSER_VERDICT: FAIL`. Anything else counts as a
failure. Headless Chrome has no GPU, so WebGL and Phaser fallback warnings are Nit environment
artifacts rather than blockers.

Run it by hand when you want the same eyes outside CI:

```bash
opencode run --agent browser-verifier --auto "Browser check for slice ALERT-01"
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
