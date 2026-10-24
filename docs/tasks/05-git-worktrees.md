# 05 · Git, worktrees and the environment check

Status: todo

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

- [ ] 1. A per-repository mutex keyed by the common git directory, and a git adapter behind a port in the Projects module: fetch, worktree add and remove, branch, commit, HEAD and branch read, restore, discard, with tests on a temp repository. Commit.
- [ ] 2. Task worktrees: the stable path under the Office data directory, created on the freshly fetched base branch; dependencies installed per worktree and skipped while the install command and its input files are unchanged. Commit.
- [ ] 3. The environment as data on the Project (stored outside the checkout) and one command runner that applies it to every command, runs it in the platform's shell (`cmd.exe` or PowerShell on Windows, `sh` on Linux; `prependPath` with the platform's separator), filters output to failure markers with context plus the tail (capped), and detects commands that could not run. Commit.
- [ ] 4. The environment check: a throwaway worktree of the base branch, install, build, lint and test in order, results as checks, the environment saved only on success, the worktree removed afterwards; events for each check. Commit.
- [ ] 5. The Project page's environment block: the checks with their state and output, "Run the environment check", and the environment's variables editable as data. Commit.
- [ ] 6. Check on the Test Project: run the check, log the results and durations. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
