#!/usr/bin/env bash
# Record a loop run outcome into loop-run-log.md and put the findings where the
# human and the next build attempt can both see them.
#
# Why a script and not an agent: this runs after the job has already failed, and
# a model asked to "write down what happened" is one more thing that can silently
# do nothing. It also has to be safe to run when loop-run-log.md is the only file
# the job is still allowed to touch.
#
# Usage:
#   scripts/record-verdict.sh <PASS|FAIL> <subject> <message> [file]
#
# The line it appends starts with the verdict word, which is what
# `.github/workflows/loop.yml` reads with `grep -E '^(PASS|FAIL)' | tail -1`.
# Keep that shape.
set -euo pipefail

cd "$(dirname "$0")/.."

verdict="${1:?usage: record-verdict.sh <PASS|FAIL> <subject> <message> [file]}"
subject="${2:?usage: record-verdict.sh <PASS|FAIL> <subject> <message> [file]}"
message="${3:?usage: record-verdict.sh <PASS|FAIL> <subject> <message> [file]}"
file="${4:-loop-run-log.md}"

case "$verdict" in
  PASS|FAIL) ;;
  *) echo "::error::verdict must be PASS or FAIL, got '${verdict}'"; exit 2 ;;
esac

[ -f "$file" ] || { echo "::error::${file} not found"; exit 1; }

# One line, no newlines from the caller: a multi-line message would push the
# verdict word off the line the workflow greps for.
flat=$(printf '%s' "$message" | tr '\n' ' ' | sed -E 's/  +/ /g' | cut -c1-400)

printf '%s %s — %s\n' "$verdict" "$subject" "$flat" >> "$file"
echo "::notice::Recorded ${verdict} for ${subject} in ${file}."
