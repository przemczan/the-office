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
- [x] 7. On the LXC from a copy of HEAD: the three service-test-only items live, and B, D, G, H, K seen once; every Role on Haiku at low effort. Stop the service if the user says so; close the task. Commit.
  Read: [Test Project](test-project.md); the memory note on the LXC; task 30's State in [its file](30-tier-2-acceptance.md) for the set-up it used.

## State

- Steps 1–6 built every fix on the list (where each lives: the commit bodies of steps 1–6); the README's list is empty; spec 2.1's Defaults and 2.7's "Today's figures" amended and matching the code. `npm run verify` and `npm run verify:linux` pass at step 7.
- Step 7's run (2026-10-31), a fresh Office from HEAD on the LXC: `/root/the-office-31`, service on 4331 (`ssh -L 4331:127.0.0.1:4331`), Postgres compose `office31` on 5462, data `/root/office-data-31`, log `/root/office31.log` (no ERROR or WARN line). Test Project `/root/notnullsoft-admin-31`, bare origin `/root/notnullsoft-admin-31-origin.git`, base branch `office-31-base`, merge mode. Driver `/root/o31.mjs` (port from `OFFICE_PORT`, default 4331). Every Role on Haiku at low effort. Task 30's service on 4330 is still up, untouched.
- The three service-test-only items, live: (1) the Developer's own `consult` for `npm install -D cross-env` went to Devops, who passed it on to the CTO (`passedOn` devops, `putTo` cto), the CTO chose Allow once, and the answer came as the Developer's next message; it installed and published (Developer 1.7k out, 108k cache reads; Devops 0.5k, 48k; CTO 0.4k, 50k). (2) The Planner's `change_role` behind Change Roles at ask-me opened an approval Decision; after Allow once the identical repeat ran once and the Reviewer's card went to version 3 (3.1k out, 224k reads). (3) On the active Initiative the CTO's outcome, add-task and add-dependency each came as a Proposal, applied (thread total 2.0k out, 277k reads).
- Seen once: B (Devops called `read_local_repository` and proposed the commands from `package.json`; 2.3k out, 97k reads); D (two planning Threads at 0 tokens until a first message; a Plan written by the user alone ran no Planner turn); G (a new Planner chat named its Project note's Project, NotNullSoft Admin, from the Brief); K (`read_initiative` by bare id, and "Task abc-123 does not exist"); H (the let-go dialog's text, opened in headless Chromium, not confirmed); E on the way (commit subjects "Implement: <Task title>").
- Day's figures: 288k counted tokens (input 118, output 20.4k, cache writes 267k), 1.50M cache reads.
- Set-up choices on the LXC copy, not defects: the base branch's upstream set after the first Publish failed on it; merge mode set after a Publish failed on missing `gh`; Devops' card reworded so approving another person's install is passed to the CTO (the preset lets Devops decide installs alone); the Reviewer's instructions restored after the held change.
- Found, waiting for the user (Progress, step 7): the Planner still tries Bash first; a Role change made through `change_role` records no proposer; the Onboard Task asks the user to Mark Done when onboarding needed no fixes; the CTO can't add a Task and its dependency in one turn on an active Initiative.
- Open: whether to stop the 4331 and 4330 services and their compose projects (`office31`, `office30`).
- Trap: `people.e2e.ts:1770` (a skill's update via the 2 s daily check) failed once in a full run and passed on reruns; flaky, not from this task.

## Progress

- 2026-10-30 · step 0: this file written from the user's answers (one task; H says the turn finishes; D amends spec 2.1; the three items run live); next, step 1, the board and the Task page.
- 2026-10-30 · step 1: the whole board card opens the Task, its menu floats outside the board and flips up, "+ Task" hints at planning and opens the Task, new Stage tabs land after the shown one marked New, Changes fold per file; next, step 2, the words.
- 2026-10-30 · step 2: Gate and Stage editor words, the script note on send back, command toasts as they work, the let-go turn note, the outside-worktree write refusal naming the rule, chat instructions to read with Read and Grep; next, step 3, tokens.
- 2026-10-30 · step 3: every token count leaves cache reads out (contracts' `countedTokens`) with an info icon giving the four kinds and their cost; Now and Stages send the kinds, the day tables keep them; spec 2.7 amended; next, step 4, chats.
- 2026-10-30 · step 4: Devops reads a local repository's top level and manifests from their chat, a chat's Brief carries every memory note labelled with its Project, every chat reads an Initiative by id, and a hire refuses a name equal to the title; next, step 5, Work.
- 2026-10-30 · after step 4: `propose_project` points Devops to `read_local_repository`. Found: `read_task`, `read_idea` and `read_initiative` with an id that isn't a uuid fail the call in Postgres instead of answering that there is no such record; waits for the user (not in this step's files); next, step 5, Work.
- 2026-10-31 · step 5: Planning opens its Thread and the Planner starts on the user's first message (spec 2.1 amended), a Task's record lists its state changes with who or what made each, a Task is held on start when a later Agent Stage's Role is vacant, and a `project` Proposal converges on a second apply; next, step 6, Pipelines and Skills.
- 2026-10-31 · step 6: a Stage commit's subject is "<Stage>: <Task title>", an applied skill update keeps its diff, task 09's check is retired (the user's answer), and a record read by an id that isn't a uuid answers there is none (the user's go-ahead); the after-tier-2 list is empty; next, step 7 on the LXC.
- 2026-10-31 · step 7: on a fresh Office on the LXC, a two-step Consultation answered, a held `change_role` allowed once, the CTO's Proposals applied on an active Initiative; B, D, G, H, K seen. Found, waiting for the user: the Planner tries Bash before Read; a `change_role` change has no proposer in the Role's history; Onboard asks to Mark Done when nothing needed fixing; an add-task Proposal can't carry its dependency; next, close the task.
