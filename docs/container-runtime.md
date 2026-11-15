# Container runtime

What runs The Office's Postgres, the bundled Grafana ([docker-compose.yml](../docker-compose.yml), [spec §5.2](spec/5.2-stack.md)) and each Task's run environment: Docker Engine with the Compose plugin, from Docker's own apt repository, held at the versions below. The systemd unit in [running-the-office.md](running-the-office.md) needs `docker.service`.

## What is installed

| Package | Version held | `docker version` / `docker compose version` reports |
|---|---|---|
| `docker-ce` | `5:29.9.3-1~ubuntu.24.04~noble` | Server: Engine 29.9.3 |
| `docker-ce-cli` | `5:29.9.3-1~ubuntu.24.04~noble` | Client: 29.9.3 |
| `containerd.io` | `2.4.2-3~ubuntu.24.04~noble` | containerd 2.4.2 |
| `docker-buildx-plugin` | `0.38.1-1~ubuntu.24.04~noble` | |
| `docker-compose-plugin` | `5.7.0-1~ubuntu.24.04~noble` | Docker Compose version v5.7.0 |

The Office's own machine (Ubuntu 24.04 x64, a Proxmox LXC guest) runs them, approved by Devops on 2026-11-08. It had Ubuntu's `docker.io` 29.1.3 and `docker-compose-v2` 2.40.3 before, which follow Ubuntu's updates rather than a pin. `apt-mark showhold` lists the five packages.

## Why Docker Engine and not Podman

The compose file and the systemd unit already ran on Docker Engine, and Docker's repository gives exact versions to hold. Podman would mean moving both, and `podman compose` covers less of the compose and devcontainer specs, which run environments (Task 62120c02) will need.

## Installing it on a fresh Linux machine

As root, on Ubuntu 24.04 (for another release, its codename in `Suites` and the versions `apt-cache madison docker-ce` lists for it):

```sh
install -m 0755 -d /etc/apt/keyrings
curl -fsSL https://download.docker.com/linux/ubuntu/gpg -o /etc/apt/keyrings/docker.asc
chmod a+r /etc/apt/keyrings/docker.asc
gpg --show-keys /etc/apt/keyrings/docker.asc   # fingerprint 9DC8 5822 9FC7 DD38 854A  E2D8 8D81 803C 0EBF CD88
cat > /etc/apt/sources.list.d/docker.sources <<'EOF'
Types: deb
URIs: https://download.docker.com/linux/ubuntu
Suites: noble
Components: stable
Signed-By: /etc/apt/keyrings/docker.asc
EOF
apt-get update
# Ubuntu's own packages conflict with Docker's; removing them keeps /var/lib/docker and /var/lib/containerd.
apt-get remove -y docker.io docker-compose-v2 docker-buildx containerd runc
ENGINE=5:29.9.3-1~ubuntu.24.04~noble
apt-get install -y docker-ce=$ENGINE docker-ce-cli=$ENGINE containerd.io=2.4.2-3~ubuntu.24.04~noble \
  docker-buildx-plugin=0.38.1-1~ubuntu.24.04~noble docker-compose-plugin=5.7.0-1~ubuntu.24.04~noble
apt-mark hold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
docker version && docker compose version
```

**In an LXC guest** (Proxmox), the container needs nesting before the daemon starts: on the host, `pct set <id> --features nesting=1` (`nesting=1,keyctl=1` for an unprivileged guest) and restart the guest.

## Upgrading safely

Restarting or upgrading `docker.service` stops Postgres and, through `Requires=docker.service`, The Office with every Stage running. So an upgrade is run by hand from a terminal, never from a Stage:

1. `systemctl stop the-office`.
2. Back up the database, from the checkout (`/opt/the-office`):
   `docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > /root/the-office-$(date +%F).dump`,
   and note the counts to compare: `docker compose exec -T postgres sh -c 'psql -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Atc "select count(*) from tasks; select count(*) from projects"'`.
3. `apt-mark unhold` the five packages, `apt-get install` the new exact versions, `apt-mark hold` them again.
4. `docker compose up -d --wait postgres` reports it healthy and the counts match; then `systemctl start the-office`.
5. Change the table above in the same commit, and the CLI, buildx and Compose versions in the [Dockerfile](../Dockerfile), whose image carries them from Docker's Debian repository ([releasing.md](releasing.md)). To restore a backup instead: `docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < <dump>`.

## What a run environment mounts

The Office's compose override gives the checks' service two folders of the host, each at its own path ([spec §5.5](spec/5.5-git-and-isolation.md#defaults)):

- the Task's worktree, read-write, also the working folder;
- the repository's shared git folder (`<repository>/.git`, which the worktree's `.git` file leads to), **read-only**, so git in a check reads the history (`status`, `log`, `diff`, `rev-parse`) but can't commit, move a branch or write objects. Its path comes from git on the host (`rev-parse --path-format=absolute --git-common-dir`), never from the worktree's `.git` file. A main checkout's git folder is inside the worktree and isn't mounted twice.

### A non-root Office

An installed Office runs as a user of its own (`the-office` from the Debian/Ubuntu installer, uid 10001 in the container), while the checks keep the user devcontainer.json or the image names, root for most images ([spec §5.5 Defaults](spec/5.5-git-and-isolation.md#defaults), "Run environments with a non-root Office"):

- **Files handed back.** After every check, passed, failed, timed out or stopped, The Office runs `find <worktree> \( ! -user U -o ! -group G \) -exec chown -h U:G {} +` as `0:0` in the checks' service, U:G being its own ids, so restoring the worktree, moving test output out, Agents' edits and removing the worktree work on what a root check wrote. Only files with the wrong owner change, so git rehashes no tracked file. A hand-back that fails ends the check as could-not-run and stops the run environment; the next check hands back what was left.
- **git trusts the worktree.** git refuses a repository owned by another user ("dubious ownership"). The check's script adds `safe.directory=*` through `GIT_CONFIG_COUNT`/`GIT_CONFIG_KEY_n`/`GIT_CONFIG_VALUE_n`, after any the Project sets, which git honours from 2.35.2, the versions that check ownership. The git folder stays read-only.
- **A root Office** (and Windows) runs no hand-back and adds nothing to the script.

Not handled:

- rootless Docker and userns-remap: root in the container isn't the host's root, so `chown` there can't give files to The Office's user;
- a check user other than root (`remoteUser: node`, say) can't write a worktree it doesn't own, and nothing changes that;
- a process a check left running (a server started in the background) may write files after the hand-back; the next check's hand-back covers them.

## Agents never reach it

Reaching the runtime is reaching the workstation as root: a container can mount `/`. So the Office rules refuse an Agent's command that runs `docker`, `docker-compose`, `podman`, `podman-compose` or `nerdctl`, names a runtime's socket (`docker.sock`, `podman.sock`, `containerd.sock`), or sets `DOCKER_HOST`, `DOCKER_CONTEXT` or `CONTAINER_HOST`, in every Role and Stage; only the Caretaker with Allow changes on may (`container-runtime-commands.ts` in the engine module). No session's environment carries those variables.

**Accepted limit:** the hook sees the command, not what it runs. A command that calls the runtime indirectly, such as an npm script that runs `docker compose`, isn't seen; the-office has no such npm script since its Linux checks moved into run environments (Task 62120c02); the release scripts in `tools/release/` call `docker` and run only in the Release workflow on GitHub ([releasing.md](releasing.md)), never in a Stage. Agents run as the same OS user as the service, and spec §6 leaves a hostile Agent out of the threat model.

## Windows: an open follow-up

Not installed or checked yet. The likely shape is Docker Desktop on WSL2, with its own versions and its own pinning. In PowerShell the refusal already covers the programs (`docker.exe` too) and the sockets; setting a variable (`$env:DOCKER_HOST = …`) needs a twin of the Bash check.
