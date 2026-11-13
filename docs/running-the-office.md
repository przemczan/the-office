# Running The Office

How The Office runs on a Linux host, kept running by systemd, how it is reached through a reverse proxy, how a user gets back in, and how it updates itself ([spec §5.1 Defaults](spec/5.1-shape.md#defaults), "Updating The Office").

## `npm start` runs the launcher

`npm start` (at the root, or in `apps/service`) runs the launcher, `tools/office-launcher/src/main.ts`, which Node runs with its types stripped, so nothing builds it. The launcher:

- reads `.env` at the root, as the service does;
- starts the service (`node dist/main.js` in `apps/service`) as its child, with `OFFICE_UPDATE_FOLDER` set to `<office-data>/update`;
- passes SIGTERM and SIGINT on to the service, and exits with the service's exit code;
- updates The Office when the service exits with code 75, then starts the service again.

`npm run build` must have run before the first start. `npm run dev` doesn't use the launcher, so The Office it runs refuses Update.

## An example systemd unit

`/etc/systemd/system/the-office.service`, for a checkout in `/opt/the-office` with the compose stack's Postgres beside it. It needs `docker.service`: Docker Engine at the versions [container-runtime.md](container-runtime.md) holds, which also says how to upgrade it without losing Postgres.

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

Then give The Office its public address in `.env` and restart it:

```ini
OFFICE_PUBLIC_ADDRESS=https://office.example.com
```

It is an `https://` address with no path; an invalid one stops the start with a config problem. Left blank, The Office has no public address and refuses requests to any name but `localhost`. Pages at the public address get the ways to sign in that need HTTPS and a name ([spec §2.10](spec/2.10-users-and-signing-in.md)).

## Setting a user's password on the host

A user who lost their password gets back in through a command on the host, in the checkout:

```sh
npm run set-password -- --email ada@example.com
```

It asks for the new password twice without showing it (or reads one line from standard input when that isn't a terminal), sets it, lifts the user's lockout and signs out all their signed-in devices. It reads `.env` as the service does, so it reaches the same database; the service may run meanwhile. An unknown email ends it with a message and a non-zero exit code.

## How an Office update works

1. A daily check, the first at the service's start, and **Check for updates** in Settings › Updates fetch the checkout's upstream (`@{upstream}`, normally `origin/main`) and list the commits it is behind. Nothing is installed. git runs as the service's own user with its own config: this is no Project, so the Office identity has no part in it.
2. **Update** is refused, with the reason, when the checkout has local changes to tracked files, has commits its upstream doesn't have, has no upstream, or the service runs without the launcher. On Windows, updating isn't offered.
3. Once the user schedules the update, new Starts join the queue with "An update is scheduled." and each Task waits before its next Agent or Script Stage. The update waits for an Agent mid-turn (in a Stage, a chat or a Consultation), a Script Stage, a Publish, a clone and an environment check; a Task waiting on the user, a paused Task and an idle Thread don't hold it back. Settings › Updates lists what it waits for, and the status strip shows "Update scheduled". **Cancel** releases what it held. The schedule is kept in memory, so a restart cancels it.
4. When nothing is busy, the service writes `<office-data>/update/request.json` (`{ "target": "<commit>" }`), stops gracefully and exits with code 75.
5. The launcher takes the request and runs, in the checkout, `git fetch`, `git merge --ff-only <target>`, `npm ci` and `npm run build`, each step's output going to `update/log.txt`. If one fails, it runs `git reset --hard <previous commit>`, `npm ci` and `npm run build` again. Either way it writes `update/result.json` (`outcome`, `from`, `to`, the `failedStep`, and `rollbackFailed` when going back failed too) and starts the service.
6. As it starts, the service reads `result.json`, raises a Notification ("The Office updated to …", or "The Office's update failed at …" with the log in Settings › Updates) and keeps it as `last-result.json`, so it is told once.

A stop signal during an update lets the update finish and starts nothing after it. A change to the launcher itself applies from its next start; systemd's `Restart=always` gives it one whenever the launcher exits.

`tools/deploy/update.sh` still updates the host by hand from the workstation, outside the service.
