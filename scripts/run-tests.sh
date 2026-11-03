#!/usr/bin/env bash
# The repo's test gate: one definition, three callers.
#
#   - .github/workflows/ci.yml        every PR and every push to develop
#   - .github/workflows/loop.yml      before the loop opens a PR
#   - .github/workflows/loop.yml      again, when develop moved during the run
#
# Three copies of these five commands drifting apart is how "tests pass" stops
# meaning the same thing in two places, so they live here instead.
#
# Order matters:
#   - shared first: both apps import it through packages/shared/dist, which is
#     compiled, not committed.
#   - prisma generate before anything server-side: @prisma/client is generated
#     too, so a fresh clone cannot resolve it.
#
# Usage: scripts/run-tests.sh   (exits non-zero on the first red suite)
set -euo pipefail

cd "$(dirname "$0")/.."

run_suite() {
  local label="$1"; shift
  echo "::group::${label}"
  if ! "$@"; then
    echo "::endgroup::"
    echo "::error::${label} failed."
    return 1
  fi
  echo "::endgroup::"
}

run_suite "Build shared" \
  pnpm --filter @chien-quoc/shared run build
run_suite "Generate Prisma client" \
  pnpm --filter @chien-quoc/server run prisma:generate
run_suite "Type check and build" \
  bash -c 'pnpm --filter @chien-quoc/server run build && pnpm --filter @chien-quoc/client run build'
run_suite "Test client" \
  pnpm --filter @chien-quoc/client run test
run_suite "Test server" \
  pnpm --filter @chien-quoc/server run test

echo "All suites passed."
