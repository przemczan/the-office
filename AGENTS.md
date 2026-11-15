# The Office

A workspace for a few users, each signed in, run like an office, built from [the spec](docs/spec/README.md). New work comes in through The Office itself, as Tasks.

## Every session

Load only what the Task needs: whatever a session reads stays in its context and is paid for on every later call.

1. Before changing a module or a surface, read its `MAP.md` (`apps/service/src/modules/<module>/`, `apps/service/src/platform/`, `apps/web/src/`, `apps/web/src/surfaces/<surface>/`, `apps/web/e2e/`, `packages/contracts/src/`): what it owns, what it talks to and its traps, then its routes, events, tables and files. From there, find symbols with LSP and read code by range.
2. In the click-through, grep the function the Task names and read only its range, never a whole file.
3. Read the rest only when the Task needs it:
   - the [glossary](GLOSSARY.md), when naming something new;
   - the [UI rules](docs/spec/4.1-ui-rules.md), before building or changing anything the user sees;
   - a section from [the spec's index](docs/spec/README.md), when the cited sections leave a question open;
   - the [module template](apps/service/docs/module-template.md), when adding a module or a kind of file a module doesn't have yet, or when a boundary lint error is unclear; [testing](apps/service/docs/testing.md), before a kind of test the module doesn't have yet, a live check or a check on the Test Project.
4. When a change touches a module's or surface's files, `npm run maps` refreshes the generated part of its map; update the handwritten part when what it owns, what it talks to or a trap changed.
5. While working, run only the tests of the module or surface being changed; never `npm run verify` (or `test:e2e`) in the middle of the work. Inside a Stage of The Office, whose message lists the Stages after it, `npm run verify` is left to the later Stage that runs it, and the Agent doesn't run it; it runs only the tests of what it changed. When no later Stage runs it, the Agent runs the full `npm run verify` once the work is written, in the Task's run environment (`.devcontainer/`, Linux with a Postgres of its own) through the Office tool, and reruns it only after fixing what it found; on the workstation it runs on the host. `verify` runs the default run (critical and smoke tests); the full run (`test:full`, `test:e2e:full`, `verify:full`) is on demand ([testing](apps/service/docs/testing.md)).

## Project layout and defaults

Choices the spec leaves open. Change one only with the user, and update this list in the same change.

- **Windows and Linux:** The Office runs on both ([spec §5.1](docs/spec/5.1-shape.md)). Operating-system differences live only in the service's `src/platform/os/`. `npm run verify` passes on both: an Agent runs it in the Task's run environment, Linux built from `.devcontainer/` (Node at `.nvmrc`'s version, Playwright's Chromium built in, a Postgres of its own), and on the Windows workstation it runs on the host.
- **Workspace:** npm workspaces; Node 22 pinned in `.nvmrc` and `engines`. Layout:
  - `apps/service`: the NestJS service. Each module of [spec §5.3](docs/spec/5.3-modules.md) is `src/modules/<module>/` with `domain/`, `application/`, `ports/` and `adapters/`; shared plumbing (config, database, domain events, telemetry, WebSocket) is `src/platform/`.
  - `apps/web`: React + Vite, `src/shell/`, `src/surfaces/<surface>/` and `src/api/` (the service's API and event stream).
  - `packages/contracts`: the HTTP and WebSocket contract (zod schemas and their types), the one thing the service and the web share.
  - `packages/ui`: the design system for React. A typed barrel over `design-system/components/**` (the `.jsx` files with their `.d.ts`), plus the theme layers. `design-system/` itself stays as exported, so it can be re-exported from claude.ai.
  - `tools/commit-check`: checks that the commits reaching main are Conventional Commits ([Commits and releases](#commits-and-releases)).
  - `tools/install`: `install.sh`, the one-command installer for Debian/Ubuntu that each release carries stamped ([spec §5.1 Defaults](docs/spec/5.1-shape.md#defaults), "Installing on Debian/Ubuntu"), with its `node --test` tests against stubbed system commands under a fake root, and shellcheck in the run environment.
  - `tools/engine-check`: the [engine check](docs/engine-check.md), re-run on every SDK bump.
  - `tools/lint-rules`: the oxlint plugin that enforces the module and workspace boundaries ([apps/service/docs/module-template.md](apps/service/docs/module-template.md)) and keeps `process.platform` in the platform layer.
  - `tools/release`: what the Release workflow runs ([docs/releasing.md](docs/releasing.md)): the first-release filter of the commits, the tarball's pack (`npm run pack-release`), and the scripts that verify, pack, check and push a release; semantic-release and its plugins are pinned in `tools/release/semantic-release/`, installed apart with `npm ci --prefix`.
  - `tools/service-start-check`: the last check of `npm run verify`, the built service started against `DATABASE_URL`'s Postgres on port 4392: `/api/health` answers `{"database":"up"}`, `/` serves the web app, and SIGTERM ends it with status 143.
- **Checks:** TypeScript strict everywhere; oxlint, with `design-system/_adherence.oxlintrc.json` applied to `apps/web` except its prop-name lists, which reject the HTML attributes a component's `.d.ts` inherits (TypeScript checks every prop against the `.d.ts`); Prettier; Vitest (with SWC for Nest's decorator metadata); Playwright for the web; the service start check. `npm run verify`, one run, does all of them, in the run environment when an Agent runs it.
- **Office data directory:** `OFFICE_DATA_DIR`, default `%LOCALAPPDATA%\the-office` on Windows and `$XDG_DATA_HOME/the-office` (or `~/.local/share/the-office`) on Linux, holding `worktrees/`, `bases/` (each Project's base branch checked out read-only, which chat sessions read), `initiative-bases/` (each Initiative's branch checked out read-only per Project, `<short name>/<project>`, which the Initiative's Threads read), `sessions/`, `skills/` (the library), `attachments/`, `project-images/` (each Project's Icon and Logo, named by the image's id), `avatars/` (each person's Avatar, named by the image's id), `identity/` (the Office ssh key and The Office's own known hosts, readable by its owner only), `repositories/` (each Project added by Repository URL, cloned into `<host>/<owner>/<repo>`, which sessions read as any Project's folder), `engines/` (each Claude Code engine's config folder, `<engine id>/`, holding its account and its sessions' transcripts, which its sessions run with as `CLAUDE_CONFIG_DIR`), `run-environments/` (each Task's run environment files, `tasks/<task id>/`, and the build context of an image while it builds, `image-builds/`) and `test-output/` (the files each test run wrote into a Task's worktree, moved out by Stage run and run number). Kept short for Windows `MAX_PATH`.
- **Migrations keep the previous release working:** an Office update's rollback puts the previous release's code back, never the database ([spec §5.1](docs/spec/5.1-shape.md#defaults), "Updating The Office"), so each release's migrations only expand what the release before reads (new tables, new nullable or defaulted columns), and the contracting change (dropping or renaming what it read) waits for a later release.
- **The scripted engine adapter** replays recorded engine output, so every test of Conversations and Pipelines runs without model calls. Real model calls happen only in the engine check and in a check on the [Test Project](apps/service/docs/testing.md#the-test-project).

## Rules

- **The spec is the source of truth.** When code, the engine or a check contradicts the spec or a Task, stop, note what was found, and ask the user; the spec changes only with their answer. The tickets behind it are in `.scratch/the-office/issues/` (local, git-ignored).
- **One language:** the [glossary](GLOSSARY.md)'s terms, exactly, in the UI, the API, the code and the database. "Session" means only the engine's session behind a Thread; a browser a user signed in from is a signed-in device.
- **The click-through is the UI spec:** `.scratch/the-office/prototypes/app/index.html`, opened in a browser. Build the parts the Task names, re-implemented in React with `packages/ui`; the tier 2 and 3 parts of the same screens are left out entirely. For the chat, [the adopted design](docs/design/chat-drawer.html) is the UI spec instead: the click-through still shows the chat modal. For Add a Project, [its adopted design](docs/design/add-project.html), with Recent first as the GitHub list, is the UI spec instead. For a Project page's Pipelines section and Settings › Pipelines, [the adopted Project Pipelines design](docs/design/project-pipelines.html) is the UI spec instead.
- **Reference is behaviour, not code:** `D:\Projects\software-factory` shows how something worked and what went wrong; write fresh code. That repository stays untouched.
- **Architecture:** modules as bounded contexts, layered and talking through application services and domain events ([spec 5.3](docs/spec/5.3-modules.md)); the template is [apps/service/docs/module-template.md](apps/service/docs/module-template.md).
- **Model calls cost quota:** tests use the scripted engine adapter; real sessions run only in the engine check and in a Task's check on the Test Project, with the cheapest model that proves the point.
- **Commit locally, never push.** Pushing, publishing and anything else that leaves the workstation waits for the user's go-ahead.

## Commits and releases

- **Commit messages are the changelog: [Conventional Commits](https://www.conventionalcommits.org/).** The type decides the release:
  - `feat` → minor;
  - `fix`, `perf`, `refactor` → patch;
  - `!` after the type, or a `BREAKING CHANGE:` footer → major;
  - other types (`docs`, `test`, `build`, `ci`, `chore`, `style`) release nothing.
- **The subject is in plain words.** It becomes the GitHub Release's notes, so it says what changed for someone running The Office, in the [glossary](GLOSSARY.md)'s terms: `fix(pipelines): a Stage stopped by the fire alarm starts again after the all clear`. An optional scope is the module or surface.
- **One Task is one commit on main**, carrying the Task's commit message. The Office's Stage commits stay on the Task's branch, and its "Merge main from origin into …" merge commits aren't checked.
- **Releases are cut only by the Release workflow** (`.github/workflows/release.yml`, run by hand on main): semantic-release takes the version from these commits, tags `v<version>` and makes the GitHub Release with the tarballs and the image ([docs/releasing.md](docs/releasing.md)). Nobody tags `v*` or publishes a release by hand.
- **The check:** the `Conventional Commits` workflow (`.github/workflows/conventional-commits.yml`, running `tools/commit-check` with `commitlint.config.js`) checks every non-merge commit reaching main after the newest `v*` tag, and every pull request's title and body as the commit a squash merge makes of them. Before the first release it checks no pushed commit; a pull request's title and body are checked from the start. `npm run check-commits -- --from <sha> --to <sha>` or `-- --message-file <path>` runs it by hand. No local commit hook: The Office's Stage commits aren't Conventional Commits.
