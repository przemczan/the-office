# 15 · Edit for this Task: the Stage editor

Status: done

## Goal

"Edit for this Task" opens the Stage editor on a Task's own copy of its Pipeline: the user swaps the Pipeline, adds a Gate, drops or reorders Stages, and sets each Stage's Role or command, model and effort, session, budget and on-failure target with its rounds. Started Stages are locked, the library Pipeline stays as it is, and the editor flags what can't run before it is saved. The editor is built as one component that the tier 2 library editor will reuse.

## Definition of Done

- [x] From the Task page, the user swaps the Pipeline for another built-in, or edits the Task's copy: add an Agent, Script or Gate Stage, drop, reorder, and set kind, Role or command, brief, model and effort, session (fresh, or continue the previous Stage's), budget, optional, and "on failure go back to Stage X at most N times" (N is the Stage's rounds). Check: Playwright edits each field and reloads.
- [x] Stages that have started are locked and can't be moved above; edits apply to that Task only. Check: edit a running Task's Pipeline, and read the library's copy afterwards.
- [x] The editor flags, and saving refuses with the reason: a Role with Task limit none or nobody hired for it, "continue" without the same Role on the Stage before, and an on-failure target that isn't earlier. Check: domain tests of each flag.
- [x] The interpreter runs the edited copy, including a Gate added before Publish. Check: a scripted-adapter test of an edited Pipeline.

## Read first

- [Spec 2.3](../spec/2.3-pipelines.md) ("Edit for this Task", the editor's flags, started Stages locked).
- Decided with the user in task 10: the Task's own copy of its Pipeline lives in Pipelines, beside its Stage runs; the Task (Work) holds only its Pipeline's id. Swapping the Pipeline changes that id while the Task follows the library; editing it for this Task makes Pipelines' own copy.

Leave out: the Pipeline library editor and Stage templates in Settings (tier 2); the component is written so that view can reuse it.

## Steps

- [x] 1. Pipelines domain: edit operations on a Task's copy with the lock on started Stages, the validation flags, and swapping the Pipeline before Start; tests. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md) (`domain/stage.ts`, `domain/pipeline.ts` with `stageProblems`, `domain/task-stages.ts`).
- [x] 2. Use cases, events and API; the Task's Pipeline label shows when it was edited for the Task. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md), the [Contracts map](../../packages/contracts/src/MAP.md).
- [x] 3. The Stage editor component and the "Edit for this Task" dialog. Commit.
  Read: the [Work surface map](../../apps/web/src/surfaces/work/MAP.md); in the click-through, `stageForm`, `failureFields` and `taskPipelineDialog` in [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js) and "Edit for this Task" in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), each by range.
- [x] 4. Check on the Test Project: add a Gate to a Ready Task's Pipeline and change a Stage's model; log the result. Commit.
  Read: [test-project.md](test-project.md), [testing](../../apps/service/docs/testing.md) (live checks run alone); task 14's check, `pipelines/application/gate-publish-test-project-check.test.ts`, is the pattern.

## Progress

The log is archived in [archive/15-stage-editor.md](archive/15-stage-editor.md).
