#!/usr/bin/env bash
# For the dev host alone: a checkout of The Office run by its own systemd unit, never a direct or
# Compose install, which update from Settings › Updates (docs/installing.md). Updates that checkout
# to the latest main on GitHub by running its tools/deploy/update.sh there. The host pulls; nothing
# is pushed from here, so push main first.
#
#   deploy.sh <ssh target>     such as root@dev-host; or OFFICE_DEV_HOST
#   OFFICE_DEV_CHECKOUT        the checkout on the host     (default /srv/the-office)
#   OFFICE_DEV_SSH_KEY         the ssh key to sign in with  (default: ssh's own)
#
# The ssh target signs in as root: update.sh restarts the unit, and runs git and npm as the
# checkout's owner.
set -euo pipefail

host=${1:-${OFFICE_DEV_HOST:-}}
if [[ -z $host ]]; then
  echo "Give the dev host's ssh target: deploy.sh <user@host>, or set OFFICE_DEV_HOST." >&2
  exit 2
fi
checkout=${OFFICE_DEV_CHECKOUT:-/srv/the-office}
ssh_options=()
[[ -n ${OFFICE_DEV_SSH_KEY:-} ]] && ssh_options+=(-i "$OFFICE_DEV_SSH_KEY")

# The path travels as one quoted word, so the remote shell runs it as given.
exec ssh "${ssh_options[@]}" "$host" "$(printf '%q' "$checkout/tools/deploy/update.sh")"
