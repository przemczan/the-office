# 31 · The after-tier-2 fixes

Status: in progress

## Goal

Every fix in the README's "After tier 2: the remaining fixes" list is built, the two spec amendments it needs are made, and the three tier 2 items covered only by service tests are run live on the LXC, so tier 3 starts from a workspace the user would run all day from the desk.

## Definition of Done

- [ ] Each fix in the list is built, with a test where behaviour changed, and its README line removed. Check: the list is empty; `npm run verify` and `npm run verify:linux` pass.
- [ ] Spec 2.1 says Planning starts the Planner on the user's first message (D), and spec 2.7's "Today's figures" counts tokens the way problem 13 builds it. Check: the two spec sections and the code agree.
- [ ] An Agent's own Consultation escalating up to two steps and answered, an enforced Hard switch's call held for approval, and the CTO's Proposals on an active Initiative each run on the LXC, with tokens logged. Check: the driver's output, summarised in State.
- [ ] The fixes the LXC can show (B, D, G, H, K) are seen there once. Check: the same run, in State.

## Read first

- The README's [after-tier-2 list](README.md#after-tier-2-the-remaining-fixes): each fix and where it was found. Problems 1–13 have their full write-up in [archive/17-settings-acceptance.md](archive/17-settings-acceptance.md); B–K in [archive/30-tier-2-acceptance.md](archive/30-tier-2-acceptance.md).

Leave out: the phone (task 28, postponed); tier 3; fixes not on the list. A new problem found here goes to Progress and is fixed here only if it is small and in a file the step already changes; otherwise it waits for the user.

Decided with the user on 2026-10-30: one task for the whole list; H says in the let-go confirmation that the Stage finishes its current turn first (the turn is not ended); D amends spec 2.1; the three service-test-only items are run live.

## Steps

- [x] 0. Write this file and link it from the README. Commit.
- [x] 1. The board and the Task page: problems 1 (the whole card is the link), 2 (the "…" menu outside the column's overflow, flipping up), 3 (the "+ Task" dialog's wording, opening the new Task), 7 (a new Stage session's tab added after the current one, marked new), 8 (Changes folded by file, "Unfold all" and "Fold all"). Commit.
  Read: the [web map](../../apps/web/src/MAP.md) and the Work surface's map; the click-through's board and Task page.
- [x] 2. Words: problems 9 and 10 (Gate view, Stage editor, a Script Stage sent back to); task 24's command toast and `ProjectService.changeCommand`'s comment; H's let-go confirmation; C's refusal naming the rule; I's chat session instructions (shell runs only read-only git; read with Read and Grep). Commit.
  Read: the Settings, People and Projects surfaces' maps; the [Engine map](../../apps/service/src/modules/engine/MAP.md) for the refusal and the chat instructions.
- [x] 3. Problem 13, tokens without cache reads everywhere (Threads, Stages, Now, the strip) with the info icon; amend spec 2.7's "Today's figures" with the user's agreement on its wording first. Commit.
  Read: [spec 2.7 Defaults](../spec/2.7-notifications.md#defaults); problem 13 in the tier 1 archive; the Now surface's map.
- [x] 4. Chats: B (a read-only Office tool for Devops' onboarding chat reading a named local path's top level and manifests), G (a chat's Brief carries every memory note, labelled with its Project), K (`read_initiative` in every chat), F (the hire tool asks for a first name apart from the title and refuses one equal to it). Commit.
  Read: the [Conversations](../../apps/service/src/modules/conversations/MAP.md) and [People](../../apps/service/src/modules/people/MAP.md) maps.
- [x] 5. Work: D (Planning starts the Planner on the user's first message; amend spec 2.1), J (a Task's record lists its state changes with who or what made each), task 24's hold on `TaskStarted` when a later Agent Stage's Role is vacant, task 24's `project` Proposal converging on a second apply. Commit.
  Read: the [Work map](../../apps/service/src/modules/work/MAP.md); [spec 2.1](../spec/2.1-work.md); `pipelines/application/staffing-holds.ts`.
- [x] 6. Pipelines and Skills: E (a Stage commit's subject "<Stage>: <Task title>", the summary in the body), task 25's applied `skill-update` card keeping its diff, task 29's broken task 09 chat check (rebuilt through `test/live-check.ts` or retired, the user's choice). Commit.
  Read: the [Pipelines](../../apps/service/src/modules/pipelines/MAP.md) and [Skills](../../apps/service/src/modules/skills/MAP.md) maps; `pipelines/domain/stage-commit.ts`.
- [ ] 7. On the LXC from a copy of HEAD: the three service-test-only items live, and B, D, G, H, K seen once; every Role on Haiku at low effort. Stop the service if the user says so; close the task. Commit.
  Read: [Test Project](test-project.md); the memory note on the LXC; task 30's State in [its file](30-tier-2-acceptance.md) for the set-up it used.

## State

- Steps 1–4 built. Step 1 (apps/web): the card's stretched title link, the Task's "More" menu on `shell/floating-menu.tsx`, "+ Task" opening the Task, Thread tabs by `surfaces/work/thread-tabs.ts`, Changes folded per file. Step 2: Gate and Stage editor words, command toasts per command, the let-go turn note, `OfficeRules.outsideWriteRefusal`, chat instructions. Step 3: contracts' `countedTokens` behind every count, Now and Stages by kind (`TokenTotals`), `shell/token-count.tsx`; spec 2.7 amended.
- Step 4: B is Projects' `read_local_repository` (`LocalRepositories`, Devops' chat only, top level and a fixed list of manifests, 8,000 characters each, folder refusals shared with adding a Project through `ProjectChecks.repositoryFolderProblem`); G is `MemoryReach` in `domain/brief.ts` (a chat reads every note, labelled with its Project's name or "All Projects"; `BriefProject` now carries `projectId`); K is `read_initiative` with an optional `initiativeId`, in `CHAT_OFFICE_TOOLS`; F refuses a name equal to the title in `propose_role` (from scratch, preset, rename). Engine's index now exports the `OfficeTool` type.
- Step 5: D is `ThreadService.openOnTask` (Work's `TaskThreads.openOnTask`): the planning Thread opens with no session, `PLANNING_OPENING` is gone, live checks send `FIRST_PLANNING_MESSAGE` (`test/live-check.ts`'s `startPlanner`). J is `domain/state-change.ts` and table `task_state_changes` (migration 0058), written from `TaskChange.stateChange`; `TaskRecords.recordText` serves `read_task` and mentions. The staffing hold runs at the top of every walk (`StageInterpreter.walk`), so on `TaskStarted` too; its pause names The Office and the reason (`StartedTasks.hold`). A `project` Proposal applied again reuses the Project at its repository under its name with no onboarding (`NewProjects.findByPath`).
- Step 6: E is `stageCommitMessage(stage, taskTitle, …)`, "<Stage>: <Task title>" cut at 72, the result in the body; an applied `skill-update` Proposal keeps `appliedDiff` (read by `SkillUpdateProposals` before pinning; `shell/skill-update-diff.tsx` shows it without the Source); task 09's chat check is retired (deleted). Also Work's Postgres repositories know no record by an id that isn't a uuid (`canBeRowId`), so `read_task`, `read_idea`, `read_initiative` answer there is none. The README's list is empty. Next: step 7 on the LXC.
- Decided with the user on 2026-10-30: a started Task doesn't keep its commands (toast says it runs the new one from its next Stage of that command); spec 2.7's wording for tokens as now written there. D's line for spec 2.1's Defaults, word for word: "**The Planner joins on the first message** (the user's answer of 2026-10-30): moving a Task to Planning opens its planning Thread but starts no session; the Planner's first turn runs on the user's first message there, so a Plan the user writes alone costs no model call."
- Budgets already left cache reads out (`TaskTokens`); unchanged. Live checks' logs still total all four kinds (`tokensOf`).
- The other three design-system Menus stay on `Menu`; switch one by its import if it clips.
- Trap: in e2e, a click on a board card's tag or meta is caught by the title's link; click the card by position.
- Trap: `people.e2e.ts:1770` (a skill's update via the 2 s daily check) failed once in a full run and passed on reruns; flaky, not from this task.
- Decided with the user on 2026-10-31: retire task 09's check; fix the non-uuid id failure here.

## Progress

- 2026-10-30 · step 0: this file written from the user's answers (one task; H says the turn finishes; D amends spec 2.1; the three items run live); next, step 1, the board and the Task page.
- 2026-10-30 · step 1: the whole board card opens the Task, its menu floats outside the board and flips up, "+ Task" hints at planning and opens the Task, new Stage tabs land after the shown one marked New, Changes fold per file; next, step 2, the words.
- 2026-10-30 · step 2: Gate and Stage editor words, the script note on send back, command toasts as they work, the let-go turn note, the outside-worktree write refusal naming the rule, chat instructions to read with Read and Grep; next, step 3, tokens.
- 2026-10-30 · step 3: every token count leaves cache reads out (contracts' `countedTokens`) with an info icon giving the four kinds and their cost; Now and Stages send the kinds, the day tables keep them; spec 2.7 amended; next, step 4, chats.
- 2026-10-30 · step 4: Devops reads a local repository's top level and manifests from their chat, a chat's Brief carries every memory note labelled with its Project, every chat reads an Initiative by id, and a hire refuses a name equal to the title; next, step 5, Work.
- 2026-10-30 · after step 4: `propose_project` points Devops to `read_local_repository`. Found: `read_task`, `read_idea` and `read_initiative` with an id that isn't a uuid fail the call in Postgres instead of answering that there is no such record; waits for the user (not in this step's files); next, step 5, Work.
- 2026-10-31 · step 5: Planning opens its Thread and the Planner starts on the user's first message (spec 2.1 amended), a Task's record lists its state changes with who or what made each, a Task is held on start when a later Agent Stage's Role is vacant, and a `project` Proposal converges on a second apply; next, step 6, Pipelines and Skills.
- 2026-10-31 · step 6: a Stage commit's subject is "<Stage>: <Task title>", an applied skill update keeps its diff, task 09's check is retired (the user's answer), and a record read by an id that isn't a uuid answers there is none (the user's go-ahead); the after-tier-2 list is empty; next, step 7 on the LXC.
