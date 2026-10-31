#!/usr/bin/env bash
# Runs on the host: pulls the latest main from the host's bare repository, installs and
# builds what changed, and restarts the service. Called by deploy.sh; safe to run by hand.
set -euo pipefail

cd "$(dirname "$0")/../.."

# The braces make bash read the whole block before running it, since the pull can rewrite
# this very file.
{
  before=$(git rev-parse HEAD)
  git pull --ff-only --quiet
  after=$(git rev-parse HEAD)

  if [ ! -d node_modules ] || ! git diff --quiet "$before" "$after" -- package-lock.json; then
    npm ci --no-audit --no-fund
  fi
  npm run build

  systemctl restart the-office
  echo "the-office now at $(git log -1 --format='%h %s')"
  exit
}
