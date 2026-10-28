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
- [x] 3b. The Initiative's conversation: the `initiative` home, its Thread with the CTO (opened on shaping when a CTO is hired, or started by the user later), its session reading every Project's base branch, a Brief with its record (`initiativeRecordText`), the routes listing and starting its Threads. Commit.
  Read: `thread.ts` (a Thread's home), `briefs.ts`, `session-places.ts`, `task-thread-setups.ts`, Work's `planning-thread-setup.ts`.
- [x] 3c. The CTO's Office tools while shaping (write the outcome, add a Task, add and remove a dependency of one of its Tasks), decided under the Initiative's hold; mentioning an Initiative. Commit.
  Read: `work-office-tools.ts`, `InitiativeRepository`, `TaskRepository.changeDependencies`; `mention.ts`, `record-links.ts`, `WorkRecords`.
- [x] 3d. The Initiative Proposal once active: the same tools drafting an `initiative` `ProposedChange`, applied by Work (`InitiativeProposals`), refused for a done or dropped Initiative. Commit.
  Read: `ProposalAppliers`, `ProposalService`, Work's `OfficeLimitProposals`.
- [x] 4a. The web: the Initiatives tab, the Initiative page with the Task graph, record and thread, "Shape into an Initiative" on an Idea, the Task page's link to its Initiative. Commit.
  Read: click-through `work.js` lines 217–328; the Work surface map; the Task page's conversation panel in `shell/conversation/`.
- [ ] 4b. The web: Confirm, "Add a Task" with what it must wait for, Drop, the Initiative Proposal's card; Playwright through shaping. Commit.
  Read: `shell/conversation/proposal-card.tsx`; click-through `work.js` `workDialogs` (`new-task`).
- [ ] 5. The CTO first on failures: the walk's "no retries left" and round-limit Decisions put to the CTO when hired, their answer (one more round with guidance, or passed on to the user). Commit.
  Read: `walk-decisions.ts`, `stage-interpreter.ts` (where it opens them); `Decision.putTo`, `Consultations`, `passDecisionOn`.
- [ ] 6. The user looks at hiring the CTO, shaping an Initiative, its graph and a blocked Task; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- The CTO preset (step 1): `cto` (`CTO` in People's `known-roles.ts`), suggested name Bob, Memory, Chat and Consultant on, Task limit 2, Hard switches Consult Devops / Ask me / Never. The presets e2e hires it first, so others' `consult("cto")` reach a real Consultant.
- Dependencies (2a, 2b): `Task.blockedBy`, rules in `domain/task-dependencies.ts`, changed through `TaskService.addDependency`/`removeDependency` (`changeDependenciesHeld` in `work-rows.ts`, one lock). Web: `surfaces/work/dependencies-block.tsx`, `dependency-words.ts`, the board's `BlockedMark`.
- Initiatives (3a): `domain/initiative.ts`, `initiative-changes.ts`, `InitiativeService`; routes `POST /ideas/:id/initiative`, `GET /initiatives[/:id]`, `POST /initiatives/:id/confirm|drop|tasks|shaping`, `PUT /initiatives/:id/outcome`, its attachments. "Initiative done" Notification opens the Initiative page (`targetOf`), which reports itself in the web's activity (`pageAt`).
- The shaping Thread (3b): home `{kind: "initiative"}`; `ShapingThreadSetup` (`SHAPING_INSTRUCTIONS`, `SHAPING_OFFICE_TOOLS`, the record); read-only once the Initiative ended (`ENDED_INITIATIVE_CONVERSATION_WORDS`, the page's `readOnlyReason`).
- The CTO's tools (3c, 3d): `adapters/office-tools/shaping-office-tools.ts` (`read_initiative`, `write_outcome`, `add_task`, `add_dependency`, `remove_dependency`; `create_task` left out), each an `InitiativeEdit` (`domain/initiative-edit.ts`) passed to `InitiativeService.changeByCto`: straight onto the Initiative under its hold while shaping; on `InitiativeNotShaping` with `active`, judged (`problemsWithProposal`, `initiativeEditProblems`) and drafted through the `ProposalDrafts` port (bound to `ProposalService`). Each change checks what it asks first and the state last (`requireOpenTo`, route `straight` or `by-proposal`), so a wrong or no-op request is answered, never drafted. The user's `PUT /initiatives/:id/outcome` is `straight`.
- The Initiative Proposal (3d): Conversations' `ProposedChange` kind `initiative` (`initiativeId`, `edit`: `outcome` / `add-task` with `taskId` once applied / `add-dependency` / `remove-dependency`), in the contracts too; Work's `InitiativeProposals` applies it under the hold as proposed by the CTO, refusals turned into `ProposalRefused`. The web's `ProposalCard` shows it minimally (`ProposedInitiativeEdit`, the shared `AnswerFoot`); 4b looks at it with the Initiative page and checks it in Playwright.
- The scripted-engine check (3d): `work/application/shaping-with-the-cto.test.ts` composes Work and Conversations on `ScriptedEngineModule` (`moduleOverrides` in `test/test-application.ts`), `RoleCards` and `MemoryService` overridden for the CTO's fixed key, stand-ins for `list_projects`, Project bases and Work's Projects. A scripted `send` after the first turn has priority `later`.
- Mentions (3c, 4a): `RecordLink`/`Mention` kind `initiative`, path `/work/initiatives/:id`, `WorkRecords.initiativeRecord`; the web's chip is a router Link named as the Initiative is now, Initiatives are in the `@` picker (`mentionables`), Copy link is in the page's menu.
- The web (4a), in `surfaces/work/`: the Initiatives tab (`initiatives-list.tsx`) and the page at `/work/initiatives/$initiativeId` (`initiative-page.tsx`, a root route outside Work's tabs): head with its menu (Copy link only; 4b adds Drop, and Confirm and "Add a Task" in `task-head-actions`), the Tasks block with `task-graph.tsx` (layout and progress in `initiative-words.ts`, tested), the shaping note, Outcome (4b's Edit goes on it), Attachments and origin Idea (`attachments-block.tsx`, `origin-block.tsx`, shared with the Task page), and `RecordThreads` (shared with `TaskConversation`) with "Talk it over with {CTO}" when it has no Thread. `useCto`/`useHired` in `shell/`. "Shape into an Initiative [with {CTO}]" on a new Idea's card opens the page; a shaped Idea, in Ideas and the chat card, links its Initiative; the Task page's head links its Initiative.
- Decided with the user (2026-10-28), in spec 2.1's Defaults: shaping with or without a CTO; Tasks of a shaping Initiative planned and started like any; the CTO writes straight onto it while shaping, by Proposal once active; the user edits the outcome while shaping only (4b: an Edit on the Outcome card); a Dropped blocker no longer blocks; done once active with every not-Dropped Task Done; dropping leaves its Tasks; the CTO-first escalation of spec 2.3 is built here.
- For 4b: shaping in the running app opens a CTO session at once when a CTO is hired, so the e2e needs a scripted-engine script; the DoD's shaping box waits for its Playwright check (Confirm, applying a Proposal).
- For 4b's e2e: the graph is the group "Task graph", each node a link to its Task; a card is the link named as the Initiative. The Dialog has no accessible name: e2e tests find it by `getByRole("dialog")` and its text.
- Watch: `projects/application/worktrees.test.ts` timed out once at 5 s under a full run. Tests share the database: never assume the newest Initiative is the test's own.

## Progress

- 2026-10-28 · task file: sliced into nine steps with the user, its open questions answered; step 1, the CTO preset, is next.
- 2026-10-28 · step 1: the CTO preset, hired in the presets e2e; dependencies, the service side, are next.
- 2026-10-28 · step 2a: dependencies on the service side (rules, Start refused while blocked, routes, events, the record); the web side is next.
- 2026-10-28 · step 2b: the Task page's Dependencies block (add, remove, waiting for this Task), the board's "Blocked by", e2e seeing Start refused; the Memory e2e race fixed; Initiatives on the service side are next.
- 2026-10-28 · step 3a: Initiatives on the service side (shaping from an Idea with its Attachments, Confirm, Drop, done with its Tasks, Add a Task, the "Initiative done" Notification), the done rule settled with the user; the Initiative's conversation with the CTO is next.
- 2026-10-28 · step 3b (split into 3b–3d): the Initiative's Thread with the CTO (home, session on the base branches, Brief from its record, opened on shaping or started later; shaping without a CTO settled with the user); the CTO's tools while shaping are next.
- 2026-10-28 · step 3c: the CTO's shaping tools (outcome, Tasks, dependencies) decided in the Initiative's hold, the user's outcome route, Initiative mentions; the Initiative Proposal (3d) is next.
- 2026-10-28 · step 3d: the CTO's changes to an active Initiative drafted as an `initiative` Proposal the user applies (Work's applier, a drafting port, a minimal card), checked first then by state; the scripted-engine shaping test; the web's Initiatives tab and page (4a) are next.
- 2026-10-28 · step 4a: the Initiatives tab and the Initiative page (Task graph across Projects, record, Threads with the CTO), "Shape into an Initiative" on an Idea, links from the Task page, shaped Ideas, mentions and the "Initiative done" Notification; 4b (Confirm, Add a Task, Drop, the Proposal card, Playwright) is next.
