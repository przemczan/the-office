# 15 · Edit for this Task: the Stage editor

Status: in progress

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

## State

Steps 1–4 done; every Definition of Done box is ticked. Left: `npm run verify:linux`, then archive the log and set the task `done`.
- Service: `PUT /api/tasks/:id/stages` (`TaskStagesService.edit`) and `POST /api/tasks/:id/stages/check` answer the domain's `editProblems` (flag tests in `domain/task-stages.test.ts` and `stage-staffing.test.ts`); GET/PUT answer `lockedStages`. The walk of an edited copy, a Gate before Publish included, is `application/stage-interpreter-edited.test.ts`.
- Web: the Stage editor is `shell/pipelines/stage-editor.tsx` (pure changes in `stage-edits.ts`), knowing no Task, so the tier 2 library editor reuses it; its flags come from the check endpoint. `surfaces/work/edit-task-stages-dialog.tsx` opens from the Stages block, the Task menu and the board card. Playwright checks are in `people.e2e.ts`.
- The Test Project check is `pipelines/application/stage-editor-test-project-check.test.ts` (run alone): it edits a Ready Task through the API, spies `EngineSessions.start` and picks Implement's session by its `office.stage` span attribute, drops at the Gate, and bases the Task on a local branch with no upstream, so Publish can't leave the workstation. The checks' shared steps (`planOnQuickFix`, `untilWalkStops`, `comparable`, `quietly`) moved to `test/live-check.ts`.
- Open: the draft is taken as the dialog opens. If the walk starts a Stage the user has edited meanwhile, its row locks showing the edit and the check refuses it until Cancel.
- Seen in the check, not changed: a Stage's `tokens` (5,425) leave out cache reads while its run's tokens (95,968) count them; the contract says "all four kinds". To raise with the user.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->
- 2026-10-27 · step 1: Stage model and effort, the Task's copy made at Start or first edit (madeAt, editedForTask), lock on started Stages, edit flags incl. staffing; next step 2, use cases, events and API.
- 2026-10-27 · step 2: PUT /tasks/:id/stages with refusals, swap sets edited Stages aside, walk re-reads Stages under a per-Task lock shared with edits, Stage model and effort reach the session, label edited for this Task; next step 3, the editor.
- 2026-10-27 · step 3: the Stage editor in the shell, fed by POST /stages/check; Edit for this Task dialog with the Pipeline swap, from the Stages block and the Task menu; Playwright edits every field and reloads; next step 4, the Test Project check.
- 2026-10-27 · step 3: a running Task's editor locks its started Stages (DoD 2 check in the Gate test), the board menu opens it, it scrolls inside its dialog, the header says edited for this Task; next step 4.
- 2026-10-27 · step 4: Test Project check passed: a Ready Task's Quick fix edited through the API with a Gate before Publish and Implement on Haiku over the Developer's Sonnet; Implement ran on Haiku, the walk waited at the Gate, library unchanged, dropped there; next close-out.
