#!/usr/bin/env bash
set -euo pipefail

BASE_URL="${WEBSITE_BASE_URL:-https://lxy.app/dsh-connect}"
ORIGIN="${WEBSITE_ORIGIN:-https://lxy.app}"
TEMP="$(mktemp -d "${TMPDIR:-/tmp}/dsh-connect-website-smoke.XXXXXX")"
trap 'rm -rf "$TEMP"' EXIT

fetch() {
  local url="$1"
  local output="$2"
  curl --fail --silent --show-error --location --retry 3 --retry-delay 2 \
    --output "$output" "$url"
  printf 'GET %s -> 200\n' "$url"
}

fetch "$BASE_URL/" "$TEMP/index.html"
fetch "$BASE_URL/docs/" "$TEMP/docs.html"
fetch "$BASE_URL/images/icon.png" "$TEMP/icon.png"
fetch "$BASE_URL/sitemap.xml" "$TEMP/sitemap.xml"

asset_path="$(node - "$TEMP/index.html" <<'NODE'
const fs = require('node:fs');
const html = fs.readFileSync(process.argv[2], 'utf8');
const pattern = new RegExp('(?:src|href)="(\\/dsh-connect\\/_next\\/[^"?#]+)[^"]*"');
const match = pattern.exec(html);
if (!match) process.exit(1);
process.stdout.write(match[1]);
NODE
)"
if [[ -z "$asset_path" ]]; then
  echo 'No deployed _next asset was found in the Website HTML.' >&2
  exit 1
fi
fetch "$ORIGIN$asset_path" "$TEMP/asset"

printf 'Website smoke test passed: %s\n' "$BASE_URL/"
