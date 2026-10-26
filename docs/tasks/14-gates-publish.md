# 14 · Gates, the Changes tab and Publish

Status: done

## Goal

The work comes back for a look and then leaves the workstation under The Office's control. The Changes tab shows a Task's files, diff and test results; a Gate Stage holds the Task there with screenshots and Attachments until the user continues, sends it back with feedback or drops it. The Publish Stage pushes and opens a pull request, or merges, per the Project's publishing mode, with the user's credentials used only by Office code.

## Definition of Done

- [x] The Changes tab lists changed files with added and removed lines, shows the diff against the base branch and the latest test results, and, while the Task has its worktree, opens the worktree or a file in VS Code ([spec §9](../spec/README.md#defaults), Open in editor). Check: on a Task with changes.
- [x] A Gate Stage sets the Task Waiting on you and shows the same view inline with the Stage results, Attachments and screenshots, and the actions Continue, Send back (feedback to a chosen earlier Stage, not counted as a failure round) and Drop. Check: Playwright passes a Gate and sends one back.
- [x] Screenshots follow the trust model: the Agent writes them to a git-excluded folder in the worktree and lists them in its result; The Office keeps that folder across test runs and attaches exactly the listed files (each at most 2 MiB). Check: a test where a test run writes extra screenshots, which are not attached.
- [x] Publish in push + PR mode pushes the Task branch and opens a pull request whose body holds the Definition of Done, the Stage results and any accepted issues; in merge mode it merges into the base branch and pushes it. Both run under the per-repository lock, and only Office code holds the credentials. Check: both modes on a throwaway branch of the Test Project, or a scratch repository with a remote.
- [x] A Publish that fails (push rejected, PR refused) goes to the Stage's on-failure target with the error; a branch that no longer applies cleanly on the base asks the user. Afterwards the worktree is removed. Check: tests of each.

## Read first

- [Spec §2.3](../spec/2.3-pipelines.md) (Gate, Publish), [§4](../spec/4-ux-direction.md) (Changes is a tab; a Gate shows it inline), [§9](../spec/README.md#defaults) (publishing credentials).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §8 (screenshots and what went wrong), §5 (the missing `workflow` OAuth scope), §11.7 (the final report).
- Reference, behaviour only, in `D:\Projects\software-factory\apps\runner\src\`: `pipeline/ui-screenshots.ts`, `pipeline/task-report.ts`, `git/git-repository.ts` (push).
- Click-through: `changesHtml` in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), the Gate in [app/now.js](../../.scratch/the-office/prototypes/app/now.js) and [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js).

Leave out: the proof-of-concept publish target and conflict resolution between parallel Tasks.

## Steps

- [x] 1. Changes: a use case in Projects that reads files, line counts and the diff of a worktree against its base; the latest Script Stage results from Pipelines; the Changes tab. Commit.
- [x] 2. Gate Stages in the interpreter: Waiting on you, the actions and what each does, events; the Gate view inline on the Task page. Commit.
- [x] 3. Screenshots: the excluded folder, keeping it across test runs, attaching exactly the listed files; the brief tells Agents where to write them. Commit.
- [x] 4. Publish Stages: push + PR and merge, the PR body from the record, failures to the on-failure target, the clean-apply check, worktree removal. Commit.
- [x] 5. Check on the Test Project: a Task whose Pipeline copy has a Gate before Publish (seeded into the Task by a check script; the editor is task 15) runs through the Gate to Publish in its publishing mode. Publishing leaves the workstation, so ask the user before this step runs; log the PR or the merge. Commit.

## Progress

The log is archived in [archive/14-gates-publish.md](archive/14-gates-publish.md).
