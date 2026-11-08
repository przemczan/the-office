# Running The Office

How The Office runs on a Linux host, kept running by systemd, and how it updates itself ([spec §5.1 Defaults](spec/5.1-shape.md#defaults), "Updating The Office").

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

## How an Office update works

1. A daily check, the first at the service's start, and **Check for updates** in Settings › Updates fetch the checkout's upstream (`@{upstream}`, normally `origin/main`) and list the commits it is behind. Nothing is installed. git runs as the service's own user with its own config: this is no Project, so the Office identity has no part in it.
2. **Update** is refused, with the reason, when the checkout has local changes to tracked files, has commits its upstream doesn't have, has no upstream, or the service runs without the launcher. On Windows, updating isn't offered.
3. Once the user schedules the update, new Starts join the queue with "An update is scheduled." and each Task waits before its next Agent or Script Stage. The update waits for an Agent mid-turn (in a Stage, a chat or a Consultation), a Script Stage, a Publish, a clone and an environment check; a Task waiting on the user, a paused Task and an idle Thread don't hold it back. Settings › Updates lists what it waits for, and the status strip shows "Update scheduled". **Cancel** releases what it held. The schedule is kept in memory, so a restart cancels it.
4. When nothing is busy, the service writes `<office-data>/update/request.json` (`{ "target": "<commit>" }`), stops gracefully and exits with code 75.
5. The launcher takes the request and runs, in the checkout, `git fetch`, `git merge --ff-only <target>`, `npm ci` and `npm run build`, each step's output going to `update/log.txt`. If one fails, it runs `git reset --hard <previous commit>`, `npm ci` and `npm run build` again. Either way it writes `update/result.json` (`outcome`, `from`, `to`, the `failedStep`, and `rollbackFailed` when going back failed too) and starts the service.
6. As it starts, the service reads `result.json`, raises a Notification ("The Office updated to …", or "The Office's update failed at …" with the log in Settings › Updates) and keeps it as `last-result.json`, so it is told once.

A stop signal during an update lets the update finish and starts nothing after it. A change to the launcher itself applies from its next start; systemd's `Restart=always` gives it one whenever the launcher exits.

`tools/deploy/update.sh` still updates the host by hand from the workstation, outside the service.
