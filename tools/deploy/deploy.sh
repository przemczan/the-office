#!/usr/bin/env bash
# Deploys the committed main to the host: pushes it to the host's bare repository, then runs
# tools/deploy/update.sh there. Uncommitted work is not deployed.
#
#   OFFICE_HOST     ssh target of the host   (default root@10.1.1.70)
#   OFFICE_SSH_KEY  its ssh key              (default ~/.ssh/the-office)
set -euo pipefail

host="${OFFICE_HOST:-root@10.1.1.70}"
key="${OFFICE_SSH_KEY:-$HOME/.ssh/the-office}"
bare_repository=/srv/the-office.git
install_directory=/opt/the-office

cd "$(dirname "$0")/../.."

if [ "$(git branch --show-current)" != main ]; then
  echo "deploy from main (on $(git branch --show-current))" >&2
  exit 1
fi
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  echo "note: uncommitted changes are not deployed" >&2
fi

export GIT_SSH_COMMAND="ssh -i $key"
git push "ssh://$host$bare_repository" main
ssh -i "$key" "$host" "$install_directory/tools/deploy/update.sh"
