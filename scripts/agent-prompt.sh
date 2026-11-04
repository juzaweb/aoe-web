#!/usr/bin/env bash
# The prompt for one pipeline step. One definition, three callers:
#
#   - `.github/workflows/loop.yml` "Run step"          (single-step runs)
#   - `scripts/retry-gates.sh`                         (full, inside the retry loop)
#   - a human reading `opencode run --agent X "$(scripts/agent-prompt.sh ...)"`
#
# Prompts duplicated between the workflow and the retry script is how the retried
# attempt would start asking for something different than the first attempt.
#
# Usage: scripts/agent-prompt.sh <step> [slice-id]
set -euo pipefail

step="${1:?usage: agent-prompt.sh <step> [slice-id]}"
slice="${2:-}"

case "$step" in
  triage)
    echo "Run daily triage. Report only. Merge evidence-backed findings into STATE.md High Priority and Watch List, rank by ROI, set 'Last run' to today. The loop-triage skill lists the exact commands for each source; sweep all four: (1) GitHub - gh issue list, gh pr list --json reviews,comments for feedback nobody answered, gh run list --status failure for CI that stayed red while ignoring a one-off loop/ branch failure already replaced by the retry loop; (2) plan paperwork - unticked '- [ ]' boxes, 'Ngoài phạm vi' sections, DEFERRED rows and a stale status column in docs/plans/README.md; (3) the asset gap - 'legacy' paths in scripts/assets/assets.lock.json that no 'targets' entry can rebuild, cross-checked against scripts/assets/manifest.json and CREDITS.md; (4) repository reality - recent commits, existing STATE.md rows, the last verdict in loop-run-log.md, and the code itself. Every proposed row cites its evidence inline (path:line, PR number, run id or command output); an uncited row is a guess and does not go in. A row is 'candidate' only when the loop can finish it alone; a missing UX decision, an untaken measurement or missing art makes it 'blocked'. Never propose a slice that touches a gate.yaml denylist path. Do not touch source code."
    ;;
  pick)
    echo "Record the approval of slice ${slice}. Do not write code. Change only that row's Next action cell in STATE.md to 'APPROVED <date> — awaiting plan', append a line to loop-run-log.md recording the approval, and print the next command. Leave every other row and every other column byte-for-byte unchanged. Never write 'not this run' over a row that is still a candidate: the next run picks the next candidate, and that is how one slice at a time is enforced."
    ;;
  plan)
    echo "Write the implementation plan for approved slice ${slice}. Use the next free phase number in docs/plans/, follow the shape of the existing phase files, add the README phase-table row, and set the STATE.md row to 'PLANNED <date> — awaiting build'. No source code."
    ;;
  build)
    echo "Implement slice ${slice} from its plan in docs/plans/. Treat the acceptance criteria as the definition of done. Write tests, run them, report the exact commands and results. Do not commit. Stop and escalate on a denylisted path, a missing requirement, or a plan/code disagreement. Update the slice's own plan file in the same change: tick its task-table row and fill any measurement or baseline section the plan asks for — a slice whose code passes while its plan still says TODO is not done. Set the STATE.md row to 'BUILT <date> — awaiting verify'."
    ;;
  verify)
    echo "Independently verify slice ${slice} using the code-review-and-quality skill's five-axis review. Run pnpm --filter @chien-quoc/client test, pnpm --filter @chien-quoc/server test and pnpm build yourself, plus one mutation test via sed -i and git checkout. Judge every acceptance criterion pass or fail — including the paperwork: if the slice's plan file still marks its own task row TODO, or a measurement/baseline section it asks for is still empty, that is a FAIL. Append a line to loop-run-log.md whose FIRST word is PASS or FAIL — that is your verdict; the word APPROVE is reserved for the human and must not appear. On PASS set the STATE.md row to 'VERIFIED <date> — awaiting ship'."
    ;;
  ship)
    echo "Prepare slice ${slice} for shipping. Refuse unless its STATE.md row reads 'VERIFIED' and loop-run-log.md holds a PASS entry. Do not merge and do not push: leave the changes in the working tree and print the commit message and PR body you would use."
    ;;
  *)
    echo "::error::unknown step '${step}'" >&2
    exit 2
    ;;
esac
