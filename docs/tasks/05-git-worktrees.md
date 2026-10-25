# 05 · Git, worktrees and the environment check

Status: in progress

## Goal

The Office owns git for every Project: worktrees at stable paths, branches, commits, restores and discards, with ref operations serialized per repository. A Project's environment is data applied to every command it runs, and the environment check proves it in a fresh worktree of the base branch before it is saved. This is the git side every later Stage uses; Agents never touch git themselves.

## Definition of Done

- [ ] A git service in the Projects module creates a worktree and branch for a Task at `<office-data>/worktrees/<project>/<task>`, commits with a given message, restores the worktree to the last commit, discards uncommitted edits, reports HEAD and branch, and removes the worktree. Check: integration tests against a temp repository.
- [ ] Fetches, worktree changes and pushes on one repository never run at the same time. Check: a test that fires them concurrently.
- [ ] The Project's environment (`set`, `unset`, `prependPath`) is stored outside the checkout and applied to every command The Office runs for it; production switches such as `NODE_ENV=production` don't leak in from the service's own environment. Check: a test command that prints its environment.
- [ ] Running a Project command records its exit code, duration and filtered output, and tells "the command could not run" (exit 126/127 on Linux; on Windows also a program `cmd.exe` can't find) apart from "it failed", through the platform layer. Check: tests for each case on Windows and in `npm run verify:linux`.
- [ ] "Run the environment check" on the Project page opens a fresh worktree of the freshly fetched base branch, runs install, build, lint and test there, shows each as a check with its output, and saves the environment only when they pass. Check: run it on the Test Project; break one command and see it refused.

## Read first

- [Spec §5.5](../spec.md#55-git-and-isolation), [§6](../spec.md#6-permissions-and-safety) (git belongs to The Office).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §2 (worktrees), §5 (environment as data, not-runnable detection), §11.3 (git guards), §11.5 (output filtering).
- Reference, behaviour only, in `D:\Projects\software-factory\apps\runner\src\`: `git/task-worktrees.ts`, `git/git-repository.ts`, `infrastructure/keyed-mutex.ts`, `setup/dependency-installer.ts`, `projects/task-worktree-verification.ts`, `projects/project-environment-store.ts`, `infrastructure/process/project-command-environment.ts`, `infrastructure/process/command-not-runnable.ts`, `testing/output-filter.ts`.
- Click-through: the Onboarding block in [app/projects.js](../../.scratch/the-office/prototypes/app/projects.js).

## Steps

- [x] 1. A per-repository mutex keyed by the common git directory, and a git adapter behind a port in the Projects module: fetch, worktree add and remove, branch, commit, HEAD and branch read, restore, discard, with tests on a temp repository. Commit.
- [x] 2. Install inputs on the Project ([spec §9](../spec.md#9-defaults-chosen-in-this-spec)): the record and its rule, its column, the API and its event, given in "Add a Project" and changed in the Commands block beside the install command. Commit.
- [ ] 3. The environment as data on the Project (stored outside the checkout) and one command runner that applies it to every command, runs it in the platform's shell (`cmd.exe` or PowerShell on Windows, `sh` on Linux; `prependPath` with the platform's separator), filters output to failure markers with context plus the tail (capped), and detects commands that could not run. Commit.
- [ ] 4. Task worktrees: the stable path under the Office data directory, created on the freshly fetched base branch (the base branch's upstream, [spec §9](../spec.md#9-defaults-chosen-in-this-spec)); dependencies installed per worktree through the command runner and skipped while the install command and the install inputs are unchanged. Commit.
- [ ] 5. The environment check: a throwaway worktree of the base branch, install, build, lint and test in order, results as checks, the environment saved only on success, the worktree removed afterwards; events for each check. Commit.
- [ ] 6. The Project page's environment block: the checks with their state and output, "Run the environment check", and the environment's variables editable as data. Commit.
- [ ] 7. Check on the Test Project: run the check, log the results and durations. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
- 2026-10-25 · step 1: `RepositoryLocks` and `CommandLineGit` behind the `Git` port: fetch (into `refs/remotes/<remote>/<branch>`), push (never forced), worktree add (new branch or detached) and remove (prune when the folder is gone), commit (everything, message on stdin, `--no-verify`: a Project's hooks are its own tooling, run as Stages), HEAD and branch, restore (tracked files only, so screenshots survive) and discard (tracked and untracked, ignored files such as dependencies stay). Push was added here because the DoD's concurrency check names it; commits take the lock too, since a branch's ref lives with the shared refs. The lock key is git's `--path-format=absolute --git-common-dir` through `realpath`, so the main checkout and a worktree name it alike. The remote is a parameter; step 2 decides which one. Next: step 2, Task worktrees. Surprising: the user's global `core.autocrlf=true` reached the temp repositories, so the fixture turns it off.
- 2026-10-25 · step 2: asked the user how to know an install's input files and where the base branch is fetched from, as the Project had neither; they chose a new Project field, **Install inputs**, and the base branch's upstream (spec §2.1, §3, §9 and the glossary updated; the steps were renumbered, with the command runner moved before Task worktrees, since installing needs it). Install inputs are kept trimmed, once each, with `/` between folders, and refused outside the repository; a `text[]` column (migration `0001_install_inputs`), `PUT /projects/:id/install-inputs` with `project.install-inputs-changed`, a comma-separated field in "Add a Project" and a row under Install in the Commands block. Next: step 3, the environment and the command runner.
