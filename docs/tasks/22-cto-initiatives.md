# 22 · The CTO, Initiatives and dependencies

Status: in progress

## Goal

The user can hire the CTO, shape an Idea into an Initiative with them across Projects, and see its Tasks as a graph of what must be Done first. A Task can depend on any Task in any Initiative or Project, and a blocked Task cannot start. When a Stage fails with no retries left or a loop runs out of rounds, the CTO is asked before the user. Spec [2.1](../spec/2.1-work.md), [2.2](../spec/2.2-people.md), [2.3](../spec/2.3-pipelines.md), [2.4](../spec/2.4-conversations.md), [6](../spec/6-permissions-and-safety.md); ticket [07](../../.scratch/the-office/issues/07-work-model.md) and [19](../../.scratch/the-office/issues/19-work-mockup.md); coverage row §2.1, §2.2, task 22, in [coverage.md](coverage.md).

## Definition of Done

- [x] The CTO preset: hired from its preset with Memory, Chat and Consultant on, Task limit 2, Hard switches Consult Devops / Ask me / Never (Devops not hired falls back to the user). Check: a service test of the preset; Playwright hiring one.
- [x] Dependencies: the user adds and removes a Task's blockers, in any Project or Initiative; a Task can't wait for itself or close a cycle; a blocked Task can't start and says which Task it waits for, and a Dropped blocker no longer blocks; the Task page shows "Must be Done first" and "Waiting for this Task", the board marks a blocked Task. Check: a service test of the rules and of Start; Playwright adding one and seeing Start refused.
- [x] Initiatives: an Idea is shaped into an Initiative (the Idea kept as its origin, its Attachments moving with it); states shaping, active (on "Confirm the Initiative"), done (when all its Tasks are Done) and dropped; it spans the Projects of its Tasks; "Initiative done" is a Notification. Check: a service test of each state change.
- [ ] Shaping with the CTO: the Initiative's conversation is a Thread with the CTO given its record; while shaping, the CTO writes the outcome and adds Tasks and their dependencies straight onto the page; once active, each change the CTO wants is a Proposal the user applies. An Initiative can be mentioned in any chat. Check: a service test through the scripted engine; Playwright confirming an Initiative and applying a Proposal.
- [ ] The Initiatives tab and the Initiative page: cards with progress, the Task graph across Projects (blockers outside it dashed), the outcome, Attachments, the origin Idea, the shaping thread, "Add a Task" with what it must wait for, and Drop. Check: Playwright.
- [ ] The CTO first on failures: a Stage failing with no retries left, or a round limit reached, goes to the CTO when one is hired, who sends the Task back for one more round with guidance or passes it on to the user; budget limits always ask the user. Check: a service test through the scripted engine.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at hiring the CTO, shaping an Initiative, its graph and a blocked Task in the running app. Check: the commands; the user's word, logged.

## Read first

- [Work module map](../../apps/service/src/modules/work/MAP.md) (Tasks, Ideas, `task-start.ts`, `record-words.ts`) and the [Work surface map](../../apps/web/src/surfaces/work/MAP.md).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md) (Threads, Proposals and `ProposalAppliers`, Consultations and `Decision.putTo`, mentions).
- The click-through's `work.js` (`ideaToInitiative` to `initiativePage`, lines 217–328) and `task.js` (`dependencies`), by grep.

Leave out: tags, search, saved views and the Project filter (task 23); moving a Task between Projects (tier 3); Devops (task 24); a person's message to the user unprompted (`needs-you.message`), such as the CTO's "the draft is ready" in the click-through; the kinds × channels grid (task 27).

## Steps

- [x] 1. The CTO preset: the preset, its Hard switches and authority, lifting "hire from its preset" for it. Commit.
  Read: `presets.ts` (the Office Manager's, as the latest), `known-roles.ts`; spec 6's Hard switch table; the hire e2e in `people.e2e.ts`.
- [x] 2a. Dependencies, the service side: a Task's blockers (table, events, routes, WebSocket events), the rules (not itself, no cycle), Start refused while a blocker isn't Done, and the blockers in the Task's record words. Commit.
  Read: `task-start.ts`, `start-service.ts`, `task-changes.ts`, `record-words.ts`; `work.schema.ts`.
- [x] 2b. Dependencies, the web side: the Task page's Dependencies card with adding and removing, the board's blocked mark, Start's reason. Commit.
  Read: the State's file map; click-through `task.js` (`dependencies`) and `work.js` (the board card); the Task page in the Work surface.
- [x] 3a. Initiatives, the service side: the record (name, outcome, state, origin Idea), a Task's Initiative, shaping an Idea into one, Attachments on it, Confirm, Drop, done when all its Tasks are Done, the "Initiative done" Notification. Commit.
  Read: `idea-service.ts` and `IdeasController.shape`, `attachment.ts`; Notifications' `notification-kinds.ts`.
- [ ] 3b. The Initiative's conversation: its Thread with the CTO and a Brief with its record; the CTO's Office tools (outcome, add a Task, dependencies) working live while shaping and as an Initiative Proposal (`ProposedChange`, applied by Work) once active; mentioning an Initiative. Commit.
  Read: `thread.ts` (a Thread's home), `session-instructions.ts`, `ProposalAppliers` and Work's `OfficeLimitProposals`; `mention.ts`, `record-links.ts`, `WorkRecords`.
- [ ] 4a. The web: the Initiatives tab, the Initiative page with the Task graph, record and thread, "Shape into an Initiative" on an Idea, the Task page's link to its Initiative. Commit.
  Read: click-through `work.js` lines 217–328; the Work surface map; the Task page's conversation panel in `shell/conversation/`.
- [ ] 4b. The web: Confirm, "Add a Task" with what it must wait for, Drop, the Initiative Proposal's card; Playwright through shaping. Commit.
  Read: `shell/conversation/proposal-card.tsx`; click-through `work.js` `workDialogs` (`new-task`).
- [ ] 5. The CTO first on failures: the walk's "no retries left" and round-limit Decisions put to the CTO when hired, their answer (one more round with guidance, or passed on to the user). Commit.
  Read: `walk-decisions.ts`, `stage-interpreter.ts` (where it opens them); `Decision.putTo`, `Consultations`, `passDecisionOn`.
- [ ] 6. The user looks at hiring the CTO, shaping an Initiative, its graph and a blocked Task; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- The CTO preset (step 1): `cto` (`CTO` in People's `known-roles.ts`, exported), suggested name Bob, Memory, Chat and Consultant on, Task limit 2, Hard switches Consult Devops / Ask me / Never; its instructions already say it drafts a shaping Initiative alone and asks the user to confirm or change an active one. The presets e2e hires it first, so others' `consult("cto")` reach a real Consultant.
- Dependencies (steps 2a, 2b): `Task.blockedBy`, rules in `domain/task-dependencies.ts`, changed only through `TaskService.addDependency`/`removeDependency` (`TaskRepository.changeDependencies`, one lock); Start leads with `Blocked by "X", which must be Done first.`. Web: `surfaces/work/dependencies-block.tsx`, `dependency-words.ts`, the board's `BlockedMark`; e2e `waitForAnotherTaskAndStopWaiting` in `people.e2e.ts`. The CTO's tool in 3b goes through `TaskService.addDependency`.
- Initiatives, service (step 3a): `domain/initiative.ts` (name, outcome, state, `originIdeaId`, createdBy/At), `initiative-changes.ts` (`confirmInitiative`, `dropInitiative`, `finishInitiative`, `addTaskToInitiative`, `initiativeProjectIds`), events `InitiativeCreated`, `InitiativeStateChanged`; `Idea.initiativeId` and `IdeaShapedIntoInitiative` (shaping keeps the Idea's Project); `Task.initiativeId`, set only by `InitiativeRepository.addTask`; Attachment owner `initiative`. `InitiativeService` (shape, list, read, confirm, drop, addTask, the done check on `TaskStateChanged` and Confirm). Table `initiatives`, migration `0040_initiatives`. Routes `POST /ideas/:id/initiative`, `GET /initiatives[/:id]`, `POST /initiatives/:id/confirm|drop|tasks`, `/initiatives/:id/attachments[/links|/files]`; web events `initiative.created`, `initiative.state-changed`, `idea.shaped-into-initiative`. The response's `projectIds` come from its Tasks. No route writes the outcome yet: the CTO's tool in 3b does.
- "Initiative done" Notification: `outcomes.initiative-done`, from the CTO when hired, pointer `{kind: "initiative"}`, cleared by the activity page `{kind: "initiative"}`. For 4a: the web's `targetOf` sends it to `/work` until the Initiative page exists, and the web must report that page in its activity; the web's `INITIATIVES` query key is already invalidated by the events.
- Traps for 3b: whether the CTO writes straight onto an Initiative (shaping) or proposes (active) is decided under the Initiative's hold, inside `InitiativeRepository.update`, never from a read before it, so a write landing just after Confirm doesn't skip the user; applying a Proposal later checks the state again there and refuses a done or dropped one. A shaped Idea may now have no Task: the Idea's record says "into the Initiative …" (`record-words.ts`), and the web's Idea card and Ideas page show no Task for it until 4a links the Initiative.
- The Dialog has no accessible name: e2e tests find it by `getByRole("dialog")` and its text.
- Decided with the user (2026-10-28), in spec 2.1's Defaults: Tasks of a shaping Initiative are planned and started like any; while shaping the CTO writes straight onto it, once active by Proposal; a Dropped blocker no longer blocks; an Initiative is done once active with every Task that isn't Dropped Done, at least one, Confirm making it done at once; dropping leaves its Tasks; the CTO-first escalation of spec 2.3 is built here.
- Watch: `projects/application/worktrees.test.ts` timed out once at 5 s under a full run.

## Progress

- 2026-10-28 · task file: sliced into nine steps with the user, its open questions answered; step 1, the CTO preset, is next.
- 2026-10-28 · step 1: the CTO preset, hired in the presets e2e; dependencies, the service side, are next.
- 2026-10-28 · step 2a: dependencies on the service side (rules, Start refused while blocked, routes, events, the record); the web side is next.
- 2026-10-28 · step 2b: the Task page's Dependencies block (add, remove, waiting for this Task), the board's "Blocked by", e2e seeing Start refused; the Memory e2e race fixed; Initiatives on the service side are next.
- 2026-10-28 · step 3a: Initiatives on the service side (shaping from an Idea with its Attachments, Confirm, Drop, done with its Tasks, Add a Task, the "Initiative done" Notification), the done rule settled with the user; the Initiative's conversation with the CTO is next.
