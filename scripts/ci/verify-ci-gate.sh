#!/usr/bin/env bash
set -euo pipefail

: "${GITHUB_REPOSITORY:?GITHUB_REPOSITORY is required}"
: "${GITHUB_SHA:?GITHUB_SHA is required}"
: "${GH_TOKEN:?GH_TOKEN is required}"

# A commit can have several CI Gate runs (for example push plus manual dispatch).
# Paginate and require the most recently started run to be a completed success.
pages="$(gh api --paginate "repos/${GITHUB_REPOSITORY}/commits/${GITHUB_SHA}/check-runs?per_page=100")"
matching="$(jq -s --arg sha "$GITHUB_SHA" '
  [.[].check_runs[] | select(.name == "CI Gate" and .head_sha == $sha)]
  | sort_by(.started_at // "")
  | reverse
' <<<"$pages")"
count="$(jq 'length' <<<"$matching")"

if [[ "$count" -eq 0 ]]; then
  printf 'No CI Gate check was found for %s.\n' "$GITHUB_SHA" >&2
  exit 1
fi

status="$(jq -r '.[0].status' <<<"$matching")"
conclusion="$(jq -r '.[0].conclusion' <<<"$matching")"
if [[ "$status" != "completed" || "$conclusion" != "success" ]]; then
  printf 'Latest CI Gate is %s/%s; a completed success is required.\n' "$status" "$conclusion" >&2
  exit 1
fi

printf 'Latest of %s CI Gate runs passed for %s.\n' "$count" "$GITHUB_SHA"
