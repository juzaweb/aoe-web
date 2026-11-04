#!/usr/bin/env bash
# gate.yaml policy check for one slice's working tree.
#
# One definition, two callers:
#   - `.github/workflows/loop.yml` "Check gate policy"  (every step)
#   - `scripts/retry-gates.sh`                          (full, inside the retry loop)
#
# Why a script: `full` retries build/verify when a gate fails, and a gate buried
# in a YAML step cannot be re-entered from the shell loop that does the retrying.
# A second copy of this logic is how the two paths would start disagreeing about
# what is denylisted.
#
# Usage: BASE=<sha> scripts/gate-check.sh
# Exit: 0 = allowed, 1 = refused, 2 = usage error.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${BASE:?usage: BASE=<sha> scripts/gate-check.sh}"

# `git status --porcelain` mangles two cases that matter here: a path with a
# space becomes "sp ace.ts", and a rename emits "old -> new" so the old name
# leaks in. diff --name-only plus ls-files gives the new name only, one per NUL,
# and core.quotePath=false keeps it literal.
#
# The diff base is the commit recorded at checkout, not HEAD. An agent that
# commits would otherwise move HEAD forward and hide its own changes from this
# gate entirely.
list_paths() {
  git -c core.quotePath=false diff --name-only -z "$BASE"
  git -c core.quotePath=false ls-files --others --exclude-standard -z
}

changed=$(list_paths | tr '\0' '\n' | grep -v '^$' | sort -u || true)
if [ -z "$changed" ]; then
  echo "::notice::No file changes; nothing to gate."
  exit 0
fi

echo "Paths changed:"; echo "$changed"

# GITHUB_TOKEN can never push a workflow file: GitHub refuses the ref outright,
# whatever `permissions:` the job declares. Failing here names the real cause
# instead of surfacing a push rejection ten minutes later.
if printf '%s\n' "$changed" | grep -q '^\.github/'; then
  echo "::error::The slice touches .github/**. GITHUB_TOKEN cannot push workflow files; this needs a human or a LOOP_PAT secret."
  exit 1
fi

# loop-gate wants one comma-separated argument. Join line by line: `printf '%s\n'
# $changed` would word-split on the space in a path like "sp ace.ts" and hand
# gate a truncated name.
csv=$(printf '%s' "$changed" | paste -sd, -)
echo "csv=[$csv]"

# `merge`, not `auto-merge`: auto-merge also requires the path to be on
# autoMergeAllowlist, which is intentionally empty, so every path would escalate.
# `merge` enforces the denylist and max-files.
set +e
npx --yes @cobusgreyling/loop gate check --action merge --paths "$csv"
code=$?
set -e

if [ "$code" -eq 0 ]; then
  echo "::notice::gate check allowed this slice."
  exit 0
fi

echo "::error::gate check exited $code — this slice needs a denylisted path."
exit 1
