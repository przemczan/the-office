#!/usr/bin/env bash
# The entry point of the-office's Hosted test target (`npm run test-instance`): a fresh Office of
# this checkout, run in the `checks` service of .devcontainer/compose.yaml beside its throwaway
# Postgres, which the service's start migrates. Nothing of a real Office is copied in: the user
# signs in through the instance's own first-run setup, with the setup token its log shows.
set -euo pipefail

: "${OFFICE_PORT:?is required: the port of the test target, which the service listens on}"
: "${DATABASE_URL:=postgres://office:office@postgres:5432/the_office}"

cd "$(dirname "$0")/.."

npm ci
npm run build

export DATABASE_URL
export OFFICE_HOST=0.0.0.0
export OFFICE_DATA_DIR=/tmp/office-data
export OFFICE_TEST_INSTANCE=true
export OTEL_SDK_DISABLED=true
mkdir -p "$OFFICE_DATA_DIR"

# The service itself, not the launcher: a test instance never updates or restarts itself, and exec
# lets the stop's SIGTERM reach it.
exec node --enable-source-maps apps/service/dist/main.js
