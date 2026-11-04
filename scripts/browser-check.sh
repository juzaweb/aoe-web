#!/usr/bin/env bash
# Serve the working tree and let the browser-verifier judge it in real Chrome.
#
# One definition, two callers:
#   - `.github/workflows/loop.yml` "Browser check"  (step = ship)
#   - `.github/workflows/loop.yml` "Run step"       (step = full, inside the retry loop)
#
# Why a script: `full` retries build/verify when a gate fails, and a gate buried
# in a YAML step cannot be re-entered from the shell loop that does the retrying.
# Keeping the whole serve-and-judge sequence here means the retried run and the
# one-shot run judge the page the same way.
#
# The server is restarted on every call on purpose: it runs from
# apps/server/dist, and `scripts/run-tests.sh` rebuilds that directory, so a
# process started before the build would be judging stale code.
#
# Usage: SLICE=<slice-id> [MODEL=<provider/model>] scripts/browser-check.sh
# Exit: 0 = BROWSER_VERDICT: PASS, 1 = anything else.
set -euo pipefail

cd "$(dirname "$0")/.."

: "${SLICE:?usage: SLICE=<slice-id> scripts/browser-check.sh}"

log=/tmp/browser-check.log
mkdir -p /tmp/game-logs

model_args=()
if [ -n "${MODEL:-}" ]; then model_args=(--model "$MODEL"); fi
# A retry starts a second server on the same port. Without this the new one
# fails to bind and the check judges the *previous* build.
pkill -f 'node dist/index.js' >/dev/null 2>&1 || true
pkill -f 'vite --host 127.0.0.1 --port 5173' >/dev/null 2>&1 || true

nohup pnpm --filter @chien-quoc/server run start \
  > /tmp/game-logs/server.log 2>&1 &
nohup pnpm --filter @chien-quoc/client exec vite \
  --host 127.0.0.1 --port 5173 --strictPort \
  > /tmp/game-logs/client.log 2>&1 &

wait_for() {
  local url="$1" name="$2" file="$3"
  for _ in $(seq 1 60); do
    if curl -sf "$url" >/dev/null 2>&1; then
      echo "::notice::${name} is up on ${url}"
      return 0
    fi
    sleep 2
  done
  echo "::error::${name} did not answer on ${url} within 120s."
  echo "::group::${name} log"
  tail -40 "$file" || true
  echo "::endgroup::"
  return 1
}

wait_for http://127.0.0.1:2567/health server /tmp/game-logs/server.log
wait_for http://127.0.0.1:5173/ client /tmp/game-logs/client.log

prompt="Browser check for slice ${SLICE}. Find its plan file under docs/plans/ (the file naming ${SLICE}) and treat its acceptance criteria as the checklist. The app is running: client http://127.0.0.1:5173, API http://127.0.0.1:2567. Drive the real UI, then judge every criterion. End your output with a single line holding only BROWSER_VERDICT: PASS or BROWSER_VERDICT: FAIL — no trailing text on that line; put the reasoning on the lines above it."

# 15 minutes is generous for a handful of interactions; a hung Chrome or a page
# that never loads must not hold the job hostage.
set +e
timeout --signal=TERM 900 opencode run --agent browser-verifier --auto \
  ${model_args[@]+"${model_args[@]}"} "$prompt" 2>&1 | tee "$log"
rc=${PIPESTATUS[0]}
set -e

if [ "$rc" -eq 124 ]; then
  echo "::error::The browser check timed out after 15 minutes."
  exit 1
fi

# The verdict is the last marker in the log, not the first: an earlier retry
# inside the same session must not decide this run.
#
# The match is on the marker as a prefix, not as the whole line. The agent
# appends its evidence to the same line ("BROWSER_VERDICT: PASS — 167/167
# green"), and an equality test read that as a failure while the log plainly
# said PASS. PASS must end the marker or be followed by a non-alphanumeric
# character; a bare `PASS*` would also accept "PASSED" and "PASSX".
verdict=$(grep -E '^BROWSER_VERDICT: (PASS|FAIL)' "$log" | tail -1 || true)

verdict_ok=false
case "$verdict" in
  "BROWSER_VERDICT: PASS" | "BROWSER_VERDICT: PASS"[![:alnum:]]*)
    verdict_ok=true ;;
esac

if [ -n "${GITHUB_OUTPUT:-}" ]; then
  echo "verdict=${verdict#BROWSER_VERDICT: }" >> "$GITHUB_OUTPUT"
fi

if [ "$rc" -ne 0 ] || [ "$verdict_ok" != "true" ]; then
  echo "::error::The browser check did not pass (${verdict:-no verdict}, exit ${rc})."
  echo "::group::Browser check output"
  tail -80 "$log" || true
  echo "::endgroup::"
  exit 1
fi

echo "::notice::Browser check passed: $verdict"