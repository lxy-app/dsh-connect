#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
IMAGE="${IMAGE:-dsh-connect-ci:local}"
PLATFORM="${PLATFORM:-linux/amd64}"
BUILDPLATFORM="${BUILDPLATFORM:-linux/amd64}"
CONTAINER="dsh-connect-smoke-$$"

cleanup() {
  status=$?
  trap - EXIT
  if [[ "$status" -ne 0 ]] && docker inspect "$CONTAINER" >/dev/null 2>&1; then
    docker logs "$CONTAINER" >&2 || true
  fi
  docker rm --force --volumes "$CONTAINER" >/dev/null 2>&1 || true
  exit "$status"
}
trap cleanup EXIT

if [[ "${DSH_CONNECT_SMOKE_BUILD:-1}" == "1" ]]; then
  docker buildx build \
    --platform "$PLATFORM" \
    --build-arg "BUILDPLATFORM=$BUILDPLATFORM" \
    --load \
    --tag "$IMAGE" \
    "$ROOT"
fi

docker run --detach \
  --name "$CONTAINER" \
  --platform "$PLATFORM" \
  --publish 127.0.0.1::8787 \
  --env DSH_CONNECT_BOOTSTRAP_TOKEN=ci-smoke-token-not-for-production \
  --env DSH_CONNECT_BOOTSTRAP_OWNER_EMAIL=ci-smoke-owner@example.com \
  --env DSH_CONNECT_BOOTSTRAP_OWNER_PASSWORD=ci-smoke-owner-password-not-for-production \
  --env DSH_CONNECT_BOOTSTRAP_OWNER_NAME='CI Smoke Owner' \
  --env DSH_CONNECT_DATABASE_URL=sqlite:///data/sqlite/smoke.db \
  --env DSH_CONNECT_ATTACHMENTS=readwrite \
  --mount type=volume,destination=/data/attachments \
  --mount type=volume,destination=/data/sqlite \
  "$IMAGE" >/dev/null

endpoint="$(docker port "$CONTAINER" 8787/tcp | awk -F: 'NR == 1 { print $NF }')"
if [[ -z "$endpoint" ]]; then
  echo 'Could not determine the published smoke-test port.' >&2
  exit 1
fi
base_url="http://127.0.0.1:${endpoint}"

ready=0
for _ in $(seq 1 60); do
  if curl --fail --silent --output /dev/null "$base_url/"; then
    health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$CONTAINER")"
    if [[ "$health" == "healthy" ]]; then
      ready=1
      break
    fi
    if [[ "$health" == "unhealthy" ]]; then
      echo 'Smoke-test container became unhealthy.' >&2
      exit 1
    fi
  fi
  if [[ "$(docker inspect --format '{{.State.Running}}' "$CONTAINER")" != "true" ]]; then
    echo 'Smoke-test container exited before becoming ready.' >&2
    exit 1
  fi
  sleep 1
done
if [[ "$ready" -ne 1 ]]; then
  echo 'Smoke-test container did not become healthy within 60 seconds.' >&2
  exit 1
fi

expect_status() {
  local expected="$1"
  local path="$2"
  local actual
  actual="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' "$base_url$path")"
  if [[ "$actual" != "$expected" ]]; then
    printf 'GET %s returned %s; expected %s.\n' "$path" "$actual" "$expected" >&2
    exit 1
  fi
  printf 'GET %s -> %s\n' "$path" "$actual"
}

expect_status 200 /
expect_status 200 /sessions/ci-smoke
expect_status 401 /v1/admin/users

health="$(docker inspect --format '{{if .State.Health}}{{.State.Health.Status}}{{else}}missing{{end}}' "$CONTAINER")"
if [[ "$health" != "healthy" ]]; then
  printf 'Container health is %s; expected healthy.\n' "$health" >&2
  exit 1
fi

user="$(docker inspect --format '{{.Config.User}}' "$CONTAINER")"
if [[ "$user" != "app" ]]; then
  printf 'Container user is %q; expected app.\n' "$user" >&2
  exit 1
fi

docker exec --user app "$CONTAINER" test -w /data/attachments
docker exec --user app "$CONTAINER" test -w /data/sqlite
docker run --rm --platform "$PLATFORM" --entrypoint /bin/sh "$IMAGE" -c \
  'test ! -e /app/.env && test ! -d /app/node_modules && test ! -d /src'

printf 'Docker smoke test passed: image=%s platform=%s health=%s user=%s\n' \
  "$IMAGE" "$PLATFORM" "$health" "$user"
