#!/usr/bin/env bash
# For the dev host alone: runs there, as root, in a checkout of The Office run by its own systemd
# unit; never in a direct install's /opt/the-office, which updates itself from Settings › Updates
# (docs/installing.md). Pulls the latest main, installs and builds what changed as the checkout's
# owner, and restarts the unit. Called by deploy.sh; safe to run by hand as root.
#
#   OFFICE_DEV_UNIT   the checkout's systemd unit   (default the-office)
set -euo pipefail

cd "$(dirname "$0")/../.."
checkout=$PWD
unit=${OFFICE_DEV_UNIT:-the-office}

if [[ $(id -u) != 0 ]]; then
  echo "Run it as root: it restarts $unit." >&2
  exit 1
fi
if [[ -e releases || -L current || -f office-release.json ]]; then
  echo "$checkout is a release of The Office, not a checkout: it updates from Settings › Updates." >&2
  exit 1
fi
owner=$(stat -c %U .)
if [[ $owner == root ]]; then
  echo "$checkout belongs to root. Give it to the user $unit runs as (chown -R <user>: $checkout), so git and npm never run as root." >&2
  exit 1
fi
owner_home=$(getent passwd "$owner" | cut -d: -f6)

as_owner() {
  runuser -u "$owner" -- env HOME="$owner_home" "$@"
}

# The braces make bash read the whole block before running it, since the pull can rewrite
# this very file.
{
  before=$(as_owner git rev-parse HEAD)
  as_owner git pull --ff-only --quiet
  after=$(as_owner git rev-parse HEAD)

  if [ ! -d node_modules ] || ! as_owner git diff --quiet "$before" "$after" -- package-lock.json; then
    as_owner npm ci --no-audit --no-fund
  fi
  as_owner npm run build

  systemctl restart "$unit"
  echo "$unit now at $(as_owner git log -1 --format='%h %s')"
  exit
}
