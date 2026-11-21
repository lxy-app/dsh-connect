#!/usr/bin/env bash
# Build is intentionally separate: this script tests the exact supplied image.
set -euo pipefail

IMAGE=${IMAGE:?Set IMAGE to the preview Worker image to test}
PORT=${PREVIEW_SMOKE_PORT:-18788}
CONTAINER=${PREVIEW_SMOKE_CONTAINER:-dsh-connect-preview-worker-smoke}
TOKEN=preview-worker-smoke-token
WORK=$(mktemp -d "${TMPDIR:-/tmp}/dsh-preview-worker-smoke.XXXXXX")
cleanup() {
  docker rm -f "$CONTAINER" >/dev/null 2>&1 || true
  rm -f "$WORK/input.doc" "$WORK/output.pdf"
  rmdir "$WORK" 2>/dev/null || true
}
trap cleanup EXIT

# RTF is a real DOC-family input and keeps the fixture text-only in the repo.
printf '%s\n' '{\rtf1\ansi\deff0 {\fonttbl{\f0 Arial;}}\f0\fs24 DSH Connect Office preview smoke\par}' > "$WORK/input.doc"
docker run -d --name "$CONTAINER" \
  -p "127.0.0.1:${PORT}:8788" \
  --read-only \
  --tmpfs /tmp:size=512m,mode=1777 \
  --cap-drop ALL \
  --security-opt no-new-privileges:true \
  -e DSH_CONNECT_PREVIEW_WORKER_TOKEN="$TOKEN" \
  "$IMAGE" >/dev/null

ready=0
for _ in {1..30}; do
  if curl -fsS --max-time 2 "http://127.0.0.1:${PORT}/healthz" >/dev/null 2>&1; then
    ready=1
    break
  fi
  sleep 1
done
if [ "$ready" != 1 ]; then
  docker logs "$CONTAINER" >&2 || true
  echo 'Preview Worker did not become healthy.' >&2
  exit 1
fi

curl -fsS --max-time 120 \
  -H "Authorization: Bearer ${TOKEN}" \
  -H 'Content-Type: application/octet-stream' \
  -H 'X-DSH-Preview-Extension: doc' \
  --data-binary "@$WORK/input.doc" \
  "http://127.0.0.1:${PORT}/convert" \
  -o "$WORK/output.pdf"

magic=$(dd if="$WORK/output.pdf" bs=1 count=5 2>/dev/null)
if [ "$magic" != '%PDF-' ] || [ ! -s "$WORK/output.pdf" ]; then
  echo 'LibreOffice response is not a non-empty PDF.' >&2
  exit 1
fi
bytes=$(wc -c < "$WORK/output.pdf" | tr -d ' ')
printf 'Preview Worker real LibreOffice smoke passed (%s PDF bytes).\n' "$bytes"
