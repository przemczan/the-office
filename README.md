# The Office

The Office is a workspace for a few signed-in users, run like an office. You hire people for Roles (a Planner, a Developer, a Reviewer, a CTO), and they are AI Agents working on your Projects. Work comes in as Tasks, each going through a Pipeline of Stages, in its own git worktree and run environment, while you make the decisions that are yours and approve what goes out.

## Install

On Debian 12/13 or Ubuntu 22.04/24.04, as a systemd service:

```sh
curl -fsSL https://github.com/przemczan/the-office/releases/latest/download/install.sh | sudo bash
```

On any Linux machine with Docker Engine and Compose, in a new folder:

```sh
curl -fsSLo docker-compose.yml https://github.com/przemczan/the-office/releases/latest/download/docker-compose.yml && curl -fsSLo .env https://github.com/przemczan/the-office/releases/latest/download/the-office.env
# fill in .env, then:
docker compose up -d
```

Either way, open the address it gives and create the first user with the setup token. [docs/installing.md](docs/installing.md) walks through both, with configuration, backups, updating and uninstalling.

**Requirements:** Linux on x64 or arm64, with systemd and root (direct install) or Docker Engine with Compose (Compose install); port 4310. The Office reaches Docker, which is root access to the machine.

On Windows and macOS, and to work on The Office itself, run it from a checkout: [docs/running-the-office.md](docs/running-the-office.md#running-from-a-checkout).

## Docs

- [Installing](docs/installing.md): both installs, first run, configuration, backups, updating, uninstalling.
- [Running The Office](docs/running-the-office.md): a checkout, a reverse proxy, signing in, telemetry, how an Office update works.
- [Container runtime](docs/container-runtime.md): the Docker Engine The Office runs on and what run environments mount.
- [Releasing](docs/releasing.md): how an Office release is cut and what it carries.
- [The spec](docs/spec/README.md): what The Office is meant to do, section by section.

## License

[GPL-3.0-only](LICENSE).
