#!/usr/bin/env bash
set -euo pipefail

component="${1:?Usage: release-version.sh <server|connector> <manual-version>}"
manual_version="${2:-}"
: "${GITHUB_EVENT_NAME:?GITHUB_EVENT_NAME is required}"
: "${GITHUB_OUTPUT:?GITHUB_OUTPUT is required}"

if [[ "$GITHUB_EVENT_NAME" == "push" ]]; then
  : "${GITHUB_REF_NAME:?GITHUB_REF_NAME is required for tag releases}"
  prefix="${component}-v"
  if [[ "$GITHUB_REF_NAME" != "$prefix"* ]]; then
    printf 'Tag %s does not start with %s.\n' "$GITHUB_REF_NAME" "$prefix" >&2
    exit 1
  fi
  version="${GITHUB_REF_NAME#"$prefix"}"
elif [[ "$GITHUB_EVENT_NAME" == "workflow_dispatch" ]]; then
  version="$manual_version"
else
  printf 'Release versions can only be resolved for tags or manual dry-runs, not %s.\n' "$GITHUB_EVENT_NAME" >&2
  exit 1
fi

if [[ ! "$version" =~ ^(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)\.(0|[1-9][0-9]*)(-([0-9A-Za-z-]+(\.[0-9A-Za-z-]+)*))?$ ]]; then
  printf 'Version %q must be a strict MAJOR.MINOR.PATCH SemVer with an optional prerelease suffix.\n' "$version" >&2
  exit 1
fi

stable=true
if [[ "$version" == *-* ]]; then
  stable=false
  prerelease="${version#*-}"
  IFS='.' read -ra identifiers <<< "$prerelease"
  for identifier in "${identifiers[@]}"; do
    if [[ "$identifier" =~ ^[0-9]+$ && "$identifier" =~ ^0.+$ ]]; then
      printf 'Numeric prerelease identifier %q cannot contain leading zeroes.\n' "$identifier" >&2
      exit 1
    fi
  done
fi

{
  printf 'version=%s\n' "$version"
  printf 'stable=%s\n' "$stable"
  printf 'tag=%s-v%s\n' "$component" "$version"
} >> "$GITHUB_OUTPUT"
