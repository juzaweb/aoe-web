#!/usr/bin/env bash
# Push a branch for the loop pipeline.
#
# Why this exists: GITHUB_TOKEN can never push a commit that touches
# `.github/workflows/**`. GitHub rejects the ref with "refusing to allow a GitHub
# App to create or update workflow" regardless of the job's `permissions:` block,
# because the `workflow` scope is not grantable to that token. Optional
# `LOOP_PAT` (a personal access token with `repo` + `workflow`) is the only way
# to push such a branch, so it is used when present.
#
# Usage: scripts/ci-push.sh <branch>
set -euo pipefail

branch="${1:?usage: ci-push.sh <branch>}"

if [ -n "${LOOP_PAT:-}" ]; then
  # Credentials go into the remote URL for this one push. The runner is
  # disposable and the value is never echoed, but avoid `set -x` here.
  git remote set-url origin \
    "https://x-access-token:${LOOP_PAT}@github.com/${GITHUB_REPOSITORY}.git"
  echo "::notice::Pushing with LOOP_PAT (workflow-file pushes allowed)."
else
  echo "::notice::LOOP_PAT is not set; using GITHUB_TOKEN (cannot touch .github/workflows)."
fi

git push -u origin "$branch"
