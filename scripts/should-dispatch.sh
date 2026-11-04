#!/usr/bin/env bash
# Is a loop run already in flight, or is its work already waiting for a human?
#
# Why this exists: `concurrency: group: loop` in loop.yml serialises runs, it
# does not skip them. A second dispatch therefore *queues* — behind a `full` run
# that may spend half an hour on agents — and then executes on a `develop` the
# first run has already moved. That is how six runs piled up in two hours: each
# scheduler kept dispatching into a queue it could not see.
#
# The dispatchers call this before `gh workflow run`, inside a shared concurrency
# group so the check-then-dispatch pair is serialised. Exit 0 means "go ahead".
#
# Usage: scripts/should-dispatch.sh <full|triage>
# Exit: 0 = dispatch, 1 = skip.
set -euo pipefail

cd "$(dirname "$0")/.."

what="${1:?usage: should-dispatch.sh <full|triage>}"

# `--status` accepts one value at a time, so in_progress and queued are two
# calls. A run that is `waiting` is also busy: that is what concurrency makes a
# second dispatch.
#
# The `grep -E '^[0-9]+$'` is not decoration. Anything non-numeric in this list
# — an error message from `gh`, a stray `0` — would read as "a run is in flight"
# and the loop would silently stop forever. A permanent quiet stop is the worst
# failure mode this file has, so a malformed line is dropped instead.
busy_ids=$(
  {
    gh run list --workflow loop.yml --status in_progress --json databaseId --jq '.[].databaseId' || true
    gh run list --workflow loop.yml --status queued --json databaseId --jq '.[].databaseId' || true
    gh run list --workflow loop.yml --status waiting --json databaseId --jq '.[].databaseId' || true
  } | grep -E '^[0-9]+$' | sort -u || true
)

if [ -n "$busy_ids" ]; then
  echo "::notice::A loop run is already in flight ($(printf '%s' "$busy_ids" | tr '\n' ' ')); skipping this slot."
  exit 1
fi

# An unmerged state PR means the previous step already wrote its change and is
# waiting for a human to merge it. Two things go wrong if a slot runs anyway:
#
#   - `triage` rewrites STATE.md from develop, where the proposed rows do not
#     exist yet, so the new PR conflicts with or duplicates the pending one.
#   - `full` reads develop for a `candidate` row, finds none (the candidates are
#     only in the PR), and dies in `Resolve slice` after paying for the whole
#     checkout and install.
#
# So the check applies to every step, not only to triage.
open_state=$(
  gh pr list --state open --json headRefName \
    --jq '[.[] | select(.headRefName | startswith("loop/state-"))] | length' \
    | grep -E '^[0-9]+$' || echo 0
)
if [ "${open_state:-0}" -gt 0 ]; then
  echo "::notice::${open_state} unmerged state PR(s) already propose the next batch; skipping ${what}."
  exit 1
fi

echo "::notice::No loop run in flight; dispatching ${what}."
exit 0
