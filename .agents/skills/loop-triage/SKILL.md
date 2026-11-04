---
name: loop-triage
description: >
  Triage open issues, PR feedback, CI history, plan paperwork and asset gaps.
  Produces a concise, actionable findings report suitable for a loop to consume.
  Writes structured output to the STATE.md state file.
user_invocable: true
---

# Loop Triage Skill

You are an expert engineering triage agent. Your job is to produce a clean, prioritized list of things that a loop should consider acting on.

## Inputs

Read-only. The commands below are the whole sweep; run only these, and run them
from the repository root.

### 1. GitHub — issues, PR feedback, CI history

```bash
gh issue list --state open --limit 50 --json number,title,labels,body,updatedAt
gh pr list --state all --limit 30 --json number,title,state,reviewDecision,reviews,comments
gh pr view <n> --comments          # only for a PR whose reviews/comments are non-empty
gh run list --status failure --limit 30 --json databaseId,displayTitle,headBranch,createdAt,conclusion
gh run view <id> --log-failed      # only for a failure that repeats twice or more
```

A red run on `develop`, or one from `ci.yml`, is signal. A red run whose
`headBranch` starts with `loop/` was already replaced by the retry loop; report it
only when the same failure appears twice or more.

### 2. Plan paperwork — the backlog the repo already wrote down

```bash
grep -rnE '^\s*- \[ \]' docs/plans/
grep -n 'Ngoài phạm vi' docs/plans/*.md
grep -n 'DEFERRED' docs/plans/*.md
```

- An unchecked `- [ ]` box is a manual verification (look at the UI, hold a phone).
  It is **human-only**, never `candidate`.
- An entry under `Ngoài phạm vi` or marked `DEFERRED` is a proposal only when its
  blocking reason has since disappeared: the asset arrived, the measurement now
  exists, the decision was made. Otherwise it stays where it is.
- Compare the status column of `docs/plans/README.md` against code reality. A stale
  status is a `DOC-*` slice, small and cheap.

### 3. Asset gap — what has no upstream source

```bash
python3 -c "import json;d=json.load(open('scripts/assets/assets.lock.json'));print('\n'.join(sorted(d['legacy'])))"
python3 -c "import json;d=json.load(open('scripts/assets/assets.lock.json'));print('\n'.join(sorted(d['targets'])))"
```

- A path in `legacy` has no `targets` entry: nothing can rebuild it, so the only
  fix is new art. That is a **human-only** row, because `AGENTS.md` forbids the
  agent from drawing.
- `scripts/assets/manifest.json` lists every sprite that does have a licensed
  source; `CREDITS.md` lists the attribution actually shipped. A legacy file with
  no `CREDITS.md` section is either a missing attribution or a gap — both are
  findings.

### 4. Repository reality

- Recent commits on `develop` (last 24–48h) and what they shipped.
- `STATE.md` — the rows that already exist. Never duplicate one; update it.
- `loop-run-log.md` — the last verdict and any slice that keeps returning to build.
- Code the plans talk about: `grep` it before claiming it is missing.

## Output Format

Produce a markdown report with these sections:

### 1. High-Priority Items (act on these)
- Clear, one-line description
- Why it matters (impact, risk, or customer pain)
- Suggested next action for the loop (e.g. "draft minimal fix in isolated worktree")
- Rough effort estimate

### 2. Watch Items (monitor, do not act yet)
- Same format but lower urgency

### 3. Noise / Ignore
- Brief list of things the loop looked at and decided were not worth action

### 4. State Updates
- Any facts the loop should remember for the next run (e.g. "PR #1234 now has 2 approvals")

## Rules

- Be brutally concise. The loop (and the human reading the state) will thank you.
- Only put something in "High-Priority" if a reasonable engineer would want to know about it today.
- When in doubt, put it in Watch or Noise rather than creating work.
- Never propose architectural overhauls during triage — this skill is for signal, not invention.
- Respect the project's existing skills and conventions (they will be provided in context).

## Evidence rules

- Every row cites its evidence inline: `path:line`, a PR number, a run id, or the
  exact command output that produced it. A row with no citation is a guess and does
  not enter `STATE.md`.
- `candidate` means the loop can finish the slice alone: code, tests, docs, or an
  asset that already has a licensed source. `blocked` means the missing piece is a
  human decision (UX, naming, palette), a measurement nobody has taken, or art.
- A deferred or out-of-scope entry becomes a proposal only when its blocker is
  gone. Quote the blocker in the row so the human can check.
- Never propose a slice that touches a `gate.yaml` denylist path: the pipeline
  discards it and the work is lost.