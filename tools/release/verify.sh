#!/usr/bin/env bash
# The Release workflow's tests before any tag (docs/releasing.md): `npm ci && npm run verify` in
# the run environment (.devcontainer/, Linux with a Postgres of its own), on a copy of the
# checkout, so the run leaves nothing in it. A failure ends the release before its tag.
set -euo pipefail

cd "$(dirname "$0")/../.."
compose=(docker compose --file .devcontainer/compose.yaml --project-name office-release-verify)
trap '"${compose[@]}" down --volumes --remove-orphans' EXIT

# Copied without node_modules and dist, which the run environment installs and builds itself, and
# owned by the container's root: git refuses a repository another user owns ("dubious ownership"),
# and the runner's checkout belongs to its own user.
"${compose[@]}" run --rm --volume "$PWD:/checkout:ro" --workdir /work checks bash -c '
  set -euo pipefail
  tar --create --directory /checkout --exclude=node_modules --exclude=dist . |
    tar --extract --no-same-owner
  npm ci
  npm run verify
'
