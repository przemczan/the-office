# Releasing The Office

An **Office release** is a version of The Office cut from `main`: the tag `v<version>`, a GitHub Release whose notes are its commits, two tarballs and a container image. Only the **Release** workflow ([.github/workflows/release.yml](../.github/workflows/release.yml)) cuts one, run by hand; nobody tags or publishes a release otherwise. Installing a release and moving to a newer one are the installers' and Self-update's part; an Office update ([running-the-office.md](running-the-office.md)) still moves a checkout to its upstream's newest commit.

## What a release carries

- **The tag `v<version>`** on `main`'s commit. Nothing is committed back: no changelog file, no version bump in `package.json`.
- **A GitHub Release** whose notes list the subjects of the `feat`, `fix`, `perf` and `refactor` commits since the last `v*` tag, under Features, Fixes, Performance and Refactoring, with breaking changes on top. Other types (`docs`, `test`, `build`, `ci`, `chore`, `style`) aren't listed.
- **Two tarballs**, `the-office-<version>-linux-x64.tar.gz` and `the-office-<version>-linux-arm64.tar.gz`, each with a `.sha256` that `sha256sum -c` checks.
- **The image** `ghcr.io/<owner>/the-office:<version>` and `:latest`, for `linux/amd64` and `linux/arm64`.

**Linux only.** The tarballs are for glibc Linux on x64 and arm64 (Debian, Ubuntu and the like; not Alpine), and the image for amd64 and arm64. Windows and macOS keep running The Office from a checkout ([running-the-office.md](running-the-office.md)).

## Running Release

In GitHub, **Actions › Release › Run workflow** on `main`. It:

1. takes the next version from the Conventional Commits since the last `v*` tag (AGENTS.md, "Commits and releases"): a breaking change raises the major, a `feat` the minor, a `fix`, `perf` or `refactor` the patch. **With none of those since the last tag, nothing is released**: the run ends green with no tag, release or image;
2. runs `npm ci && npm run verify` in the run environment, the `checks` service of [.devcontainer/compose.yaml](../.devcontainer/compose.yaml), on a copy of the checkout ([tools/release/verify.sh](../tools/release/verify.sh)). A failure ends the run there: no tag, no release, no image;
3. builds, packs both tarballs, starts the x64 tarball against a throwaway Postgres with the [service start check](../tools/service-start-check/src/main.ts), builds the amd64 image and checks it ([tools/release/image-check.sh](../tools/release/image-check.sh)), then pushes `:<version>` for both platforms ([tools/release/prepare.sh](../tools/release/prepare.sh));
4. pushes the tag, moves `:latest` to the version ([tools/release/publish-image.sh](../tools/release/publish-image.sh)) and makes the GitHub Release with the tarballs and their checksums.

The image check starts the image as an install would and asserts: `/api/health` answers `{"database":"up"}` and `/` serves the web app; the first start's logs hold the setup token, and `docker exec <container> npm run setup-token -- --quiet` prints a new one; the service doesn't run as root; `git`, `ssh`, `docker`, `docker compose`, `docker buildx` and Claude Code answer `--version`; `docker stop` ends it with exit status 143.

**The Dry run** (tick "Dry run" when running it) does steps 2 and 3 for the version `0.0.0-dry-run.<short commit>` without pushing the image, and keeps the two tarballs as the run's artifact for a week. It makes no tag, no release and pushes nothing. Run one before a release whenever the release tooling, the Dockerfile or the build changed.

The run needs nothing set up: it signs in to GHCR and GitHub with the workflow's own `GITHUB_TOKEN`. semantic-release and its plugins are pinned in [tools/release/semantic-release/](../tools/release/semantic-release/package.json), installed apart from the workspaces; the workflow's actions are pinned by commit.

## The tarball

`npm run pack-release -- --version <version> --arch x64|arm64`, after `npm ci && npm run build` on Linux, writes `dist/release/the-office-<version>-linux-<arch>.tar.gz` and its `.sha256` ([tools/release/src/pack.ts](../tools/release/src/pack.ts)). It unpacks to one folder, `the-office-<version>/`, laid out as the checkout is:

- `package.json`: the root's at the version, with the workspaces it carries and the scripts `start`, `set-password` and `setup-token`;
- `office-release.json`: the version and the commit it was built from, with its date and subject. The service reads it: Settings › Updates shows `1.2.3 · <commit>`, and the log at start says "The Office 1.2.3 (<commit>)";
- `apps/service/` (`dist/` and the `drizzle/` migrations), `apps/web/dist/`, `packages/contracts/dist/`, `tools/office-launcher/src/`, `LICENSE` and `.env.example`;
- `node_modules/`: the production packages at the lockfile's versions, with Claude Code for the tarball's CPU alone (the SDK's glibc build).

The pack refuses a devDependency in `node_modules`, a package at a version other than the lockfile's, a missing Claude Code build, or another platform's. Nothing is built or installed on the target: it needs Node 22 (`.nvmrc`'s major), a Postgres reached at `DATABASE_URL`, git and ssh, and the Docker CLI with Compose and buildx for the run environments ([container-runtime.md](container-runtime.md)). `node apps/service/dist/main.js` in the folder starts the service.

## The image

[The Dockerfile](../Dockerfile) unpacks the tarball for its platform into `/opt/the-office`, so the image and the tarball are the same bits, over `node:22-trixie-slim` (pinned by digest) with git, the ssh client, tini and Docker's CLI, Compose and buildx at the versions [container-runtime.md](container-runtime.md) holds; no Docker daemon. The service runs as `office` (uid 10001), which owns the Office data folder `/var/lib/the-office`; it listens on `0.0.0.0:4310`, and its health check asks `/api/health`. There is no launcher in the image. Mounting the Docker socket and the data folder is the Docker Compose install's part.

## The first release

`main`'s history from before releases holds hundreds of `feat:` and `fix:` commits and The Office's Stage commits. While no `v*` tag exists, only the commits made after the one that added `.releaserc.json` count for the version and the notes ([tools/release/src/release-commits.ts](../tools/release/src/release-commits.ts)); a commit merged in from older history doesn't count either. So the first release comes from one hand-written commit:

1. Publish the Installation of The Office Initiative to `main`, which brings this workflow there (GitHub offers Run workflow only for a workflow on the default branch).
2. Run a **Dry run** on `main`. A normal run now would release nothing: no commit counts yet.
3. On `main`: `git commit --allow-empty -m "feat: The Office installs from released versions, as a tarball or a container image"`, and push it.
4. Run **Release**: it makes `v1.0.0`, whose notes list only that commit.
5. In GitHub, **Packages › the-office › Package settings**, make the image public, once.
6. From then on the Conventional Commits check covers every commit reaching `main` after the tag (AGENTS.md, "Commits and releases").
