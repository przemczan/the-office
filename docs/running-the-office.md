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

## Setting a user's password on the host

A user who lost their password gets back in through a command on the host, in the checkout:

```sh
npm run set-password -- --email ada@example.com
```

It asks for the new password twice without showing it (or reads one line from standard input when that isn't a terminal), sets it, lifts the user's lockout and signs out all their signed-in devices. It reads `.env` as the service does, so it reaches the same database; the service may run meanwhile. An unknown email ends it with a message and a non-zero exit code.

For a user who lost their authenticator and their recovery codes too, `--clear-authenticator` also removes both, so they sign in with the new password alone and can set up an authenticator again:

```sh
npm run set-password -- --email ada@example.com --clear-authenticator
```

## Which version runs

Settings › Updates' Version card shows the commit The Office runs. An Office release shows its version before it (`1.2.3 · <commit>`), read from the `office-release.json` it carries, and its log says "The Office 1.2.3 (<commit>)" at each start ([releasing.md](releasing.md)); a checkout shows its commit alone.

## How an Office update works

1. A daily check, the first at the service's start, and **Check for updates** in Settings › Updates fetch the checkout's upstream (`@{upstream}`, normally `origin/main`) and list the commits it is behind. Nothing is installed. git runs as the service's own user with its own config: this is no Project, so the Office identity has no part in it.
2. **Update** is refused, with the reason, when the checkout has local changes to tracked files, has commits its upstream doesn't have, has no upstream, or the service runs without the launcher. On Windows, updating isn't offered.
3. Once the user schedules the update, new Starts join the queue with "An update is scheduled." and each Task waits before its next Agent or Script Stage. The update waits for an Agent mid-turn (in a Stage, a chat or a Consultation), a Thread of any kind whose background Sub-agents still run after its turn (a planning Thread's research, say), a Script Stage, a Publish, a clone and an environment check; a Task waiting on the user, a paused Task and an idle Thread with no Sub-agent running don't hold it back. Any other restart stops background Sub-agents; a planning Thread that loses them, or is cut mid-turn, has its planner woken again as the service starts. Settings › Updates lists what it waits for, and the status strip shows "Update scheduled". **Cancel** releases what it held. The schedule is kept in memory, so a restart cancels it.
4. When nothing is busy, the service writes `<office-data>/update/request.json` (`{ "target": "<commit>" }`), stops gracefully and exits with code 75.
5. The launcher takes the request and runs, in the checkout, `git fetch`, `git merge --ff-only <target>`, `npm ci` and `npm run build`, each step's output going to `update/log.txt`. If one fails, it runs `git reset --hard <previous commit>`, `npm ci` and `npm run build` again. Either way it writes `update/result.json` (`outcome`, `from`, `to`, the `failedStep`, and `rollbackFailed` when going back failed too) and starts the service.
6. As it starts, the service reads `result.json`, raises a Notification ("The Office updated to …", or "The Office's update failed at …" with the log in Settings › Updates) and keeps it as `last-result.json`, so it is told once.

A stop signal during an update lets the update finish and starts nothing after it. A change to the launcher itself applies from its next start; systemd's `Restart=always` gives it one whenever the launcher exits.

`tools/deploy/update.sh` still updates the host by hand from the workstation, outside the service.
