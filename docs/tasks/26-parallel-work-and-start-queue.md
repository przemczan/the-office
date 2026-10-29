# 26 · Parallel work in a Project, and a queue for Start

Status: in progress

## Goal

Several Tasks can be in progress in one Project. When Start can't run a Task now only because its person is at their Task limit or the Office-wide limit is reached, the Task joins one Office-wide queue, shown with its reason on the board, the Task page and Now, and starts by itself, oldest first, once a desk and its person are free; the user takes a Task out or moves it up. The Planner's Plan lists the files it expects to change, and Start warns of an overlap with a Task in progress in the same Project, offering to start anyway or to queue behind it. A conflict at Publish goes to the Task's Developer in a Resolve Stage, then the Project's Test and the Task's Gate, before Publish runs again; the user is asked only when the Agent gives up. Spec [2.1](../spec/2.1-work.md) (Defaults: "A queue for Start", "Overlaps at Start"), [2.3](../spec/2.3-pipelines.md) (Defaults: "Conflicts at Publish"), [2.2](../spec/2.2-people.md) (Limits), [5.5](../spec/5.5-git-and-isolation.md) (The Office owns every git change); tickets [07](../../.scratch/the-office/issues/07-work-model.md), [08](../../.scratch/the-office/issues/08-pipelines.md), [19](../../.scratch/the-office/issues/19-work-mockup.md) (its open question on a queue); coverage rows for task 26 in [coverage.md](coverage.md).

## Definition of Done

- [ ] Several Tasks in progress per Project: Start no longer refuses because the Project has a Task in progress; each still has its own worktree and branch. Check: `task-start.test.ts`; a service test starting two Tasks of one Project.
- [ ] The queue, the service: Start queues a Task when only the Office-wide limit or its person's Task limit stands, and refuses with the reasons when anything else does; a queued Task holds no desk and counts against no limit; it starts by itself, oldest first among those that can, when a started Task ends or a limit is raised; the user takes it out or moves it up; leaving Ready takes it out. Check: a service test with lowered limits (`WorkSettingsForTests`) through the scripted engine.
- [ ] The queue, the web: Start that queues says so; the board's card, the Task page and Now show the Task's place and reason; "Take out of the queue" and "Move up" work. Check: Playwright.
- [ ] Overlaps: the Planner writes the files the Plan expects to change, shown with the Plan and confirmed with it; Start warns when a Task in progress in the same Project expects to change any of them, naming that Task and the files, and offers "Start anyway" or "Queue behind it"; a Task queued behind another starts once that one is Done or Dropped. Check: domain tests of the overlap; a service test; Playwright for the warning.
- [ ] Conflicts at Publish: a Publish whose branch conflicts with the fetched base runs Resolve (the Task's Developer edits the conflicted files in the worktree; The Office's own git brings the base in and commits), then the Project's Test, then a Gate, then Publish again; the user's Decision comes only when Resolve gives up or the conflict comes back too often. Check: a real-git service test (`REAL_GIT_TEST`) with an actual conflicted file through the scripted engine.
- [ ] `npm run verify` and `npm run verify:linux` pass; a live run on the Test Project with the cheapest model (two Tasks in one Project changing the same file, the second resolved at Publish); the user's look at the queue, an overlap and a Resolve in the running app. Check: the commands; the live run; the user's word.

## Read first

- [Work module map](../../apps/service/src/modules/work/MAP.md) (`task-start.ts`'s `startProblems`, `StartService`, `holdStarts` in `work-rows.ts`, `task-states.ts`, `planning-office-tools.ts`).
- [Pipelines module map](../../apps/service/src/modules/pipelines/MAP.md) (`StageInterpreter`, `PublishStage`, `walk-decisions.ts`'s `baseMovedDecision`, `task-stages.ts`) and [Projects module map](../../apps/service/src/modules/projects/MAP.md) (`Publishing`, `CommandLineGit.conflictsOf`, `TaskWorktrees`, `RepositoryLocks`).
- [Work surface map](../../apps/web/src/surfaces/work/MAP.md) (`start-action.tsx`, `board.tsx`, `task-page.tsx`, `run-controls.tsx`, `planning-parts.tsx`).

Leave out: the fire alarm holding the queue (task 27 makes "Tasks waiting to start" stop; step 2 keeps one release point it can hold); a queue per Project or per person; moving a Task down or to a place by drag; overlaps against queued or Ready Tasks; Resolve for the proof-of-concept target (it pushes the branch only, so nothing conflicts); notifications kinds for the queue (task 27's grid); the after-tier-2 fixes in the README.

## Steps

- [ ] 1. Several Tasks per Project, and Start's reasons sorted: drop `projectProblems`; `startProblems` tells a reason that only waits (the Office-wide limit, the person's Task limit) from one that refuses; the start check in the contracts (`startCheckSchema`) carries both; tests that expected the old refusal updated. Commit.
  Read: `task-start.ts`, `task-start.test.ts` (lines 61, 92), `start-service.ts`, `tasks.controller.test.ts` (around line 590), `packages/contracts/src/work.ts` (`startCheckSchema`).
- [ ] 2. The queue, the service: a queue table by migration (Task, place, queued at, reason, the Task it waits behind); Start puts a Task that only waits into it and answers so; one release, under `holdStarts`, run when a started Task ends (`TaskStateChanged` to Done or Dropped), the Office-wide limit changes and People's `RoleCardChanged`, starting the oldest that can; a queued Task whose turn meets a refusing reason leaves the queue with it; take out and move up routes; leaving Ready or Drop takes it out; events for the web. Commit.
  Read: step 1's files; `work-rows.ts` `holdStarts`; `task-changes.ts`; `work-web-events.ts`; the platform map only if a clock or timer is needed.
- [ ] 3. The queue, the web: Start's answer when queued; the "Queued" badge with place and reason on the board's card and the Task page, with "Take out of the queue" and "Move up"; Now's queue list (Notifications' `NowService.now`, `now-page.tsx`); Playwright. Commit.
  Read: `start-action.tsx`, `board.tsx`, `task-page.tsx`, `run-controls.tsx`; `now-service.ts` `now`, the Now surface map; click-through `work.js` `startProblem`, `now.js` Running, by grep.
- [ ] 4. Overlaps, the service: the Plan's files to change on the Task by migration, written by the Planner's `write_plan` (or a tool beside it) and confirmed with the Plan, in the Task's record; `domain/task-overlap.ts` (a folder covers the files under it); the start check returns overlaps with Tasks started in the same Project; Start takes "anyway" or "behind", the latter queuing the Task behind that one until it is Done or Dropped. Commit.
  Read: `planning-office-tools.ts`, `planning-changes.ts`, `record-words.ts`; step 2's queue.
- [ ] 5. Overlaps, the web: the files to change under the Plan (`PlanBlock`, editable with it); the warning on Start naming the Task and the files, with "Start anyway" and "Queue behind it"; Playwright. Commit.
  Read: `planning-parts.tsx`, `part-editor.tsx`, `start-action.tsx`.
- [ ] 6. Resolve, the git: Projects brings the fetched base into the Task's branch in its worktree and leaves the conflicted files (the shape chosen with the user: merge, or rebase stop by stop), checks no conflict markers remain and commits under the repository's lock, or gives the worktree back as it was; served to Pipelines through `TaskGit` or `TaskPublishing`; real-git tests. Commit.
  Read: `publishing.ts`, `command-line-git.ts` `conflictsOf`, `ports/git.ts`, `task-worktrees.ts`, `temporary-repository.fixtures.ts`; [testing](../../apps/service/docs/testing.md) for real-git tests.
- [ ] 7. Resolve, the walk: on a conflict at Publish, the walk puts Resolve (an Agent Stage of the Task's person, fresh session, briefed with the conflicted files), the Project's Test (back to Resolve on failure, at most twice) and a Gate into the Task's Stages before the Publish, which then runs again; `baseMovedDecision` only when Resolve gives up or the conflict comes back a third time; the Stage rows show the added Stages; a real-git service test through the scripted engine. Commit.
  Read: `stage-interpreter.ts`, `publish-stage.ts`, `walk-decisions.ts`, `task-stages.ts`, `pipeline-walk.ts`; `stage-words.ts` on the web.
- [ ] 8. `npm run verify` and `npm run verify:linux`; the live run on the Test Project; the user's look; close the task. Commit.
  Read: [the Test Project](test-project.md); [testing](../../apps/service/docs/testing.md) for the live check.

Batches for implementing subagents: A = steps 1–3 (the queue), B = steps 4–5 (overlaps), C = steps 6–7 (Resolve); step 8's checks, live run, the user's look and closing stay with the orchestrator.

## State

- Built: nothing yet. Start refuses today in `task-start.ts` `startProblems` (Project busy, Office-wide limit, Task limit, blockers, vacant Role); a conflict at Publish (`Publishing`, `conflictsOf`) becomes `baseMovedDecision` in `walk-decisions.ts`, asking the user.
- Decided with the user (2026-10-29, in the spec): the queue (2.1 "A queue for Start"), overlaps (2.1 "Overlaps at Start"), conflicts at Publish (2.3 "Conflicts at Publish"); several Tasks may be in progress in one Project; merge order stays first to Publish.
- Open questions for the user, with the proposed default (ask before the step that needs it):
  1. History after Resolve (step 6): The Office merges the fetched base into the Task's branch (one stop, a merge commit in the repository; Publish then fast-forwards), or replays the rebase stop by stop (linear history, several stops). Proposed: merge.
  2. Push + PR mode (step 7): a branch that would conflict gets Resolve too. Proposed: yes, both modes.
  3. The Gate (step 7): Quick fix and Proof of concept have none. Proposed: Resolve always adds a Gate, since the user sees the resolution before it ships.
  4. Who resolves (step 7): the Task's person (the first Agent Stage's Role, `personRole`: Developer, or Devops on an Onboard Task). Proposed: yes; no new desk taken.
  5. Resolve giving up (step 7): to the user directly, as the answer says, not the CTO first. Proposed: the user.
  6. A queued Task (steps 2–3): stays Ready with a "Queued" badge, its place and reason, rather than a new state. Proposed: badge.
  7. A queued Task whose turn meets another reason (a new blocker, a vacant Role): leaves the queue, back to plain Ready, the reason shown on its page. Proposed: leaves.
  8. Release: oldest first among the queued Tasks that can start now, so one waiting for a busy person holds none behind it. Proposed: yes.
  9. After a restart, the queue keeps and releases as usual (unlike a Stage, which never starts by itself after a restart). Proposed: yes.
  10. Overlap when a queued Task starts by itself: not checked again; the user chose at Start. Proposed: not again.
  11. Names: "Queued" and "the queue"; "Files to change" for the Plan's list (code `filesToChange`); "Overlap"; the Stage "Resolve". Proposed: these.
  12. A Plan with no files to change never overlaps. Proposed: yes.
- Traps: Start counts started Tasks under `holdStarts`; the release must take the same hold so two releases can't take one desk. Every test file shares `work_settings`; a test that lowers the limit overrides `WorkSettings` with `WorkSettingsForTests`. Agents never run git (spec 5.5's deny list and the HEAD and branch check after each Stage): Resolve's Agent edits files only. Real-git tests get `REAL_GIT_TEST`'s 30 s budget.

## Progress

- 2026-10-29 · step 0: task file written; the user's answers on the queue, overlaps and conflicts at Publish written into spec 2.1, 2.2, 2.3, 3 and 8, the glossary and coverage; next is step 1, after the open questions above that it needs (none).
