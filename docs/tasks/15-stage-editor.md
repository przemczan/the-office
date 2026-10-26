# 15 · Edit for this Task: the Stage editor

Status: in progress

## Goal

"Edit for this Task" opens the Stage editor on a Task's own copy of its Pipeline: the user swaps the Pipeline, adds a Gate, drops or reorders Stages, and sets each Stage's Role or command, model and effort, session, budget and on-failure target with its rounds. Started Stages are locked, the library Pipeline stays as it is, and the editor flags what can't run before it is saved. The editor is built as one component that the tier 2 library editor will reuse.

## Definition of Done

- [x] From the Task page, the user swaps the Pipeline for another built-in, or edits the Task's copy: add an Agent, Script or Gate Stage, drop, reorder, and set kind, Role or command, brief, model and effort, session (fresh, or continue the previous Stage's), budget, optional, and "on failure go back to Stage X at most N times" (N is the Stage's rounds). Check: Playwright edits each field and reloads.
- [x] Stages that have started are locked and can't be moved above; edits apply to that Task only. Check: edit a running Task's Pipeline, and read the library's copy afterwards.
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
- [x] 3. The Stage editor component and the "Edit for this Task" dialog. Commit.
  Read: the [Work surface map](../../apps/web/src/surfaces/work/MAP.md); in the click-through, `stageForm`, `failureFields` and `taskPipelineDialog` in [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js) and "Edit for this Task" in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), each by range.
- [ ] 4. Check on the Test Project: add a Gate to a Ready Task's Pipeline and change a Stage's model; log the result. Commit.
  Read: [test-project.md](test-project.md), [testing](../../apps/service/docs/testing.md) (live checks run alone); task 14's check, `pipelines/application/gate-publish-test-project-check.test.ts`, is the pattern.

## State

Steps 1–3 done; step 4, the check on the Test Project, is next.
- Service: `PUT /api/tasks/:id/stages` (`TaskStagesService.edit`) and `POST /api/tasks/:id/stages/check` (`check`, the same review without saving) answer the domain's `editProblems`; the refusal now carries `reasons` like every other. GET/PUT answer `lockedStages` (`lockedStageCount`).
- Web: the Stage editor is `shell/pipelines/stage-editor.tsx` with its pure changes in `stage-edits.ts`; it knows no Task (props: stages, `lockedNotes`, problems, roles, options, optional `commandLines`), so the tier 2 library editor reuses it with no locked Stages. Its flags come from the check endpoint (`pipelineQueries.stagesCheck`), not a copy of the rules; the controls only offer what can work (Roles with a Task limit, "continue" after the same Role, earlier non-Gate targets).
- `surfaces/work/edit-task-stages-dialog.tsx` opens from the Stages block's "Edit for this Task" and the Task menu's "Edit Stages for this Task"; before Start it swaps the Pipeline (`setPipeline`), which sets edited Stages aside. The Planner's proposal shows whenever the Task hasn't started.
- `modelLabel`/`EFFORT_LABELS` moved to `shell/engine-words.ts`, `publishingLabel` to `shell/project-words.ts`.
- The Playwright checks are in `people.e2e.ts` (they need the hired Developer and Reviewer): every field and a reload, the editor opened from a board card, and in the Gate test the running Task's started Stages locked, Build edited after them and the library unchanged (DoD 2). The Gate test saves its Stages through `PUT /stages` instead of the database.
- Open: the draft is taken as the dialog opens. If the walk starts a Stage the user has edited meanwhile, its row locks showing the edit and the check refuses it until Cancel.

For step 4: no model is checked against the engine's list yet; a Stage's model comes from `roleCardOptions`, so it is one the engine offers.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->
- 2026-10-27 · step 1: Stage model and effort, the Task's copy made at Start or first edit (madeAt, editedForTask), lock on started Stages, edit flags incl. staffing; next step 2, use cases, events and API.
- 2026-10-27 · step 2: PUT /tasks/:id/stages with refusals, swap sets edited Stages aside, walk re-reads Stages under a per-Task lock shared with edits, Stage model and effort reach the session, label edited for this Task; next step 3, the editor.
- 2026-10-27 · step 3: the Stage editor in the shell, fed by POST /stages/check; Edit for this Task dialog with the Pipeline swap, from the Stages block and the Task menu; Playwright edits every field and reloads; next step 4, the Test Project check.
- 2026-10-27 · step 3: a running Task's editor locks its started Stages (DoD 2 check in the Gate test), the board menu opens it, it scrolls inside its dialog, the header says edited for this Task; next step 4.
