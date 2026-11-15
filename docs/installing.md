# Installing The Office

How to install The Office from an Office release, set it up, keep it up to date, back it up and remove it. There are two ways to install it, and both run the same release:

- **Direct install** (recommended): one command on Debian or Ubuntu installs The Office as a systemd service, with what it needs.
- **Compose install**: a folder with a `docker-compose.yml` and its `.env`, on any Linux machine with Docker.

Releases are for Linux only. On **Windows and macOS**, and to work on The Office itself, run it from a checkout of the repository instead: [running-the-office.md](running-the-office.md#running-from-a-checkout).

Commands below use the defaults: port `4310`, the data folder `/var/lib/the-office` and version numbers such as `1.4.0`. Put in your own where they differ.

## Requirements

### Direct install

- **System:** Debian 12 or 13, or Ubuntu 22.04 or 24.04, on x64 (amd64) or arm64, with systemd: a VM, bare metal, or an LXC guest. Anything else is refused before anything changes.
- **Root:** the installer runs as root, through `sudo`.
- **In an LXC guest** (Proxmox): Docker needs nesting turned on. On the Proxmox host run `pct set <id> --features nesting=1,keyctl=1` and restart the guest before you install.
- **Network:** outbound HTTPS to `github.com` (the release), `deb.nodesource.com` (Node), `download.docker.com` (Docker) and `apt.postgresql.org` (PostgreSQL), and to whatever your Projects and engines reach.
- **What it installs**, only where missing:
  - `git`, the ssh client, `curl`, `gnupg` and `ca-certificates`;
  - Node 22 (22.18 or later) from NodeSource;
  - Docker Engine with Compose and buildx, from Docker's repository, held at the versions in [container-runtime.md](container-runtime.md#what-is-installed). A Docker already there is kept; one lacking Compose or buildx stops the installer;
  - PostgreSQL 18 from the PostgreSQL apt repository (PGDG), as the machine's own database server, not in a container.

### Compose install

- **System:** Linux with Docker Engine and its Compose plugin (`docker compose version` answers), on amd64 or arm64.
- **Not Docker Desktop:** The Office runs on the host's own network (`network_mode: host`), which Docker Desktop doesn't give.
- **Network:** outbound HTTPS to `github.com` and `ghcr.io` (the image), and to whatever your Projects and engines reach.

### Both

- **Docker access is root access.** The Office starts each Task's run environment through the Docker daemon, and whoever reaches Docker's socket can reach the whole machine as root. Install The Office on a machine you give it, and let in only people you trust.
- **A free port:** `4310` unless you choose another.
- **Disk:** room for each Task's worktree, each Project's clone, and the run environment images Docker builds, which take the most. A few GB to start, and tens of GB for busy Projects.

## Install on Debian/Ubuntu

Run:

```sh
curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash
```

It asks three things at the terminal, even when piped, with the default in brackets; Enter takes it:

| Question | Default | |
| --- | --- | --- |
| Address to listen on | `127.0.0.1` | This machine alone. `0.0.0.0` for every address of the machine, or one of its IP addresses, to open it on your network. |
| Port | `4310` | From 1024 to 65535, free on this machine. |
| Office data folder | `/var/lib/the-office` | Where The Office keeps its worktrees, clones, sessions and files. It can't be changed once installed. |

Then it shows the answers and the version and asks `Continue? [Y/n]`. Answering no changes nothing.

### Options

Each option has a variable of the same meaning. Through `sudo`, give a variable after `sudo`: `curl … | sudo OFFICE_PORT=4400 bash`. A flag after `bash -s --` works too: `curl … | sudo bash -s -- --port 4400`.

| Flag | Variable | What it does |
| --- | --- | --- |
| `--host <ip>` | `OFFICE_HOST` | The address to listen on, `127.0.0.1` by default; `0.0.0.0` for every address. |
| `--port <port>` | `OFFICE_PORT` | The port, `4310` by default. |
| `--data-dir <path>` | `OFFICE_DATA_DIR` | The Office data folder, `/var/lib/the-office` by default. An absolute path of letters, digits, `.`, `_`, `-` and `/`. A folder that isn't empty must belong to the user `the-office`. |
| `--version <x.y.z>` | `OFFICE_VERSION` | The release to install. Without it, a first install takes the release the script came from (the newest, for the one-liner), and a rerun keeps the installed version. |
| `--yes` | | Asks nothing: takes the values given, else the installed ones, else the defaults. |
| `--uninstall` | | Removes The Office ([Uninstalling](#uninstalling)). |
| `--purge` | | With `--uninstall`: removes its data too. |
| `--help` | | Lists the options. |
| | `THE_OFFICE_INSTALL_HEALTH_SECONDS` | How long to wait for The Office to start, 180 seconds by default. |

A value given as a flag or variable isn't asked for, and a rerun asks nothing it already knows. For an install with no questions:

```sh
curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash -s -- --yes --host 0.0.0.0
```

### What it creates

| What | Where |
| --- | --- |
| The system user `the-office`, in the `docker` group, which runs The Office | home `/home/the-office` |
| The release, unpacked, and the link to the one that runs | `/opt/the-office/releases/<version>/`, `/opt/the-office/current` |
| The configuration, readable by root alone | `/etc/the-office/office.env` |
| The systemd service, started now and at every boot | `the-office.service` (`/etc/systemd/system/the-office.service`) |
| The database `the_office`, owned by the role `office` with a random password | PostgreSQL 18's own cluster, port 5432 |
| The Office data folder, owned by `the-office` | `/var/lib/the-office` |
| The install log | `/var/log/the-office-install.log` |

`office.env` holds `OFFICE_HOST`, `OFFICE_PORT`, `OFFICE_DATA_DIR` and `DATABASE_URL`. Lines you add to it are kept by every rerun ([Configuration](#configuration)).

### What it prints

It waits until The Office reports its database up, then prints the address to open and the setup token:

```text
The Office 1.4.0 is running.
Open: http://127.0.0.1:4310

Setup token: ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2
Give it to The Office to create the first user. Until a user exists, running the
installer again prints a new one, and the earlier one stops working.
Guide: https://github.com/przemczan/the-office/blob/main/docs/installing.md
```

Go on with [First run](#first-run). If The Office doesn't start in time, the installer shows the end of its log; `journalctl -u the-office` shows all of it.

**Running it again is safe.** It keeps the answers, the database password, the installed version and your lines in `office.env`, installs only what is missing, and restarts The Office only when the release, `office.env` or the unit changed. Run it again after fixing whatever stopped it.

### Reaching it from other machines

- **On your local network:** install with `--host 0.0.0.0` (or the machine's IP address), or set `OFFICE_HOST` in `office.env` ([Configuration](#configuration)), then open `http://<machine's IP>:4310`. Passwords and the sign-in cookie cross the network over plain HTTP, so only on a network you trust.
- **Over HTTPS at a domain:** keep `127.0.0.1`, put a reverse proxy in front and set the public address: [Behind a reverse proxy](running-the-office.md#behind-a-reverse-proxy).

## Install with Docker Compose

1. Make a folder for it and fetch the newest release's two files into it:

   ```sh
   mkdir -p ~/the-office && cd ~/the-office
   curl -fsSLo docker-compose.yml https://github.com/przemczan/the-office/releases/latest/download/docker-compose.yml && curl -fsSLo .env https://github.com/przemczan/the-office/releases/latest/download/the-office.env
   ```

   For a given version, fetch them from that release instead:

   ```sh
   curl -fsSLo docker-compose.yml https://github.com/przemczan/the-office/releases/download/v1.4.0/docker-compose.yml && curl -fsSLo .env https://github.com/przemczan/the-office/releases/download/v1.4.0/the-office.env
   ```

2. Fill in `.env`. Its comments say the same; set every value here, never in the shell, where a variable would win over `.env` and Settings › Updates wouldn't see it.

   | Value | What to put |
   | --- | --- |
   | `OFFICE_VERSION` | Already set to the release you fetched. |
   | `DOCKER_GID` | The group of Docker's socket: `stat -c %g /var/run/docker.sock`. |
   | `POSTGRES_PASSWORD` | A new password for the database: `openssl rand -hex 24`. Postgres keeps the one it first started with. |
   | `OFFICE_DATA_DIR` | The Office data folder, an absolute path, `/var/lib/the-office` by default. It is created at the first start and mounted at the same path in the container. |
   | `OFFICE_HOST`, `OFFICE_PORT` | The address and port, on the host's network: `127.0.0.1` and `4310` by default. `0.0.0.0` or the machine's IP address opens it on your network (as [above](#reaching-it-from-other-machines)). |
   | `OFFICE_PUBLIC_ADDRESS` | Blank, or the `https://` address your reverse proxy serves it at ([Behind a reverse proxy](running-the-office.md#behind-a-reverse-proxy)). |
   | `POSTGRES_PORT` | The port Postgres is published on, on `127.0.0.1` only: `5432`. |
   | `COMPOSE_PROFILES`, `GRAFANA_PORT` | `grafana` to start the bundled Grafana, at `http://localhost:3300`; blank leaves it out. |
   | `OFFICE_SKIP_SETUP_BASICS` | `true` leaves out First-run setup's basics ([First run](#first-run)). |
   | `OFFICE_IMAGE` | Left commented out, unless you run another image, such as a fork's. |

   It holds the database's password, so keep it to yourself:

   ```sh
   chmod 600 .env
   ```

3. Start it, and read the address and the setup token from its log:

   ```sh
   docker compose up -d
   docker compose logs office
   ```

   ```text
   The Office waits for its first user. Open http://localhost:4310 and give it this setup token:

       ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2
   ```

Go on with [First run](#first-run).

The Compose install runs three containers: `office`, `postgres` (its data in the volume `the-office_postgres-data`), and `otel-lgtm` while the `grafana` profile is on. The repository's own `docker-compose.yml`, the dev stack, uses the same project name and volume, so a machine runs one of them, never both.

**Only Projects inside the data folder work with run environments:** those added by Repository URL, which The Office clones into `<data folder>/repositories/`. A Project added from a local folder outside the data folder isn't at that path on the host, so its run environment can't mount it.

## First run

1. **Open The Office** at the address the install printed.
2. **Give it the setup token**, with your name, email and password, and choose **Create the first user**. Nobody creates an account before the setup token is used, so whoever reaches The Office first over the network can't claim it. The token works once.
3. **First-run setup** then walks through the basics, each of which you can skip and set later in Settings:
   - **Engine:** the Office default engine and its sign-in.
   - **Sign in with GitHub:** The Office's own git identity, for cloning, pushing and pull requests on GitHub. Skip it when your Projects aren't on GitHub.
   - **Telemetry:** Off, Bundled Grafana or Your own endpoint ([Configuration](#telemetry)).

   **Finish**, or **Skip the rest**, closes it for good.

To leave the basics out altogether, as for an automated install, set `OFFICE_SKIP_SETUP_BASICS=true` before the first user is created: in `office.env` (then restart, see [Configuration](#configuration)) or in the Compose install's `.env`. The setup token and the first user are still asked for.

### A new setup token

While no user exists, a new token replaces the earlier one:

| Install | Command |
| --- | --- |
| Direct install | Run the one-liner again: `curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh \| sudo bash -s -- --yes`. It prints a new token. |
| Compose install | `docker compose exec office npm run setup-token`, in the compose folder. |
| A checkout | `npm run setup-token`, in the checkout. |

Once the first user exists, there is no token to get: sign in, or [set a password on the host](#setting-a-users-password-on-the-host).

## Configuration

What The Office reads at its start, and how to apply a change:

| Install | Where | After a change |
| --- | --- | --- |
| Direct install | `/etc/the-office/office.env`, as root: `sudo nano /etc/the-office/office.env` | `sudo systemctl restart the-office` |
| Compose install | `.env` in the compose folder | `docker compose up -d`, in the compose folder |
| A checkout | `.env` at the checkout's root | restart `npm start` (or its service) |

- **Direct install:** add a setting as a line of its own, such as `OFFICE_PUBLIC_ADDRESS=https://office.example.com`. Reruns of the installer keep your lines and rewrite only `OFFICE_HOST`, `OFFICE_PORT`, `OFFICE_DATA_DIR` and `DATABASE_URL`, from the answers. `OFFICE_DATA_DIR` can't be changed.
- **Compose install:** change only the values `.env` already has. The container gets only the variables `docker-compose.yml` lists, so a line you add to `.env` doesn't reach The Office. Never set them in the shell instead: a shell variable wins over `.env` for that one command, and the Office updater runs without it.
- **A checkout:** [running-the-office.md](running-the-office.md#running-from-a-checkout).

### Telemetry

Telemetry is set in Settings › Telemetry (or First-run setup): Off, Bundled Grafana, or Your own endpoint, an OTLP over HTTP address. A change applies at the next start. On a direct install or a checkout, `OTEL_SDK_DISABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_HEADERS` in the configuration wins over the setting ([running-the-office.md](running-the-office.md#telemetry)).

- **Compose install:** `COMPOSE_PROFILES=grafana` in `.env`, then `docker compose up -d`, starts the bundled Grafana at `http://localhost:3300`; then choose Bundled Grafana.
- **Direct install:** the bundled Grafana isn't installed. Start it in Docker, on this machine alone, then choose Bundled Grafana:

  ```sh
  sudo docker run -d --name the-office-grafana --restart unless-stopped -p 127.0.0.1:3300:3000 -p 127.0.0.1:4317:4317 -p 127.0.0.1:4318:4318 grafana/otel-lgtm:0.38.0@sha256:75cdf892daffadf3763ef61c16a6d7f8586216fce0b40bba7874a0b053121084
  ```

  Or choose Your own endpoint.

### Setting a user's password on the host

A user who lost their password gets back in through a command on the machine. It asks for the new password twice, lifts the user's lockout and signs out all their signed-in devices; `--clear-authenticator` after the email also removes their authenticator and recovery codes. The Office may keep running.

| Install | Command |
| --- | --- |
| Direct install | `sudo systemd-run --quiet --pty --wait --collect --uid=the-office --gid=the-office -p EnvironmentFile=/etc/the-office/office.env --working-directory=/opt/the-office/current /usr/bin/npm run set-password -- --email ada@example.com` |
| Compose install | `docker compose exec office npm run set-password -- --email ada@example.com`, in the compose folder |
| A checkout | `npm run set-password -- --email ada@example.com`, in the checkout |

More in [running-the-office.md](running-the-office.md#setting-a-users-password-on-the-host).

## Backups

Back up three things: the database, the data folder and the configuration. Take them together, with The Office stopped, so they match.

### Direct install

```sh
sudo systemctl stop the-office
sudo runuser -u postgres -- pg_dump -Fc the_office > the-office.dump
sudo tar -C / --numeric-owner -czf the-office-data.tar.gz var/lib/the-office etc/the-office
sudo systemctl start the-office
```

To restore, on the same machine or on a new one after the [install](#install-on-debianubuntu) with the same data folder:

```sh
sudo systemctl stop the-office
sudo runuser -u postgres -- dropdb the_office
sudo runuser -u postgres -- createdb -O office the_office
sudo runuser -u postgres -- pg_restore -d the_office < the-office.dump
sudo rm -rf /var/lib/the-office
sudo tar -C / --numeric-owner -xzpf the-office-data.tar.gz var/lib/the-office
sudo systemctl start the-office
```

On a new machine, keep its own `office.env` (its database password is the new one) and copy only the lines you added from the backed-up `etc/the-office/office.env`. The user `the-office` may have another uid there: then `sudo chown -R the-office:the-office /var/lib/the-office` after unpacking.

### Compose install

In the compose folder:

```sh
docker compose stop office
docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > the-office.dump
sudo tar -C / --numeric-owner -czf the-office-data.tar.gz var/lib/the-office
cp .env the-office.env.backup
docker compose start office
```

To restore, with `docker-compose.yml` and the backed-up `.env` in the compose folder:

```sh
docker compose up -d --wait postgres
docker compose stop office
docker compose exec -T postgres sh -c 'pg_restore -U "$POSTGRES_USER" -d "$POSTGRES_DB" --clean --if-exists' < the-office.dump
sudo rm -rf /var/lib/the-office
sudo tar -C / --numeric-owner -xzpf the-office-data.tar.gz var/lib/the-office
docker compose up -d
```

## Updating

### In Settings › Updates

The Office checks for newer releases every day and lists them, with their notes, in Settings › Updates; **Check for updates** looks at once. A check installs nothing.

1. **Update** schedules the update. New Starts wait in the queue, and the update waits until nothing is busy: no Agent mid-turn, no Script Stage, Publish, clone or environment check running. Settings › Updates lists what it waits for, and **Cancel** calls it off.
2. Then The Office installs the newest release and restarts on it: on a direct install its launcher downloads and checks the release, switches `/opt/the-office/current` to it and restarts; on a Compose install the Office updater pulls the new image, sets `OFFICE_VERSION` in `.env` and recreates the `office` container.
3. It waits for the new version to report healthy. If it doesn't, it goes back to the previous version on its own.
4. A Notification says how it went, and Settings › Updates keeps the update's log.

**A rollback restores the code, never the database.** The migrations a newer version ran stay, and each release keeps the previous one working with them. Still, back up first ([Backups](#backups)) when you want a way back that doesn't depend on it. The details are in [How an Office update works](running-the-office.md#how-an-office-update-works).

### By hand

**Direct install:** rerun the installer with the version to move to. It refuses an older version than the one installed:

```sh
curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash -s -- --yes --version 1.5.0
```

The release before stays in `/opt/the-office/releases/`. To go back to it by hand, point `current` at it and restart:

```sh
sudo ln -sfn releases/1.4.0 /opt/the-office/current
sudo systemctl restart the-office
```

**Compose install:** in the compose folder, set `OFFICE_VERSION=1.5.0` in `.env`, then:

```sh
docker compose pull office && docker compose up -d --no-deps office
```

Going back is the same with the earlier version.

**When a release's notes say `docker-compose.yml` changed,** fetch the new one into the compose folder and keep your `.env`, then set its `OFFICE_VERSION` and run `docker compose up -d`:

```sh
curl -fsSLo docker-compose.yml https://github.com/przemczan/the-office/releases/download/v1.5.0/docker-compose.yml
```

Compare your `.env` with that release's `the-office.env` for new values.

## Uninstalling

### Direct install

```sh
curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash -s -- --uninstall
```

It lists what it removes and keeps and asks `Continue? [y/N]`; with no terminal it refuses unless given `--yes`. To remove The Office's data too:

```sh
curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash -s -- --uninstall --purge
```

| | `--uninstall` | `--uninstall --purge` |
| --- | --- | --- |
| The service `the-office` and its unit | removed | removed |
| `/opt/the-office` (the releases) and the install log | removed | removed |
| The run environments' containers, networks, volumes and images (labelled `office.managed=true` and this Office's `office.instance`) | removed | removed |
| The data folder (`/var/lib/the-office`) | kept | removed |
| The database `the_office` and its role `office` | kept | removed |
| `/etc/the-office/office.env` | kept | removed |
| The user `the-office` and its home | kept | removed |
| Node, Docker, PostgreSQL and their apt sources | kept | kept |

After `--uninstall` alone, running the installer again brings the same Office back, with its users and work.

`--purge` removes the data folder only when it is The Office's own: an absolute folder below a top-level one (not `/srv` or `/var/lib` themselves, nor inside `/etc`, `/usr` and the like), owned by `the-office`. Otherwise it keeps it and says why; remove it by hand if you mean to.

A bundled Grafana you started [by hand](#telemetry) stays: `sudo docker rm -f the-office-grafana`.

#### Removing the packages it added

The installer never removes Node, Docker or PostgreSQL: other software on the machine may use them. If nothing else does, and the installer was what added them, remove them by hand. Each removes that program's data with it.

```sh
# Docker: held at its version, so unhold it first. /var/lib/docker holds every container and image on the machine.
sudo apt-mark unhold docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo apt-get purge -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo rm -rf /var/lib/docker /var/lib/containerd

# Node, from NodeSource.
sudo apt-get purge -y nodejs

# PostgreSQL 18, from PGDG. /var/lib/postgresql holds every database of the machine.
sudo apt-get purge -y postgresql-18 postgresql-client-18 postgresql-common postgresql-client-common
sudo rm -rf /var/lib/postgresql /etc/postgresql

# Their apt sources and keys.
sudo rm -f /etc/apt/sources.list.d/docker.sources /etc/apt/sources.list.d/nodesource.sources /etc/apt/sources.list.d/pgdg.sources
sudo rm -f /etc/apt/keyrings/docker.asc /etc/apt/keyrings/nodesource.asc /etc/apt/keyrings/pgdg.asc
sudo apt-get update
sudo apt-get autoremove -y
```

### Compose install

In the compose folder:

- **`docker compose down`** removes the containers and keeps the database volume and the data folder: `docker compose up -d` brings the same Office back.
- **`docker compose down -v`** also deletes the database volume, `the-office_postgres-data`. A dev stack on the same machine uses the same volume, so this deletes its database too.

What `down` leaves:

- **The run environments' containers, networks, volumes and images**, labelled `office.managed=true`. If no other Office shares this Docker, remove them all:

  ```sh
  docker ps -aq --filter label=office.managed=true | xargs -r docker rm -f
  docker network ls -q --filter label=office.managed=true | xargs -r docker network rm
  docker volume ls -q --filter label=office.managed=true | xargs -r docker volume rm -f
  docker image ls -q --filter label=office.managed=true | sort -u | xargs -r docker image rm -f
  ```

  If another Office shares it, add `--filter label=office.instance=<id>` to each listing, where `<id>` is `printf %s /var/lib/the-office | sha256sum | cut -c1-12` for your data folder.

- **The images** of The Office, Postgres and Grafana:

  ```sh
  docker image ls ghcr.io/przemczan/the-office
  docker image rm ghcr.io/przemczan/the-office:1.4.0 postgres:18.6-trixie grafana/otel-lgtm:0.38.0
  ```

- **The data folder and the compose folder:**

  ```sh
  sudo rm -rf /var/lib/the-office
  rm -rf ~/the-office
  ```

### A checkout

Stop and disable its service if it has one (`sudo systemctl disable --now the-office`, then remove its unit), run `docker compose down` in the checkout (`down -v` to delete its database), then remove the checkout and the data folder named by `OFFICE_DATA_DIR` in its `.env` (by default `~/.local/share/the-office`, or `%LOCALAPPDATA%\the-office` on Windows).

## Moving from a checkout

An Office running from a checkout, with the dev stack's Postgres in Docker, as [running-the-office.md](running-the-office.md#an-example-systemd-unit) sets up, moves to a direct install or a Compose install with its database, data folder and users. Try the move on a copy first, such as a snapshot of the machine.

**Before either move,** in the checkout:

1. Choose a release no older than the checkout, so its migrations know the database. This must succeed:

   ```sh
   git fetch --tags && git merge-base --is-ancestor HEAD v1.4.0 && echo "fits"
   ```

2. Take a dump of the database, as a fallback:

   ```sh
   docker compose exec -T postgres sh -c 'pg_dump -U "$POSTGRES_USER" -d "$POSTGRES_DB" -Fc' > ~/the-office-checkout.dump
   ```

3. Note the data folder: `OFFICE_DATA_DIR` in the checkout's `.env`, or `~/.local/share/the-office` of the user that ran it. The examples use `/var/lib/the-office`. Keep the same path: the database names each Project's folder, a clone inside the data folder among them, by its path.

### To a direct install

1. Stop and disable the checkout's service:

   ```sh
   sudo systemctl disable --now the-office
   ```

2. Stop its Postgres, keeping the volume as a fallback, in the checkout:

   ```sh
   docker compose down
   ```

3. Move the checkout aside, since the installer uses `/opt/the-office`:

   ```sh
   sudo mv /opt/the-office /opt/the-office-checkout
   sudo rm /etc/systemd/system/the-office.service && sudo systemctl daemon-reload
   ```

4. Create the user the installer would, and give it the data folder, and any local Project folders outside it:

   ```sh
   sudo useradd --system --user-group --create-home --home-dir /home/the-office --shell /bin/bash the-office
   sudo chown -R the-office:the-office /var/lib/the-office
   ```

   The user must reach the folder: one inside `/root` or a closed home folder can't be reached; `namei -l /var/lib/the-office` shows each folder on the way.

5. Install with that data folder, at the version you checked:

   ```sh
   curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash -s -- --data-dir /var/lib/the-office --version 1.4.0
   ```

   It prints a setup token for its new, empty database; don't use it.

6. Put the checkout's database in place of the new one:

   ```sh
   sudo systemctl stop the-office
   sudo runuser -u postgres -- dropdb the_office
   sudo runuser -u postgres -- createdb -O office the_office
   sudo runuser -u postgres -- pg_restore --no-owner --role=office -d the_office < ~/the-office-checkout.dump
   ```

7. Copy `OFFICE_PUBLIC_ADDRESS`, any `OTEL_*` lines and anything else you set in the checkout's `.env` (not `DATABASE_URL`, `OFFICE_DATA_DIR` or the `POSTGRES_*` lines) into `/etc/the-office/office.env`, then start it:

   ```sh
   sudo systemctl start the-office
   ```

8. Sign in as before, with no setup token. Once it all works, remove `/opt/the-office-checkout` and, in it first, `docker compose down -v` for the old database.

### To a Compose install

1. Stop and disable the checkout's service:

   ```sh
   sudo systemctl disable --now the-office
   ```

2. Stop its Postgres, in the checkout. The Compose install reuses the same volume, `the-office_postgres-data`, with the database in it:

   ```sh
   docker compose down
   ```

3. Fetch the Compose install's files into a new folder ([Install with Docker Compose](#install-with-docker-compose)), and in its `.env` set `OFFICE_DATA_DIR` to the checkout's data folder and `POSTGRES_PASSWORD` to the checkout's (`POSTGRES_PASSWORD` in its `.env`), as well as the other values.

4. Give the data folder to the image's user, uid 10001:

   ```sh
   sudo chown -R 10001:10001 /var/lib/the-office
   ```

5. Start it, in the new folder:

   ```sh
   docker compose up -d
   ```

Sign in as before, with no setup token. Only Projects inside the data folder work with run environments ([above](#install-with-docker-compose)).
