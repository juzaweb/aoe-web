#!/usr/bin/env bash
# Rewrite one STATE.md row's `Next action` cell to `SHIPPED <date> — <pr-url>`.
#
# Why a script and not an agent: after the merge, the row must say the truth
# without a model being involved. An agent asked to "mark it shipped" is one more
# thing that can silently do nothing.
#
# Two details make a naive `awk -F'|'` wrong for this table:
#   - some prose cells contain a pipe  (ALERT-02: "`grep sound|audio|...`")
#   - some Next action cells contain two backticked names
#     ("`candidate` — blocked by `ALERT-01`")
# so the match is anchored on the last three fields, which are always
# `<Next action> | <S|M|L> | <ROI> |`, and the ID is matched at the start of the
# row. Nothing in the middle is parsed.
#
# Usage: mark-shipped.sh <SLICE-ID> <pr-url> [file]
set -euo pipefail

slice="${1:?usage: mark-shipped.sh <SLICE-ID> <pr-url> [file]}"
url="${2:?usage: mark-shipped.sh <SLICE-ID> <pr-url> [file]}"
file="${3:-STATE.md}"
date="${MARK_SHIPPED_DATE:-$(date -u +%Y-%m-%d)}"

[ -f "$file" ] || { echo "::error::${file} not found"; exit 1; }
grep -qE "^\| \`${slice}\` \|" "$file" \
  || { echo "::error::No row for ${slice} in ${file}"; exit 1; }

tmp=$(mktemp)
# A PR URL carries slashes and sed treats them as the s/// delimiter, so escape
# both the delimiter and the one other character that is special on the right
# hand side.
url_esc=${url//\\/\\\\}
url_esc=${url_esc//\//\\/}
url_esc=${url_esc//&/\\&}
sed -E "s/^(\| \`${slice}\` .*)\| [^|]+ \| ([SML]) \| ([0-9]+) \|$/\1| \`SHIPPED ${date} — ${url_esc}\` | \2 | \3 |/" \
  "$file" > "$tmp"

if cmp -s "$file" "$tmp"; then
  # A re-run of the same merge (or a retried step) lands here with the row
  # already correct. That is success, not a malformed table.
  if grep -qF "\`SHIPPED ${date} — ${url}\`" "$file"; then
    echo "::notice::${slice} is already marked shipped; nothing to do."
    rm -f "$tmp"
    exit 0
  fi
  echo "::error::The row for ${slice} did not match the expected table shape; ${file} is unchanged."
  rm -f "$tmp"
  exit 1
fi

# Exactly one line may differ. A wider diff means the pattern matched more than
# the intended row, and a state file quietly rewritten in two places is worse
# than one left stale.
changed=$(diff "$file" "$tmp" | grep -c '^[<>]' || true)
if [ "${changed:-0}" -ne 2 ]; then
  echo "::error::Expected 1 changed line, got $((changed / 2)). ${file} is unchanged."
  rm -f "$tmp"
  exit 1
fi

mv "$tmp" "$file"
echo "Marked ${slice} shipped:"
grep -E "^\| \`${slice}\` \|" "$file"
