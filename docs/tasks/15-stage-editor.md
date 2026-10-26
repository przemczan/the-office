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
- [x] 2. Use cases, events and API; the Task's Pipeline label shows when it was edited for the Task. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md), the [Contracts map](../../packages/contracts/src/MAP.md).
- [ ] 3. The Stage editor component and the "Edit for this Task" dialog. Commit.
  Read: the [Work surface map](../../apps/web/src/surfaces/work/MAP.md); in the click-through, `stageForm`, `failureFields` and `taskPipelineDialog` in [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js) and "Edit for this Task" in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), each by range.
- [ ] 4. Check on the Test Project: add a Gate to a Ready Task's Pipeline and change a Stage's model; log the result. Commit.
  Read: [test-project.md](test-project.md), [testing](../../apps/service/docs/testing.md) (live checks run alone); task 14's check, `pipelines/application/gate-publish-test-project-check.test.ts`, is the pattern.

## State

Steps 1–2 done. Server side of "Edit for this Task" is complete:
- `PUT /api/tasks/:id/stages` (`taskStagesEditSchema`) → `TaskStagesService.edit`: copies the library Pipeline when the Task has no copy yet (a Ready Task), refuses done/dropped Tasks, and answers 422 `stagesEditRefusalSchema` with `problems: [{ stageIndex, text }]` from the domain's `editProblems`. The response and GET carry `editedForTask`; the Task page title says "· edited for this Task" (`pipelineLabel` in `stage-words.ts`).
- Swap before Start: `TaskPipelineConfirmed` sets aside a copy of another Pipeline (`TaskStagesReset`, web `task-stages.reset`); `find`/`make` also ignore one.
- The walk reads the Stages afresh each move, and takes its move and saves the run under the per-Task lock it shares with edits (`TaskStagesService.holding`, platform `KeyedLocks`). `RepositoryLocks` in Projects has the same logic; the user turned down changing it to use `KeyedLocks` for now.
- A Stage's `model`/`effort` reach the session: `StageThreadRequest` carries them, and Conversations prefers them over the Role card's. Nothing checks a model against the engine's list yet.
- `stage-interpreter-edited.test.ts` covers DoD 4 (a Gate added mid-walk, an Agent Stage's own model).

For step 3: a Ready Task with an edited copy now gets non-null `stages` from GET, so `StagesBlock` shows `TaskStageList` and hides `ProposedPipeline`; show the proposal whenever the Task hasn't started. The web needs an `editTaskStages` call in `api/pipelines.ts`; the model and effort choices are in `roleCardOptions` (contracts `people.ts`).

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->
- 2026-10-27 · step 1: Stage model and effort, the Task's copy made at Start or first edit (madeAt, editedForTask), lock on started Stages, edit flags incl. staffing; next step 2, use cases, events and API.
- 2026-10-27 · step 2: PUT /tasks/:id/stages with refusals, swap sets edited Stages aside, walk re-reads Stages under a per-Task lock shared with edits, Stage model and effort reach the session, label edited for this Task; next step 3, the editor.
