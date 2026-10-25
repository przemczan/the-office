#!/usr/bin/env bash
# npm run verify:linux runs this in the verify-linux container of docker-compose.yml: the checks
# of npm run verify on Linux, then the built service started against the compose Postgres, serving
# the built web app. The working tree is mounted read-only at /source; the checks run on a copy
# with its own node_modules.
set -euo pipefail

readonly SERVICE_URL="http://127.0.0.1:${OFFICE_PORT}"
readonly HEALTH_URL="${SERVICE_URL}/api/health"
# The web app's page, from apps/web/index.html.
readonly WEB_APP_TITLE="<title>The Office</title>"
readonly HEALTHY='{"database":"up"}'
readonly START_SECONDS=30

copy_working_tree() {
  echo "Copying the working tree from /source"
  git config --global --add safe.directory /source
  # Tracked and untracked files, without what .gitignore leaves out (node_modules, dist, .env).
  # A tracked file deleted in the working tree is skipped, as it would be in a checkout.
  git -C /source ls-files -z --cached --others --exclude-standard |
    tar -C /source --null --files-from=- --ignore-failed-read -cf - |
    tar -C /work -xf -
}

check_service_starts() {
  echo "Starting the service against the compose Postgres"
  npm run build
  node apps/service/dist/main.js &
  local service=$!
  local health=""
  for ((second = 0; second < START_SECONDS; second++)); do
    health=$(curl --silent --fail "$HEALTH_URL" || true)
    [[ -n "$health" ]] && break
    if ! kill -0 "$service" 2>/dev/null; then
      echo "The service ended before it served ${HEALTH_URL}." >&2
      return 1
    fi
    sleep 1
  done
  local page
  page=$(curl --silent --fail "${SERVICE_URL}/" || true)
  kill -TERM "$service"
  # The service ends by re-raising SIGTERM, so its exit status is 128 + 15.
  local status=0
  wait "$service" || status=$?
  if [[ "$health" != "$HEALTHY" ]]; then
    echo "Expected ${HEALTH_URL} to answer ${HEALTHY}, got '${health}'." >&2
    return 1
  fi
  if [[ "$page" != *"$WEB_APP_TITLE"* ]]; then
    echo "Expected ${SERVICE_URL}/ to serve the web app's page, got '${page:0:200}'." >&2
    return 1
  fi
  if ((status != 143)); then
    echo "The service ended with exit status ${status} on SIGTERM, not 143." >&2
    return 1
  fi
  echo "The service served ${health} and the web app, and stopped on SIGTERM."
}

copy_working_tree
cd /work
npm ci --no-audit --no-fund
# The browser the web's Playwright tests drive, with the system libraries it needs.
npx playwright install --with-deps chromium
npm run verify
check_service_starts
