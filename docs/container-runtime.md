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
5. Change the table above in the same commit. To restore a backup instead: `docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < <dump>`.

## What a run environment mounts

The Office's compose override gives the checks' service two folders of the host, each at its own path ([spec §5.5](spec/5.5-git-and-isolation.md#defaults)):

- the Task's worktree, read-write, also the working folder;
- the repository's shared git folder (`<repository>/.git`, which the worktree's `.git` file leads to), **read-only**, so git in a check reads the history (`status`, `log`, `diff`, `rev-parse`) but can't commit, move a branch or write objects. Its path comes from git on the host (`rev-parse --path-format=absolute --git-common-dir`), never from the worktree's `.git` file. A main checkout's git folder is inside the worktree and isn't mounted twice.

git refuses a repository owned by another user ("dubious ownership"). The service and the checks both run as root on The Office's machine, so it doesn't arise there; a run environment whose user differs from the folders' owner would need `safe.directory`.

## Agents never reach it

Reaching the runtime is reaching the workstation as root: a container can mount `/`. So the Office rules refuse an Agent's command that runs `docker`, `docker-compose`, `podman`, `podman-compose` or `nerdctl`, names a runtime's socket (`docker.sock`, `podman.sock`, `containerd.sock`), or sets `DOCKER_HOST`, `DOCKER_CONTEXT` or `CONTAINER_HOST`, in every Role and Stage; only the Caretaker with Allow changes on may (`container-runtime-commands.ts` in the engine module). No session's environment carries those variables.

**Accepted limit:** the hook sees the command, not what it runs. A command that calls the runtime indirectly, such as an npm script that runs `docker compose`, isn't seen; the-office has no such script since its Linux checks moved into run environments (Task 62120c02). Agents run as the same OS user as the service, and spec §6 leaves a hostile Agent out of the threat model.

## Windows: an open follow-up

Not installed or checked yet. The likely shape is Docker Desktop on WSL2, with its own versions and its own pinning. In PowerShell the refusal already covers the programs (`docker.exe` too) and the sockets; setting a variable (`$env:DOCKER_HOST = …`) needs a twin of the Bash check.
