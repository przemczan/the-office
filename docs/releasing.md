# Releasing The Office

Installing, updating and removing a release is in [installing.md](installing.md); this page is about cutting one.

An **Office release** is a version of The Office cut from `main`: the tag `v<version>`, a GitHub Release whose notes are its commits, two tarballs and a container image. Only the **Release** workflow ([.github/workflows/release.yml](../.github/workflows/release.yml)) cuts one, run by hand; nobody tags or publishes a release otherwise. Installing a release and moving to a newer one are the installers' and Self-update's part; an Office update ([running-the-office.md](running-the-office.md)) moves a checkout to its upstream's newest commit.

## What a release carries

- **The tag `v<version>`** on `main`'s commit. Nothing is committed back: no changelog file, no version bump in `package.json`.
- **A GitHub Release** whose notes list the subjects of the `feat`, `fix`, `perf` and `refactor` commits since the last `v*` tag, under Features, Fixes, Performance and Refactoring, with breaking changes on top. Other types (`docs`, `test`, `build`, `ci`, `chore`, `style`) aren't listed.
- **Two tarballs**, `the-office-<version>-linux-x64.tar.gz` and `the-office-<version>-linux-arm64.tar.gz`, each with a `.sha256` that `sha256sum -c` checks.
- **The image** `ghcr.io/<owner>/the-office:<version>` and `:latest`, for `linux/amd64` and `linux/arm64`.
- **`install.sh`**, the Debian/Ubuntu installer ([tools/install/install.sh](../tools/install/install.sh)), stamped with the release's version and repository (`GITHUB_REPOSITORY`), so `curl -fsSL https://github.com/<owner>/<repo>/releases/latest/download/install.sh | sudo bash` installs the newest release ([spec §5.1](spec/5.1-shape.md#defaults), "Installing on Debian/Ubuntu"). The prepare step replaces its `@OFFICE_VERSION@` and `@OFFICE_REPOSITORY@` and fails if a placeholder is left; the Dry run keeps it with the tarballs.

- **The Compose install's files**, `docker-compose.yml` and `the-office.env` (the checkout's [deploy/compose/](../deploy/compose/docker-compose.yml) `docker-compose.yml` and `.env.example`, [spec §5.1](spec/5.1-shape.md#defaults), "Installing with Docker Compose"), with `OFFICE_VERSION` set to the release in `the-office.env` by `npm run compose-assets -- --version <version>` ([tools/release/src/compose-assets.ts](../tools/release/src/compose-assets.ts)), which refuses a template without exactly one `OFFICE_VERSION=` line. GitHub renames an asset whose name starts with a dot, hence `the-office.env`. In a new folder, the newest release's are fetched with

  ```sh
  curl -fsSLo docker-compose.yml https://github.com/przemczan/the-office/releases/latest/download/docker-compose.yml && curl -fsSLo .env https://github.com/przemczan/the-office/releases/latest/download/the-office.env
  ```

  or a given version's at `https://github.com/przemczan/the-office/releases/download/v<version>/docker-compose.yml` and `…/v<version>/the-office.env`.

**Linux only.** The tarballs are for glibc Linux on x64 and arm64 (Debian, Ubuntu and the like; not Alpine), and the image for amd64 and arm64. Windows and macOS keep running The Office from a checkout ([running-the-office.md](running-the-office.md)).

## Running Release

In GitHub, **Actions › Release › Run workflow** on `main`. It:

1. takes the next version from the Conventional Commits since the last `v*` tag (AGENTS.md, "Commits and releases"): a breaking change raises the major, a `feat` the minor, a `fix`, `perf` or `refactor` the patch. **With none of those since the last tag, nothing is released**: the run ends green with no tag, release or image;
2. runs `npm ci && npm run verify` in the run environment, the `checks` service of [.devcontainer/compose.yaml](../.devcontainer/compose.yaml), on a copy of the checkout ([tools/release/verify.sh](../tools/release/verify.sh)). A failure ends the run there: no tag, no release, no image;
3. builds, packs both tarballs, stamps `install.sh`, writes the Compose install's files, starts the x64 tarball against a throwaway Postgres with the [service start check](../tools/service-start-check/src/main.ts), builds the amd64 image and checks it ([tools/release/image-check.sh](../tools/release/image-check.sh)), brings the Compose install up with that image ([tools/release/compose-check.sh](../tools/release/compose-check.sh)), then pushes `:<version>` for both platforms ([tools/release/prepare.sh](../tools/release/prepare.sh));
4. pushes the tag, moves `:latest` to the version ([tools/release/publish-image.sh](../tools/release/publish-image.sh)) and makes the GitHub Release with the tarballs, their checksums, `install.sh`, `docker-compose.yml` and `the-office.env`.

The image check starts the image as an install would and asserts: `/api/health` answers `{"database":"up","testInstance":false}` and `/` serves the web app; the first start's logs hold the setup token, and `docker exec <container> npm run setup-token -- --quiet` prints a new one; the service doesn't run as root; `git`, `ssh`, `docker`, `docker compose`, `docker buildx` and Claude Code answer `--version`; `docker stop` ends it with exit status 143.

The Compose check brings the install up from the stamped `docker-compose.yml` and `the-office.env` in a new folder, with the checked image as `OFFICE_IMAGE`, a random database password, the runner socket's group, port 4393 and a data folder that doesn't exist yet, and asserts: `docker compose config` and `up --wait` succeed; `/api/health` answers `{"database":"up","testInstance":false}` at `127.0.0.1:4393`; `docker compose logs office` holds the setup token and `docker compose exec office npm run setup-token -- --quiet` prints a new one; The Office runs as uid 10001 and `docker version` in it reaches the daemon; the data folder's top is uid 10001's, and a file The Office writes there is seen by another container mounting the same path. It then moves `OFFICE_VERSION` to a second tag of the same image and runs `docker compose up -d --no-deps office`, as the Office updater does, asserting only The Office was recreated and is healthy, and takes it all down with its volume.

**The Dry run** (tick "Dry run" when running it) does steps 2 and 3 for the version `0.0.0-dry-run.<short commit>` without pushing the image, and keeps the two tarballs, `install.sh` and the Compose install's files as the run's artifact for a week. It makes no tag, no release and pushes nothing. Run one before a release whenever the release tooling, the Dockerfile or the build changed.

The run needs nothing set up: it signs in to GHCR and GitHub with the workflow's own `GITHUB_TOKEN`. semantic-release and its plugins are pinned in [tools/release/semantic-release/](../tools/release/semantic-release/package.json), installed apart from the workspaces; the workflow's actions are pinned by commit.

## The tarball

`npm run pack-release -- --version <version> --arch x64|arm64`, after `npm ci && npm run build` on Linux, writes `dist/release/the-office-<version>-linux-<arch>.tar.gz` and its `.sha256` ([tools/release/src/pack.ts](../tools/release/src/pack.ts)). It unpacks to one folder, `the-office-<version>/`, laid out as the checkout is:

- `package.json`: the root's at the version, with the workspaces it carries and the scripts `start`, `set-password` and `setup-token`;
- `office-release.json`: the version and the commit it was built from, with its date and subject. The service reads it: Settings › Updates shows `1.2.3 · <commit>`, and the log at start says "The Office 1.2.3 (<commit>)";
- `apps/service/` (`dist/` and the `drizzle/` migrations), `apps/web/dist/`, `packages/contracts/dist/`, `tools/office-launcher/src/`, `tools/device-helper/dist/` (the device helper's static binaries for x86_64 and aarch64 and its `version` file, built with the release's version by `prepare.sh`, which needs Go from the workflow's `actions/setup-go`), `LICENSE` and `.env.example`;
- the knowledge base every Brief names, `docs/spec/` and `GLOSSARY.md`, at the checkout's paths so the spec's links to the glossary hold; `docs/design/`, the mock-ups, stays out;
- `node_modules/`: the production packages at the lockfile's versions, with Claude Code for the tarball's CPU alone (the SDK's glibc build).

The pack refuses a devDependency in `node_modules`, a package at a version other than the lockfile's, a missing Claude Code build, or another platform's. Nothing is built or installed on the target: it needs Node 22 (`.nvmrc`'s major), a Postgres reached at `DATABASE_URL`, git and ssh, and the Docker CLI with Compose and buildx for the run environments ([container-runtime.md](container-runtime.md)). `node apps/service/dist/main.js` in the folder starts the service.

## The image

[The Dockerfile](../Dockerfile) unpacks the tarball for its platform into `/opt/the-office`, so the image and the tarball are the same bits, over `node:22-trixie-slim` (pinned by digest) with git, the ssh client, tini and Docker's CLI, Compose and buildx at the versions [container-runtime.md](container-runtime.md) holds; no Docker daemon. The service runs as `office` (uid 10001), which owns the Office data folder `/var/lib/the-office`; it listens on `0.0.0.0:4310` unless `OFFICE_HOST` and `OFFICE_PORT` say otherwise, and its health check asks `/api/health`. There is no launcher in the image. Its health check asks at `OFFICE_HOST` and `OFFICE_PORT` (`127.0.0.1` when the service listens on every address), so it follows a Compose install on the host's network. Mounting the Docker socket and the data folder is the Compose install's part ([container-runtime.md](container-runtime.md), "The Office in a container").

## The first release

`main`'s history from before releases holds hundreds of `feat:` and `fix:` commits and The Office's Stage commits. While no `v*` tag exists, only the commits made after the one that added `.releaserc.json` count for the version and the notes ([tools/release/src/release-commits.ts](../tools/release/src/release-commits.ts)); a commit merged in from older history doesn't count either. So the first release comes from one hand-written commit:

1. Run a **Dry run** on `main`. A normal run now would release nothing: no commit counts yet.
2. On `main`: `git commit --allow-empty -m "feat: The Office installs from released versions, as a tarball or a container image"`, and push it.
3. Run **Release**: it makes `v1.0.0`, whose notes list only that commit.
4. In GitHub, **Packages › the-office › Package settings**, make the image public, once.
5. From then on the Conventional Commits check covers every commit reaching `main` after the tag (AGENTS.md, "Commits and releases").
