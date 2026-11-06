# 54 · The Task's branch keeps up with the base

Status: in progress

## Goal

A Task never starts on a branch that is behind the base, and a branch that moved outside The Office never leaves a Task stuck. Found on the Task "Change a Project's colour and mark" (254e29cb) on 2026-11-06: planning made its worktree hours before the Task it was blocked by merged, so Implement started without that work; nobody could update the branch; and once the user did, every run was refused in under a second, each refusal saving the old commit again, using rounds and consulting the CTO 8 times.

Chosen by the user on 2026-11-06, as A + B + D + E of the options given:

- **A:** The Office updates the branch as the Task's first Stage starts.
- **B:** an Office tool an Agent asks The Office to update the branch with, mid-Stage.
- **D:** a move along the base is accepted as a Stage starts.
- **E:** any other move is its own Decision for the user: no round, no CTO.

## Definition of Done

- [x] A branch moved along the base between Stages is accepted: the Stage runs from the new HEAD, and its Agent is told. Check: `stage-interpreter-decisions.test.ts`, with `branch-updates.test.ts` on real repositories.
- [x] Any other move stops the Stage with a Decision put to the user alone, using no round; "Keep the branch as it is" runs the Stage from where the branch is. Check: `pipeline-walk.test.ts`, `walk-decisions.test.ts`, `stage-interpreter-decisions.test.ts`.
- [x] A Task's first Stage starts on the fresh base: a fast-forward when the branch has nothing of its own, a merge otherwise, and a conflict leaves the branch as it was with the Agent told. Check: `branch-updates.test.ts` on real repositories and an Agent Stage test.
- [x] An Agent in a Stage updates the branch with an Office tool: its work so far committed, the base merged in, and a conflict left for it to resolve, which The Office commits when the Stage ends. Check: `stage-branch-update.test.ts`.
- [x] Spec 2.3 and 5.5 say all of this. Check: read each changed line against Goal.
- [x] The stuck Task's case, replayed: a run failed as before this task, HEAD fast-forwarded along the base, "Run once more" starts the Stage. Check: `stage-interpreter-decisions.test.ts`.

## Read first

- `apps/service/src/modules/pipelines/MAP.md` and `apps/service/src/modules/projects/MAP.md`.
- [Spec 2.3](../spec/2.3-pipelines.md), the Defaults at the end; [spec 5.5](../spec/5.5-git-and-isolation.md).

## Leave out

- Updating a waiting Task's branch when its blocker finishes (option C): A covers it.
- The Office putting a branch back itself: the Decision leaves that to the user, who moved it.
- A run's own record of an update for the Task page: the commits and the Brief show it, and it would need a migration and web work.
- Stopping the CTO being asked again after passing a failure on: E removes the case that repeated.
- The web: Decisions are generic, so nothing there changes.

## Steps

- [x] **1. Moved branches (D + E).** `movedAlongBase` in Projects through `TaskGit`; `StageGit.start` accepts such a move and tells the Agent; any other is `branchMoved` on the outcome, walked by `afterBranchMoved` with a `branch-moved` Decision and a `keep-branch` answer. Spec amended. Read: `stage-git.ts`, `pipeline-walk.ts`, `walk-decisions.ts`, spec 2.3.
- [x] **2. The first Stage starts on the fresh base (A).** `updateFromBase` in Projects, called from `StageGit.start` when no run has left the branch yet. Read: `resolving.ts`, `git.ts` port.
- [x] **3. The Office tool (B).** `update_branch` in Pipelines' Office tools; the Stage's commit reads where the tool left the branch; a merge left in progress is committed as Resolve's is; dropping the Task gives it back. Read: `decision-office-tools.ts`, `resolve-stage-git.ts`, `agent-stage-runner.ts`.
- [ ] **4. Close.** `npm run verify:linux`, the log archived.

## State

Step 1 built: `BranchUpdates.movedAlongBase` in Projects (through `TaskWorktrees` and `TaskGit`), `StageGit.start` taking a move or refusing with `branchMoved`, `afterBranchMoved` in the walk, `branchMovedDecision`, and spec 2.3 and 5.5 amended for the whole task. Service only.

Decided with the user: A + B + D + E (Goal). Decided while writing the task: a conflict at the first Stage isn't left in the worktree but aborted, and the Agent is told to use the tool, so a conflict is always resolved inside an Agent's own Stage, with no new Resolve path; Resolve stays Publish's. The Decision's second option is the user saying they put the branch back, not The Office resetting it; if they didn't, the Decision comes back.

Step 2 built: `BranchUpdates.update`, `Git.fastForward`, and `StageGit.start` calling it when no earlier run has a `headCommit`. A failed update doesn't stop the Stage; the Agent is told.

Step 3 built: `StageBranchUpdate` behind the `update_branch` Office tool, offered to Stage sessions only. The run saves where the tool left HEAD (`StageGit.afterTurn`), a merge left is committed by `ResolveStageGit.finish`, and Drop gives it back.

The stuck Task's replay test is in too.

Next: step 4, `npm run verify:linux`, then close.

## Progress

- 2026-11-06 · task written from the user's choice of options; next: step 1.
- 2026-11-06 · step 1: a branch moved along the base is taken as a Stage starts, any other move is the user's Decision with no round; next: step 2.
- 2026-11-06 · step 2: a Task's first Stage brings the branch to the fresh base; next: step 3.
- 2026-11-06 · step 3: the `update_branch` Office tool; next: step 4.
