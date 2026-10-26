# The Office

A single-user workspace run like an office, built from [docs/spec/README.md](docs/spec/README.md) in tasks listed in [docs/tasks/README.md](docs/tasks/README.md).

## Every session

1. Open [docs/tasks/README.md](docs/tasks/README.md). The current task is the first row that is not `done`.
2. Open that task's file. Read its Read first, then its Progress, and continue from its first unchecked step. A task still `todo` becomes `in progress`, in its file and in the README.
3. Work one step at a time. A step ends in one commit holding its code, the ticked step and a Progress line (`- YYYY-MM-DD · step N: what changed; what is next; anything surprising`). The log is the handover: the next session reads nothing else.
4. Before each commit, `npm run verify` passes (task 01 runs before it exists and states its own check). A step that touches the platform layer also passes `npm run verify:linux`.
5. When every Definition of Done box is ticked, with its check run, and `npm run verify:linux` passes too, set the task to `done` in its file and the README, and commit.

## Rules

- **The spec is the source of truth.** When code, the engine or a check contradicts the spec or a task, stop that step, log what was found, and ask the user; the spec changes only with their answer. The tickets behind it are in `.scratch/the-office/issues/` (local, git-ignored).
- **One language:** the [glossary](GLOSSARY.md)'s terms, exactly, in the UI, the API, the code and the database. "Session" means only the engine's session behind a Thread.
- **The click-through is the UI spec:** `.scratch/the-office/prototypes/app/index.html`, opened in a browser. Build the parts the task names, re-implemented in React with `packages/ui`; the tier 2 and 3 parts of the same screens are left out entirely.
- **Reference is behaviour, not code:** `D:\Projects\software-factory` shows how something worked and what went wrong; write fresh code. That repository stays untouched.
- **Architecture:** modules as bounded contexts, layered and talking through application services and domain events ([spec §5.3](docs/spec/5.3-modules.md)); the template is `apps/service/README.md` once task 02 has written it.
- **Model calls cost quota:** tests use the scripted engine adapter; real sessions run only in the engine check and in a task's check on the Test Project, with the cheapest model that proves the point.
- **Commit locally, never push.** Pushing, publishing and anything else that leaves the workstation waits for the user's go-ahead.
