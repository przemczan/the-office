# The Office

A single-user workspace run like an office, built from [the spec](docs/spec/README.md) in tasks listed in [docs/tasks/README.md](docs/tasks/README.md).

## Every session

Load only what the current step needs: whatever a session reads stays in its context and is paid for on every later call.

1. Open [docs/tasks/README.md](docs/tasks/README.md). The current task is the first row that is neither `done` nor `postponed`. A task still `todo` becomes `in progress`, in its file and in the README.
2. In that task's file, read Goal, Definition of Done, Read first, State, and the first unchecked step with its `Read:` line, and continue from that step. Earlier Progress lines and other tasks' logs are not needed.
3. Before changing a module or a surface, read its `MAP.md` (`apps/service/src/modules/<module>/`, `apps/service/src/platform/`, `apps/web/src/`, `apps/web/src/surfaces/<surface>/`, `apps/web/e2e/`, `packages/contracts/src/`): what it owns, what it talks to and its traps, then its routes, events, tables and files. From there, find symbols with LSP and read code by range.
4. In the click-through, grep the function the task names and read only its range, never a whole file.
5. Read the rest only when the step needs it:
   - the [glossary](GLOSSARY.md), when naming something new;
   - the [UI rules](docs/spec/4.1-ui-rules.md), before building or changing anything the user sees;
   - a section from [the spec's index](docs/spec/README.md), when the cited sections leave a question open;
   - the [module template](apps/service/docs/module-template.md), when adding a module or a kind of file a module doesn't have yet, or when a boundary lint error is unclear; [testing](apps/service/docs/testing.md), before a kind of test the module doesn't have yet or a live check;
   - [build defaults](docs/tasks/build-defaults.md); [the Test Project](docs/tasks/test-project.md), for a check on it; [coverage](docs/tasks/coverage.md), when slicing or closing a tier;
   - a log in [docs/tasks/archive/](docs/tasks/archive/), only to trace why something was done.
6. Work one step at a time. A step ends in one commit holding its code, the ticked step, the task's State rewritten, and one Progress line (`- YYYY-MM-DD · step N: what changed; what is next`, a few hundred characters at most). The detail goes in the commit body, not the log. When a step changes a module's or surface's files, `npm run maps` refreshes the generated part of its map; update the handwritten part when what it owns, what it talks to or a trap changed.
7. While working on a step, run only the tests of the module or surface being changed; never `npm run verify` (or `test:e2e`) in the middle of a step. Once the whole step is written, run the full `npm run verify` once, and rerun it only after fixing what it found. It passes before the commit. Inside a Stage of The Office, whose message lists the Stages after it, `npm run verify` is left to the later Stage that runs it, and the Agent doesn't run it; it runs only the tests of what it changed. When no later Stage runs it, an Agent runs it in the Task's run environment (`.devcontainer/`, Linux with a Postgres of its own) through the Office tool; on the workstation it runs on the host. `verify` runs the default run (critical and smoke tests); the full run (`test:full`, `test:e2e:full`, `verify:full`) is on demand ([testing](apps/service/docs/testing.md)).
8. When every Definition of Done box is ticked, with its check run, and `npm run verify` passes: move the Progress log to `docs/tasks/archive/<task file>`, leaving a pointer to it, set the task to `done` in its file and the README, and commit.

A task file holds: Goal; Definition of Done (each with its check); Read first (what every step needs, a few links at most); Leave out; Steps (each with a `Read:` line of what only it needs); State (rewritten each commit, at most about 15 lines: what is built and where, open questions, what was decided with the user, traps for the next step); Progress. The State is the handover, so a fresh session can take each step.

## Rules

- **The spec is the source of truth.** When code, the engine or a check contradicts the spec or a task, stop that step, log what was found, and ask the user; the spec changes only with their answer. The tickets behind it are in `.scratch/the-office/issues/` (local, git-ignored).
- **One language:** the [glossary](GLOSSARY.md)'s terms, exactly, in the UI, the API, the code and the database. "Session" means only the engine's session behind a Thread.
- **The click-through is the UI spec:** `.scratch/the-office/prototypes/app/index.html`, opened in a browser. Build the parts the task names, re-implemented in React with `packages/ui`; the tier 2 and 3 parts of the same screens are left out entirely. For the chat, [the adopted design](docs/design/chat-drawer.html) is the UI spec instead: the click-through still shows the chat modal. For Add a Project, [its adopted design](docs/design/add-project.html), with Recent first as the GitHub list, is the UI spec instead. For a Project page's Pipelines section and Settings › Pipelines, [the adopted Project Pipelines design](docs/design/project-pipelines.html) is the UI spec instead.
- **Reference is behaviour, not code:** `D:\Projects\software-factory` shows how something worked and what went wrong; write fresh code. That repository stays untouched.
- **Architecture:** modules as bounded contexts, layered and talking through application services and domain events ([spec 5.3](docs/spec/5.3-modules.md)); the template is [apps/service/docs/module-template.md](apps/service/docs/module-template.md).
- **Model calls cost quota:** tests use the scripted engine adapter; real sessions run only in the engine check and in a task's check on the Test Project, with the cheapest model that proves the point.
- **Commit locally, never push.** Pushing, publishing and anything else that leaves the workstation waits for the user's go-ahead.
