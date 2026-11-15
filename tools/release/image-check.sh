#!/usr/bin/env bash
# `image-check.sh <image> <network> <database url>`: starts The Office's image on `network`
# against the Postgres at `database url` and checks it as an install would use it
# (docs/releasing.md). prepare.sh runs it on the amd64 image before anything is pushed.
set -euo pipefail

image=${1:?Give the image to check.}
network=${2:?Give the network its Postgres is on.}
database_url=${3:?Give the database URL.}
container=office-release-image-check

fail() {
  echo "The image check failed: $*" >&2
  docker logs "$container" >&2 || true
  exit 1
}
inside() {
  docker exec "$container" "$@"
}
# The service's answer at `path`, read from inside the container; empty when it doesn't answer.
answer() {
  inside node -e '
    fetch(`http://127.0.0.1:4310${process.argv[1]}`, { signal: AbortSignal.timeout(5000) })
      .then(async (response) => response.ok && process.stdout.write(await response.text()))
      .catch(() => undefined);
  ' "$1"
}

docker rm --force "$container" >/dev/null 2>&1 || true
docker run --detach --name "$container" --network "$network" \
  --env "DATABASE_URL=$database_url" --env OTEL_SDK_DISABLED=true "$image" >/dev/null

health=
for _ in $(seq 60); do
  health=$(answer /api/health || true)
  [[ -n $health ]] && break
  [[ $(docker inspect --format '{{.State.Running}}' "$container") == true ]] || fail "the service ended."
  sleep 1
done
[[ $health == '{"database":"up"}' ]] || fail "/api/health answered '$health'."
answer / | grep --quiet '<title>The Office</title>' || fail "/ doesn't serve the web app."
echo "The service answered $health and served the web app."

docker logs "$container" 2>&1 | grep --quiet --ignore-case 'setup token' ||
  fail "the first start's logs hold no setup token."
token=$(inside npm run --silent setup-token -- --quiet) || fail "npm run setup-token -- --quiet failed."
[[ -n $token ]] || fail "npm run setup-token -- --quiet printed nothing."
echo "The first start printed a setup token, and setup-token --quiet printed a new one."

user=$(inside id --user)
[[ $user != 0 ]] || fail "the service runs as root."
inside git --version
inside ssh -V
inside docker --version
inside docker compose version
inside docker buildx version
inside sh -c 'node_modules/@anthropic-ai/claude-agent-sdk-linux-*/claude --version'
echo "The service runs as uid $user, with git, ssh, the Docker CLI, Compose, buildx and Claude Code."

docker stop "$container" >/dev/null
status=$(docker inspect --format '{{.State.ExitCode}}' "$container")
[[ $status == 143 ]] || fail "docker stop ended it with exit status $status, not 143."
echo "docker stop ended it with exit status 143."
docker rm "$container" >/dev/null
