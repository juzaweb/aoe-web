#!/usr/bin/env bash
# The `full` pipeline: build, gate, test, browser-check, retry, escalate.
#
# Why a script instead of inline YAML: the retry loop has to re-enter four YAML
# steps (build, gate, tests, browser check) in the right order, and a YAML job
# cannot loop back to a previous step. Moving the sequence here means the retry
# is a real retry — the same commands, the same gate, a freshly rebuilt tree —
# instead of a second `opencode run` in a job whose state was never rolled back.
#
# Attempts are capped at 3 by loop-constraints.md, and the cap is shared with the
# verifier: a browser failure counts against the same budget as a verifier FAIL,
# because both mean "this slice is not done".
#
# Usage: SLICE=<id> BASE=<sha> [MODEL=<provider/model>] [ATTEMPTS=3] \
#          scripts/retry-gates.sh
# Exit: 0 = every gate passed and the tree is shippable, 1 = budget exhausted.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${SLICE:?usage: SLICE=<id> BASE=<sha> scripts/retry-gates.sh}"
: "${BASE:?usage: SLICE=<id> BASE=<sha> scripts/retry-gates.sh}"
attempts="${ATTEMPTS:-3}"

# `set -u` plus an empty array is an error on bash 3.2 (macOS), which is where a
# human runs this by hand before pushing. The `[+...]` expansion keeps it
# portable and still passes `--model` on CI's bash 5.
model_args=()
if [ -n "${MODEL:-}" ]; then model_args=(--model "$MODEL"); fi

# Only the LAST verdict counts. loop-run-log.md accumulates across runs and
# slices, so `grep -q '^PASS'` would stay green because some earlier slice
# passed, even after this one failed.
last_verdict_is_pass() {
  local last
  last=$(grep -E '^(PASS|FAIL)' loop-run-log.md | tail -1 || true)
  # The verifier writes evidence after the word, so this is a prefix test, not
  # an equality test.
  case "$last" in PASS*) return 0 ;; *) return 1 ;; esac
}

attempt=1
while : ; do
  echo "::group::attempt ${attempt} of ${attempts} — build"
  opencode run --agent implementer --auto ${model_args[@]+"${model_args[@]}"} \
    "$(scripts/agent-prompt.sh build "$SLICE")"
  echo "::endgroup::"

  echo "::group::attempt ${attempt} of ${attempts} — verifier"
  opencode run --agent verifier --auto ${model_args[@]+"${model_args[@]}"} \
    "$(scripts/agent-prompt.sh verify "$SLICE")"
  echo "::endgroup::"

  if ! last_verdict_is_pass; then
    echo "::warning::Verifier failed (attempt ${attempt} of ${attempts})."
    if [ "$attempt" -ge "$attempts" ]; then
      echo "::error::Verifier failed this slice ${attempts} times; giving up."
      exit 1
    fi
    attempt=$((attempt + 1))
    continue
  fi

  # The verifier runs the tests inside its own review, but this gate is the one
  # the ship step trusts, and it runs on the tree that would be committed.
  echo "::group::attempt ${attempt} of ${attempts} — tests"
  if ! bash scripts/run-tests.sh; then
    echo "::endgroup::"
    echo "::warning::Tests failed after a verifier PASS (attempt ${attempt} of ${attempts})."
    if [ "$attempt" -ge "$attempts" ]; then
      echo "::error::Tests failed ${attempts} times; giving up."
      bash scripts/record-verdict.sh FAIL "tests:${SLICE}" \
        "the suite stayed red after a verifier PASS; the next attempt needs the failing suite named" || true
      exit 1
    fi
    attempt=$((attempt + 1))
    continue
  fi
  echo "::endgroup::"

  # The gate is re-checked every attempt: a "fix" is free to touch a denylisted
  # path, and the earlier verdict says nothing about the new tree.
  echo "::group::attempt ${attempt} of ${attempts} — gate"
  if ! BASE="$BASE" bash scripts/gate-check.sh; then
    echo "::endgroup::"
    echo "::error::The slice touches a gate.yaml denylisted path; refusing it."
    exit 1
  fi
  echo "::endgroup::"

  # Unit tests cannot see a rendered page. This is judged last because it is the
  # most expensive and because it needs the build the test gate just produced.
  echo "::group::attempt ${attempt} of ${attempts} — browser check"
  if SLICE="$SLICE" MODEL="${MODEL:-}" bash scripts/browser-check.sh; then
    echo "::endgroup::"
    echo "::notice::All gates passed on attempt ${attempt}."
    exit 0
  fi
  echo "::endgroup::"

  echo "::warning::Browser check failed (attempt ${attempt} of ${attempts})."
  # Recorded on every failed attempt, not only on the last one: the next build
  # reads the last verdict line, and a verifier PASS left there would tell it
  # nothing about the browser failure it has to fix.
  #
  # `::group::` markers are stripped: they are workflow plumbing inside the log,
  # and they read as noise in a one-line verdict.
  tail_detail=$(tail -6 /tmp/browser-check.log 2>/dev/null \
    | grep -v '^::' \
    | tr '\n' ' ' | sed -E 's/  +/ /g' | cut -c1-200 || true)
  bash scripts/record-verdict.sh FAIL "browser:${SLICE}" \
    "attempt ${attempt} of ${attempts}; ${tail_detail:-no log}" || true

  if [ "$attempt" -ge "$attempts" ]; then
    echo "::error::The browser check failed this slice ${attempts} times; giving up."
    exit 1
  fi
  attempt=$((attempt + 1))
done
