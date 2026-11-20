#!/usr/bin/env bash
set -euo pipefail

failed=0
for entry in "$@"; do
  name="${entry%%=*}"
  result="${entry#*=}"
  if [[ "$name" == "changes" && "$result" != "success" ]]; then
    printf 'Change detection did not succeed: %s\n' "$result" >&2
    failed=1
    continue
  fi

  case "$result" in
    success)
      printf '%s: passed\n' "$name"
      ;;
    skipped)
      printf '%s: not required for these changes\n' "$name"
      ;;
    *)
      printf '%s: unsuccessful (%s)\n' "$name" "$result" >&2
      failed=1
      ;;
  esac
done

if [[ "$failed" -ne 0 ]]; then
  exit 1
fi
printf 'All selected CI checks passed.\n'
