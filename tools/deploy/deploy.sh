#!/usr/bin/env bash
# Updates the host to the latest main on GitHub by running tools/deploy/update.sh there.
# The host pulls; nothing is pushed from here, so push main first.
#
#   OFFICE_HOST     ssh target of the host   (default root@10.1.1.70)
#   OFFICE_SSH_KEY  its ssh key              (default ~/.ssh/the-office)
set -euo pipefail

host="${OFFICE_HOST:-root@10.1.1.70}"
key="${OFFICE_SSH_KEY:-$HOME/.ssh/the-office}"

exec ssh -i "$key" "$host" /opt/the-office/tools/deploy/update.sh
