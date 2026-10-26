# 15 · Edit for this Task: the Stage editor

Status: in progress

## Goal

"Edit for this Task" opens the Stage editor on a Task's own copy of its Pipeline: the user swaps the Pipeline, adds a Gate, drops or reorders Stages, and sets each Stage's Role or command, model and effort, session, budget and on-failure target with its rounds. Started Stages are locked, the library Pipeline stays as it is, and the editor flags what can't run before it is saved. The editor is built as one component that the tier 2 library editor will reuse.

## Definition of Done

- [ ] From the Task page, the user swaps the Pipeline for another built-in, or edits the Task's copy: add an Agent, Script or Gate Stage, drop, reorder, and set kind, Role or command, brief, model and effort, session (fresh, or continue the previous Stage's), budget, optional, and "on failure go back to Stage X at most N times" (N is the Stage's rounds). Check: Playwright edits each field and reloads.
- [ ] Stages that have started are locked and can't be moved above; edits apply to that Task only. Check: edit a running Task's Pipeline, and read the library's copy afterwards.
- [ ] The editor flags, and saving refuses with the reason: a Role with Task limit none or nobody hired for it, "continue" without the same Role on the Stage before, and an on-failure target that isn't earlier. Check: domain tests of each flag.
- [ ] The interpreter runs the edited copy, including a Gate added before Publish. Check: a scripted-adapter test of an edited Pipeline.

## Read first

- [Spec 2.3](../spec/2.3-pipelines.md) ("Edit for this Task", the editor's flags, started Stages locked).
- Decided with the user in task 10: the Task's own copy of its Pipeline lives in Pipelines, beside its Stage runs; the Task (Work) holds only its Pipeline's id. Swapping the Pipeline changes that id while the Task follows the library; editing it for this Task makes Pipelines' own copy.

Leave out: the Pipeline library editor and Stage templates in Settings (tier 2); the component is written so that view can reuse it.

## Steps

- [x] 1. Pipelines domain: edit operations on a Task's copy with the lock on started Stages, the validation flags, and swapping the Pipeline before Start; tests. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md) (`domain/stage.ts`, `domain/pipeline.ts` with `stageProblems`, `domain/task-stages.ts`).
- [ ] 2. Use cases, events and API; the Task's Pipeline label shows when it was edited for the Task. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md), the [Contracts map](../../packages/contracts/src/MAP.md).
- [ ] 3. The Stage editor component and the "Edit for this Task" dialog. Commit.
  Read: the [Work surface map](../../apps/web/src/surfaces/work/MAP.md); in the click-through, `stageForm`, `failureFields` and `taskPipelineDialog` in [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js) and "Edit for this Task" in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), each by range.
- [ ] 4. Check on the Test Project: add a Gate to a Ready Task's Pipeline and change a Stage's model; log the result. Commit.
  Read: [test-project.md](test-project.md), [testing](../../apps/service/docs/testing.md) (live checks run alone); task 14's check, `pipelines/application/gate-publish-test-project-check.test.ts`, is the pattern.

## State

Step 1 done, in `pipelines/domain`:
- `AgentStage` has optional `model` and `effort` (absent keeps the Role's). Nothing passes them to the session yet: `StageThreadRequest` has neither, and Conversations reads both from the Role card (`stage-threads.ts` ~387). Step 2 or 4 must add them, or step 4's live check fails.
- `task-stages.ts`: `TaskStages` has `madeAt` (was `startedAt`, migration 0028 renames the column) and `editedForTask`; `lockedStageCount` (every Stage up to the furthest with a run), `editProblems` (locked prefix unchanged, `stageProblems`, `staffingProblems`), `editTaskStages` (+ `TaskStagesEdited`), `followsPipeline`.
- `stage-staffing.ts`: `RoleFilling`, `staffingProblems` checks only unlocked Stages (decided: a person let go after working a done Stage must not block every later edit). `KnownPerson.card` now has `taskLimit`; People's `RoleCards` already returns it. Titles come from `KnownPeople.roleTitle`.
- Stage builders for domain tests are in `domain/stage.fixtures.ts`.

For step 2:
- A copy can now exist before Start. `TaskStagesService.make` still returns any existing copy: make it replace a copy that doesn't `followsPipeline` (the repository needs a save that replaces), and drop the edited copy on Work's `TaskPipelineConfirmed` (Work already refuses a swap once started).
- The interpreter reads `stages` once per walk (`walk` → `walkStages`, `answeredMeanwhile`, `runStage`): re-read the copy each loop, and serialize an edit's save with a run's start per Task (one process; the interpreter already keeps one walk per Task), so no Stage starts under a definition the edit just replaced.
- Editable while the Task isn't done or dropped (the click-through hides the link then); refuse those with a reason.
- Seeding `task_stages` in `apps/web/e2e/people.e2e.ts` uses `made_at` now.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->
- 2026-10-27 · step 1: Stage model and effort, the Task's copy made at Start or first edit (madeAt, editedForTask), lock on started Stages, edit flags incl. staffing; next step 2, use cases, events and API.
