#!/usr/bin/env bash
# Preflight, dispatch, and confirm the dispatch registered — as one unit.
#
# Why this is a script and not two YAML steps: the preflight in
# `should-dispatch.sh` is only correct if the *previous* dispatcher can see the
# run it just created. `gh workflow run` returns before the run appears in
# `gh run list`, leaving a window where a second dispatcher sees "nothing in
# flight" and dispatches into the queue this whole guard exists to avoid. Both
# schedulers share `group: loop-dispatch`, so they never overlap *inside* this
# script — but they can still overlap across the window, and waiting here closes
# it.
#
# Usage: scripts/dispatch-loop.sh <step> [chain]
# Exit: 0 = dispatched (or the slot was skipped), 1 = a real failure.
set -euo pipefail

cd "$(dirname "$0")/.."

step="${1:?usage: dispatch-loop.sh <step> [chain]}"
chain="${2:-0}"

if ! bash scripts/should-dispatch.sh "$step"; then
  echo "::notice::Skipping this slot; a loop run or an unmerged proposal already covers it."
  exit 0
fi

gh workflow run loop.yml \
  --ref develop \
  -f step="$step" \
  -f merge=true \
  -f "chain=$chain"

# Confirm the run exists before this job releases the dispatch lock. Without
# this the next scheduler starts its preflight immediately, sees nothing, and
# dispatches a second run into the same `group: loop` queue.
for _ in $(seq 1 12); do
  # Count LINES, not the numbers: `--jq 'length'` already returns a count, but
  # three calls can each print one, and summing the values would sum counts while
  # `--jq '.[].databaseId'` would sum ids. Piping through grep -c keeps this
  # correct whichever shape the call returns.
  inflight=$(
    {
      gh run list --workflow loop.yml --status in_progress --json databaseId --jq '.[].databaseId' || true
      gh run list --workflow loop.yml --status queued --json databaseId --jq '.[].databaseId' || true
      gh run list --workflow loop.yml --status waiting --json databaseId --jq '.[].databaseId' || true
    } | grep -cE '^[0-9]+$' || true
  )
  if [ "${inflight:-0}" -gt 0 ]; then
    echo "::notice::Dispatched loop.yml with step=${step}; ${inflight} run(s) now in flight."
    exit 0
  fi
  sleep 5
done

# The dispatch was accepted (gh exited 0) but never showed up. That is worth a
# warning, not a failure: the run may simply be slow to register, and a red
# scheduler job would page a human for a cosmetic timing question.
echo "::warning::Dispatched loop.yml with step=${step}, but no run appeared within 60s."
echo "::warning::Check the Actions tab; the next slot will re-check before dispatching."
exit 0
