# 14 · Gates, the Changes tab and Publish

Status: in progress

## Goal

The work comes back for a look and then leaves the workstation under The Office's control. The Changes tab shows a Task's files, diff and test results; a Gate Stage holds the Task there with screenshots and Attachments until the user continues, sends it back with feedback or drops it. The Publish Stage pushes and opens a pull request, or merges, per the Project's publishing mode, with the user's credentials used only by Office code.

## Definition of Done

- [x] The Changes tab lists changed files with added and removed lines, shows the diff against the base branch and the latest test results, and, while the Task has its worktree, opens the worktree or a file in VS Code ([spec §9](../spec.md#9-defaults-chosen-in-this-spec), Open in editor). Check: on a Task with changes.
- [ ] A Gate Stage sets the Task Waiting on you and shows the same view inline with the Stage results, Attachments and screenshots, and the actions Continue, Send back (feedback to a chosen earlier Stage, not counted as a failure round) and Drop. Check: Playwright passes a Gate and sends one back.
- [ ] Screenshots follow the trust model: the Agent writes them to a git-excluded folder in the worktree and lists them in its result; The Office keeps that folder across test runs and attaches exactly the listed files (each at most 2 MiB). Check: a test where a test run writes extra screenshots, which are not attached.
- [ ] Publish in push + PR mode pushes the Task branch and opens a pull request whose body holds the Definition of Done, the Stage results and any accepted issues; in merge mode it merges into the base branch and pushes it. Both run under the per-repository lock, and only Office code holds the credentials. Check: both modes on a throwaway branch of the Test Project, or a scratch repository with a remote.
- [ ] A Publish that fails (push rejected, PR refused) goes to the Stage's on-failure target with the error; a branch that no longer applies cleanly on the base asks the user. Afterwards the worktree is removed. Check: tests of each.

## Read first

- [Spec §2.3](../spec.md#23-pipelines) (Gate, Publish), [§4](../spec.md#4-ux-direction) (Changes is a tab; a Gate shows it inline), [§9](../spec.md#9-defaults-chosen-in-this-spec) (publishing credentials).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §8 (screenshots and what went wrong), §5 (the missing `workflow` OAuth scope), §11.7 (the final report).
- Reference, behaviour only, in `D:\Projects\software-factory\apps\runner\src\`: `pipeline/ui-screenshots.ts`, `pipeline/task-report.ts`, `git/git-repository.ts` (push).
- Click-through: `changesHtml` in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), the Gate in [app/now.js](../../.scratch/the-office/prototypes/app/now.js) and [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js).

Leave out: the proof-of-concept publish target and conflict resolution between parallel Tasks.

## Steps

- [x] 1. Changes: a use case in Projects that reads files, line counts and the diff of a worktree against its base; the latest Script Stage results from Pipelines; the Changes tab. Commit.
- [ ] 2. Gate Stages in the interpreter: Waiting on you, the actions and what each does, events; the Gate view inline on the Task page. Commit.
- [ ] 3. Screenshots: the excluded folder, keeping it across test runs, attaching exactly the listed files; the brief tells Agents where to write them. Commit.
- [ ] 4. Publish Stages: push + PR and merge, the PR body from the record, failures to the on-failure target, the clean-apply check, worktree removal. Commit.
- [ ] 5. Check on the Test Project: a Task whose Pipeline copy has a Gate before Publish (seeded into the Task by a check script; the editor is task 15) runs through the Gate to Publish in its publishing mode. Publishing leaves the workstation, so ask the user before this step runs; log the PR or the merge. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->

- 2026-10-26 · step 1: Changes. Projects reads what a Task's commits changed since its branch left the base branch (the base's upstream when it tracks one, as `diffSummary`): `Git.branchChanges(repositoryPath, baseBranch, branch)` (`CommandLineGit`: `git diff --numstat -z` and the patch over `base...refs/heads/office/<task>`, with `--no-color --no-ext-diff --find-renames` now shared with `diffSummary` through `sinceForked`; renames keep `previousPath`, binary files have no `lines`, the patch is cut after a whole line past 1,000,000 characters, `diffCut`), `Worktrees.changes` (no changes before the Task has a branch) and the use case `TaskWorktrees.changes(projectId, taskId)`. It reads the repository, not the worktree, so it holds after Publish removes the worktree (step 4); uncommitted edits of a running Stage are left out, so it is what Publish would ship. `GET /projects/:id/tasks/:taskId/changes` (`TaskChangesController`, contract `taskChangesSchema`/`changedFileSchema`). Web: the Task page's record has the tabs Overview and Changes (with the file count; `?recordTab=changes`); `ChangesTab` fetches, `ChangesView` (`surfaces/work/task-changes.tsx`) shows files with +/− lines, the coloured diff and "Tests:" badges, for a Gate to embed in step 2; `changes-words.ts`: `diffLines`, `fileLineWords`, `latestTestResults` (each build, lint and test Script Stage's latest run that ended by itself, from `GET /tasks/:id/stages`; Publish and held or restarted runs left out). `stage-run.ended` now also refreshes the Changes query. Tests: `CommandLineGit.branchChanges`, `Worktrees.changes` (base's later commits out, still there after the worktree is removed), the endpoint, the words, and a Playwright test with a committed Task branch (screenshot `light-1600-task-changes.png`). "Opens a file in the editor" is not built: nothing in the spec, the click-through (a header-level "Open in editor" only) or the code says which editor or how, so it waits on the user's answer and that Definition of Done box stays open. Next: step 2, Gate Stages. Surprising: after a merge-mode Publish `base...branch` is empty, which step 4 must keep in mind.
- 2026-10-26 · step 1 (follow-up, the user's answer): Open in editor. Spec §9 gains the default (the Changes block's "Open in editor" opens the worktree folder in VS Code through `vscode://file/<path>`, each listed file links to itself the same way, both only while the Task has its worktree; The Office launches nothing) and the Definition of Done says so. `Worktrees.changes` now returns `TaskChanges` (`BranchChanges` plus `worktreePath`, undefined when the folder isn't there); the contract's `taskChangesSchema` has `worktreePath` (null without one). Web: `editorLink(worktreePath, filePath?)` in `changes-words.ts` (forward slashes, a drive letter kept, `encodeURI` plus `#` and `?` escaped), the header action and file links in `ChangesView`. Tests: `editorLink` on Windows, Linux and escaped paths; `Worktrees.changes` with its path and without after removal; the Playwright Changes test shows no links before the worktree exists and both links after (the e2e Office data directory is now the fixed `office-e2e-data` under the temp folder, `e2e/office-data.ts`, so a test can find a Task's worktree). This Definition of Done box is ticked. Next: step 2, Gate Stages. Surprising: a deleted file still gets a link, which opens a file that isn't there; the numstat doesn't say a file was deleted.
