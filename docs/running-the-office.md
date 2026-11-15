# Running The Office

Running The Office from a checkout of the repository (for development, on Windows and macOS, and for contributors), and what holds for every install: how it is reached through a reverse proxy, how a user gets back in, telemetry, and how it updates itself ([spec §5.1 Defaults](spec/5.1-shape.md#defaults), "Updating The Office").

**To install The Office on a Linux machine, use a release instead:** the direct install on Debian/Ubuntu or the Compose install, both in [installing.md](installing.md), which also covers their configuration, backups, updates and uninstalling.

## Running from a checkout

On Windows, macOS or Linux, with Node at `.nvmrc`'s version, git, and Docker with Compose (for the dev stack's Postgres and the run environments, [container-runtime.md](container-runtime.md)):

```sh
git clone https://github.com/przemczan/the-office.git
cd the-office
npm ci
cp .env.example .env
docker compose up -d --wait postgres
npm run build
npm start
```

`.env` at the root is the checkout's configuration, read by the launcher, the service, `npm run setup-token` and `npm run set-password`; its comments say what each value does. After changing it, restart `npm start`. The first start prints the address and the setup token ([First run](#first-run-the-setup-token)).

## `npm start` runs the launcher

In a checkout, `npm start` (at the root, or in `apps/service`) runs the launcher, `tools/office-launcher/src/main.ts`, which Node runs with its types stripped, so nothing builds it. The launcher:

- reads `.env` at the root, as the service does;
- starts the service (`node dist/main.js` in `apps/service`) as its child, with `OFFICE_UPDATE_FOLDER` set to `<office-data>/update`;
- passes SIGTERM and SIGINT on to the service, and exits with the service's exit code;
- updates The Office when the service exits with code 75, then starts the service again.

`npm run build` must have run before the first start. `npm run dev` doesn't use the launcher, so The Office it runs refuses Update.

## An example systemd unit

The checkout way of keeping The Office running on a Linux host; a direct install sets up its own unit ([installing.md](installing.md#install-on-debianubuntu)). `/etc/systemd/system/the-office.service`, for a checkout in `/opt/the-office` with the compose stack's Postgres beside it. It needs `docker.service`: Docker Engine at the versions [container-runtime.md](container-runtime.md) holds, which also says how to upgrade it without losing Postgres.

```ini
[Unit]
Description=The Office
After=docker.service network-online.target
Requires=docker.service

[Service]
WorkingDirectory=/opt/the-office
Environment=PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
ExecStartPre=/usr/bin/docker compose up -d --wait postgres
ExecStart=/usr/bin/npm start
Restart=always
RestartSec=5
# SIGTERM reaches the launcher alone, which passes it on to the service; whatever is left once
# the stop times out gets SIGKILL.
KillMode=mixed
# Long enough for an update under way to finish, so the checkout is never left half-built.
TimeoutStopSec=15min

[Install]
WantedBy=multi-user.target
```

Then `systemctl daemon-reload` and `systemctl enable --now the-office`. Put the user's own folders on `PATH` too when Agents need tools from them, such as `~/.local/bin`.

## Behind a reverse proxy

The Office is used at `localhost`, by IP on a trusted local network over plain HTTP (`OFFICE_HOST` set to the machine's IP address or `0.0.0.0`), or at its **public address**: HTTPS and a domain, through a reverse proxy the user sets up ([spec §5.1](spec/5.1-shape.md)). Setting up the proxy is the user's; what The Office needs from it:

- **HTTPS to the browser.** The proxy ends TLS and passes requests on to The Office's own address and port (`http://127.0.0.1:4310`) over plain HTTP.
- **The original `Host`.** The Office answers only requests addressed to `localhost`, `127.0.0.1`, the IP address it listens on, or the public address's name, so the proxy passes the browser's `Host` on unchanged (nginx: `proxy_set_header Host $host;`; Caddy does by default).
- **`X-Forwarded-Proto: https`.** A request at the public address's name counts as HTTPS only with it, and only then does the sign-in cookie get `Secure` (nginx: `proxy_set_header X-Forwarded-Proto $scheme;`; Caddy sets it).
- **WebSocket upgrades on `/api/events`.** The live updates come over a WebSocket there (nginx: `proxy_http_version 1.1;`, `proxy_set_header Upgrade $http_upgrade;` and `proxy_set_header Connection "upgrade";` in that location; Caddy passes them by default).

Then give The Office its public address in its configuration (`office.env` on a direct install, `.env` on a Compose install or in a checkout, [installing.md](installing.md#configuration)) and restart it:

```ini
OFFICE_PUBLIC_ADDRESS=https://office.example.com
```

It is an `https://` address with no path; an invalid one stops the start with a config problem. Left blank, The Office has no public address and refuses requests to any name but `localhost`. Pages at the public address get the ways to sign in that need HTTPS and a name ([spec §2.10](spec/2.10-users-and-signing-in.md)).

### Passkeys

A passkey is kept for one address, its relying party: `localhost`, or the public address's name. So passkeys need:

- **A domain name.** The public address must be a name such as `office.example.com`, not an IP address, and reached over HTTPS (with `X-Forwarded-Proto: https`, as above). At `127.0.0.1`, on a local network IP over plain HTTP, or at the public address over plain HTTP, the sign-in page and the account hide passkeys and say where they work instead.
- **The same address as when it was added.** A passkey added at `localhost` works only at `localhost` (at any port), and one added at the public address only there; a user who uses both adds one at each. Changing `OFFICE_PUBLIC_ADDRESS` to another name leaves the passkeys added at the old one useless: the account marks them as for an address no longer The Office's, to be removed, and new ones are added at the new address.

### Continue with GitHub

Users sign in with their GitHub account through the GitHub App registered for Sign in with GitHub, by its user authorization flow; there is nothing new to register. Each user links their GitHub account from their account (Account › Linked identities) first, and only a linked account signs in. It never changes Sign in with GitHub: The Office reads who the GitHub user is, revokes the token GitHub handed out at once and keeps nothing of it. What it needs of the App:

- **A callback URL for each address users sign in at.** GitHub sends the browser back only to a URL the App lists: `/api/sign-in/github/callback` on each address, such as `http://localhost:4310/api/sign-in/github/callback`, `http://192.168.1.20:4310/api/sign-in/github/callback` and `https://office.example.com/api/sign-in/github/callback`. An App registered from The Office lists the one of the address it was registered from and of the public address; Settings › Office identity lists this address's and the public address's, to add on GitHub in the App's settings under General › Identifying and authorizing users (Add Callback URL). An App lists at most 10. Sign in with GitHub's own callback stays first: GitHub sends a callback URL it doesn't list to the first one, whose page then says to add it. A user not signed in gets only the guard's refusal there, since that page needs a signed-in device; adding the URL is the fix either way.
- **Public, for anyone but its owner.** The Office registers the App as private, and GitHub lets only a private App's owner (or the members of the organization owning it) authorize it. For other users to continue with GitHub, make it public in the App's settings under Advanced › Make public. The Office kept none of the App's private key, and only linked accounts sign in.
- **Its authorization kept on the git identity's account.** Revoking the App's authorization on GitHub (Settings › Applications › Authorized GitHub Apps) from the account Sign in with GitHub uses ends that sign-in's token too.

Not yet checked on real GitHub, only against the fake one: that GitHub takes a plain-HTTP callback URL on a local network IP; whether a loopback callback (`localhost`, `127.0.0.1`) must match its port exactly; and, as the App's user tokens expire, that revoking the access token also ends the refresh token GitHub hands out with it, so that repeated Continue with GitHub from the git identity's account never reaches GitHub's ten tokens per user and App, past which it revokes the oldest, Sign in with GitHub's among them.

### Continue with Google

Users sign in with their Google account through a Google OAuth client one user registers in Google Cloud Console and enters in Settings › Signing in, one for every user. Each user links their Google account from their account (Account › Linked identities) first, and only a linked account signs in: The Office finds the user by Google's own id for the account (the ID token's `sub`), never by the email, which it keeps only to show. It asks only for `openid` and `email`, no offline access, and keeps none of Google's tokens. Registering the client:

1. In Google Cloud Console, APIs & Services › Credentials, choose Create credentials › OAuth client ID, with the application type **Web application**.
2. Under **Authorized redirect URIs**, add `/api/sign-in/google/callback` on each address users sign in at: `http://localhost:4310/api/sign-in/google/callback` (with The Office's port) and `https://office.example.com/api/sign-in/google/callback` for the public address. Google refuses an IP address and plain HTTP but on `localhost`, so never a local network IP (`192.168.1.20`) or `127.0.0.1`: Continue with Google isn't offered there, and the sign-in page and the account say to open The Office at `localhost` or the public address. Settings › Signing in lists both URIs, each with Copy. A URI the client doesn't list makes Google refuse with `redirect_uri_mismatch`.
3. Copy the client ID and client secret into Settings › Signing in and save. The secret is kept as the GitHub App's is and never shown again; saving with the secret left empty keeps it, so only the client ID changes.
4. On the **OAuth consent screen**, choose External, with the scopes `openid` and `email`. While the app is in Testing, Google lets only its test users sign in: add each user's Google account there. Or publish it: these scopes need no verification by Google.

Removing the client in Settings › Signing in takes Continue with Google off the sign-in page and keeps the linked Google accounts, which sign in again once a client is saved, since Google's `sub` for an account doesn't depend on the client.

Not yet checked on real Google, only with Google's endpoints stubbed and its authorize page caught in the e2e test.

## First run: the setup token

The installer creates no user. The first person to open The Office creates their own account, and only with the **setup token**, so whoever reaches it first over the network can't claim it. The direct installer prints one itself; otherwise the service's first start prints one to its standard output, with the address to open, so `docker compose logs office` or the checkout's terminal shows it:

```text
The Office waits for its first user. Open http://localhost:4310 and give it this setup token:

    ABCD-EFGH-JKMN-PQRS-TUVW-XYZ2
```

A start with a token already waiting prints none, only how to get one, so a restart never replaces the one an installer printed. For a lost token on a direct or Compose install, see [installing.md](installing.md#a-new-setup-token); in a checkout, run:

```sh
npm run setup-token
```

It prints a new token and where to open The Office, and ends any earlier token. `npm run --silent setup-token -- --quiet` prints the token alone, for an installer to read (or `node apps/service/dist/setup-token.js --quiet` after a build). It runs the database's migrations first, so it works before the first start. Once a user exists it makes no token and exits with 1, pointing to `npm run set-password`; other arguments exit with 2. The Office keeps only the token's hash, and the first user uses it up.

After the first user, First-run setup walks through the basics, each skippable ([installing.md](installing.md#first-run)). An automated install sets `OFFICE_SKIP_SETUP_BASICS=true` to leave the basics out; the setup token and the first user are still asked for.

## Telemetry

Telemetry is a setting, in First-run setup and in Settings › Telemetry: Off, Bundled Grafana (the bundled Grafana's OTLP endpoint at `http://127.0.0.1:4318`, with a 2-second export timeout), or Your own endpoint, an OTLP over HTTP base URL with optional headers (such as an API key) and an optional export timeout (10 seconds when left empty). The choice is saved as `telemetry.json` in the Office data directory, readable by its owner only, since headers can hold credentials; the browser is only ever sent a header's name. A change applies the next time The Office starts.

When `OTEL_SDK_DISABLED`, `OTEL_EXPORTER_OTLP_ENDPOINT` or `OTEL_EXPORTER_OTLP_HEADERS` is set in the environment, such as in `.env`, the environment wins: the exporters read the standard OTEL_* variables, `OTEL_SDK_DISABLED=true` turns telemetry off, and the card says so, read-only. With neither a variable nor a saved setting, or with a `telemetry.json` that can't be read, telemetry is off and The Office still starts.

## Setting a user's password on the host

A user who lost their password gets back in through a command on the host. In a checkout:

```sh
npm run set-password -- --email ada@example.com
```

On a direct install it runs as the user `the-office` with `office.env`'s settings, and on a Compose install in the `office` container; [installing.md](installing.md#setting-a-users-password-on-the-host) gives both commands.

It asks for the new password twice without showing it (or reads one line from standard input when that isn't a terminal), sets it, lifts the user's lockout and signs out all their signed-in devices. It reads the configuration as the service does, so it reaches the same database; the service may run meanwhile. An unknown email ends it with a message and a non-zero exit code.

For a user who lost their authenticator and their recovery codes too, `--clear-authenticator` also removes both, so they sign in with the new password alone and can set up an authenticator again:

```sh
npm run set-password -- --email ada@example.com --clear-authenticator
```

## Which version runs

Settings › Updates' Version card shows the commit The Office runs. An Office release shows its version before it (`1.2.3 · <commit>`), read from the `office-release.json` it carries, and its log says "The Office 1.2.3 (<commit>)" at each start ([releasing.md](releasing.md)); a checkout shows its commit alone.

The note at the top of Settings › Updates says how The Office was installed, which decides how it updates. The service reads it from `OFFICE_INSTALL`:

| Install | Set by | Updates by |
| --- | --- | --- |
| A checkout (`npm start` from git, on Linux, Windows or a dev machine) | nothing: the default | the launcher's git update |
| A release (the direct install: a tarball under `releases/`, run by its launcher) | the launcher, `release` for its child | the launcher installing a newer tarball |
| A container (the Compose install) | the image, `ENV OFFICE_INSTALL=container` | the Office updater |

A copy of a release that its launcher didn't start from a `releases/` folder is refused Update: "This copy of The Office wasn't installed into a releases folder, so it can't update itself."

## How an Office update works

### What every install shares

1. A daily check, the first at the service's start, and **Check for updates** in Settings › Updates look for something newer. Nothing is installed. A check that can't read what it looks for shows its problem, and installs nothing.
2. **Update** is refused, with the reason that says what to do (below, per install). On Windows, updating isn't offered.
3. Once the user schedules the update, new Starts join the queue with "An update is scheduled." and each Task waits before its next Agent or Script Stage. The update waits for an Agent mid-turn (in a Stage, a chat or a Consultation), a Thread of any kind whose background Sub-agents still run after its turn (a planning Thread's research, say), a Script Stage, a Publish, a clone and an environment check; a Task waiting on the user, a paused Task and an idle Thread with no Sub-agent running don't hold it back. Any other restart stops background Sub-agents; a planning Thread that loses them, or is cut mid-turn, has its planner woken again as the service starts. Settings › Updates lists what it waits for, and the status strip shows "Update scheduled". **Cancel** releases what it held. The schedule is kept in memory, so a restart cancels it.
4. When nothing is busy, the service writes `<office-data>/update/request.json` and hands the update over: to the launcher by exiting with code 75, or to the Office updater in a container.
5. Whatever carries it out writes `update/log.txt`, each step's output, and `update/result.json`: `outcome`, `from` and `to` (a commit or a version), the `failedStep`, and `rollbackFailed` when going back failed too.
6. As it starts, the service reads `result.json`, raises a Notification ("The Office updated to …", or "The Office's update failed at …" with the log in Settings › Updates) and keeps it as `last-result.json`, so it is told once. A commit is named by its first 7 characters, a version whole.

A rollback puts the previous code back, never the database: a migration the newer version ran stays. So each release's migrations keep the previous release working (expand, then contract), and going back stays safe.

### A checkout

1. The check fetches the checkout's upstream (`@{upstream}`, normally `origin/main`) and lists the commits it is behind. git runs as the service's own user with its own config: this is no Project, so the Office identity has no part in it.
2. Update is refused when the checkout has local changes to tracked files, has commits its upstream doesn't have, has no upstream, or the service runs without the launcher.
3. The request is `{ "kind": "commit", "target": "<commit>" }`. The launcher takes it and runs, in the checkout, `git fetch`, `git merge --ff-only <target>`, `npm ci` and `npm run build`. If one fails, it runs `git reset --hard <previous commit>`, `npm ci` and `npm run build` again. Either way it starts the service. The steps a failure names: `fetch`, `merge`, `install`, `build`.

`tools/deploy/update.sh` still updates a checkout host by hand from the workstation, outside the service.

### A release install (a tarball)

A direct install ([installing.md](installing.md#install-on-debianubuntu)). The layout the installer sets up, owned by the service's user so the launcher can switch it:

```
/opt/the-office/
  releases/
    1.3.0/          one unpacked tarball per version (no "v")
    1.4.0/
  current -> releases/1.4.0
```

Its unit, `/etc/systemd/system/the-office.service`, starts the launcher of the release `current` points at, and its config comes from `/etc/the-office/office.env`, which only root reads (systemd reads it for the service, which never opens the file):

```ini
[Service]
EnvironmentFile=/etc/the-office/office.env
ExecStart=/usr/bin/node /opt/the-office/current/tools/office-launcher/src/main.ts
Restart=always
RestartSec=5
KillMode=mixed
TimeoutStopSec=15min
```

The launcher knows it runs a release when the folder it was loaded from carries `office-release.json`, sits in a `releases` folder, and `current` beside that folder is a link. It then sets `OFFICE_INSTALL=release` for the service, and starts the service from `current` each time.

1. The check reads the GitHub Releases of the repository the release's `office-release.json` names (`repository`, set when the release was packed): `GET {OFFICE_GITHUB_API_URL}/repos/<repository>/releases?per_page=30`, without signing in, given up after 30 seconds. Drafts, pre-releases and tags that aren't a version (`v1.2.3`) are left out; each version newer than the one running is listed, newest first, with its notes. "GitHub Releases couldn't be read: …" is the check's problem when the read fails.
2. Update is refused when the service runs without its launcher or outside a `releases` folder, when the stamp names no repository, or when the newest release has no `the-office-<version>-linux-<cpu>.tar.gz` and its `.sha256` for this machine's CPU.
3. The request is `{ "kind": "release", "version", "from", "tarballUrl", "checksumUrl" }` (https only). The service exits with code 75, and the launcher runs, each step in `log.txt`:
   1. **download**: the tarball and its `.sha256` into `update/downloads/`;
   2. **verify**: the tarball's sha256 matches its line in `.sha256`, for that file name; once unpacked, its top folder is `the-office-<version>` and its `office-release.json` says that version;
   3. **unpack**: into `releases/.unpack-<version>`, renamed to `releases/<version>` (a folder left by a failed attempt is replaced);
   4. **switch**: `current.next` is written and renamed over `current`, so the switch is all or nothing;
   5. **start**: `result.json` says `updated` first, then the service starts from `current`, and the launcher waits up to 5 minutes for `/api/health` to answer `{"database":"up"}` (on `127.0.0.1` when the service listens on `0.0.0.0` or `::`), or for the service to end. The launcher finds the address in its own environment, so `OFFICE_PORT` (and `OFFICE_HOST`, if set) belong in the unit's `EnvironmentFile`; without `OFFICE_PORT` the update fails at `start` before anything is downloaded.
4. A failure before the switch changes nothing: the previous version starts again. A failure at the start stops the new service, switches `current` back to `releases/<from>`, writes `failed` at `start` (`rollbackFailed` when switching back failed too) and starts the previous version.
5. After a good update the launcher keeps `current`'s release, the one before it and the one the running launcher was loaded from, removes the other releases, and empties `downloads/`.

The launcher keeps running the code it was loaded from: the new release's launcher takes over at the unit's next start. A stop signal during an update lets the update finish and starts nothing after it; systemd's `Restart=always` starts the launcher again whenever it exits.

### A Docker Compose install (a container)

The compose folder holds `docker-compose.yml` and `.env`, and the image's tag comes only from `OFFICE_VERSION` in `.env`. The Compose project is `the-office`, its service `office`, with Docker's socket at `/var/run/docker.sock` (and its group through `group_add`), the Office data folder mounted at the same path on the host and in the container, `restart: unless-stopped`, `stop_grace_period: 1m` and the image's `HEALTHCHECK`.

1. The check reads GitHub Releases as a release install does.
2. Update is refused when the service can't reach Docker's socket, when its container wasn't started by Docker Compose (the refusal gives the commands to run by hand: `docker pull <image>:<version>`, then `OFFICE_VERSION=<version>` in `.env` and `docker compose up -d office` in the compose folder), or when the compose files lie outside the compose project's folder.
3. The request is `{ "kind": "container", "version", "from", "image" }` in `<OFFICE_DATA_DIR>/update`. The service doesn't exit: it starts the **Office updater**, a short-lived container of the image it runs itself (`docker run -d --rm --label org.the-office.updater=1 --user 0:0`), with the socket, the compose folder and the data folder mounted, running `tools/office-launcher/src/container-main.ts`. The updater:
   1. reads the Office container with `docker inspect`, and its Compose labels: project, service, working folder, compose files and env file;
   2. **download**: `docker pull <image>:<version>`;
   3. **switch**: sets `OFFICE_VERSION=<version>` in `.env` (the env file Compose names, else `.env` in the working folder), in place, keeping its other lines, owner and mode; `docker compose config` must then give the office service the image `…:<version>`, else `.env` is put back and the update fails;
   4. **start**: writes `result.json` `updated`, runs `docker compose -p <project> --project-directory <folder> -f <file> up -d --no-deps office`, which replaces only the Office container, and waits up to 5 minutes for the new one to be `healthy`;
   5. on a failure after the switch, sets `OFFICE_VERSION=<from>` again, runs `up -d --no-deps office` again, and writes `failed` (`rollbackFailed` when that fails too);
   6. gives `result.json` and `log.txt` to the update folder's owner, so the service reads them.
4. When the updater ends while the service that started it still runs, the update failed before replacing it: the service announces the result, releases the scheduled update's hold, and the queue goes on, with no restart. When the updater can't be started, the update stays scheduled, and the log says why.
