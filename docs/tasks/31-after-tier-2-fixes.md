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
- [ ] 4. Chats: B (a read-only Office tool for Devops' onboarding chat reading a named local path's top level and manifests), G (a chat's Brief carries every memory note, labelled with its Project), K (`read_initiative` in every chat), F (the hire tool asks for a first name apart from the title and refuses one equal to it). Commit.
  Read: the [Conversations](../../apps/service/src/modules/conversations/MAP.md) and [People](../../apps/service/src/modules/people/MAP.md) maps.
- [ ] 5. Work: D (Planning starts the Planner on the user's first message; amend spec 2.1), J (a Task's record lists its state changes with who or what made each), task 24's hold on `TaskStarted` when a later Agent Stage's Role is vacant, task 24's `project` Proposal converging on a second apply. Commit.
  Read: the [Work map](../../apps/service/src/modules/work/MAP.md); [spec 2.1](../spec/2.1-work.md); `pipelines/application/staffing-holds.ts`.
- [ ] 6. Pipelines and Skills: E (a Stage commit's subject "<Stage>: <Task title>", the summary in the body), task 25's applied `skill-update` card keeping its diff, task 29's broken task 09 chat check (rebuilt through `test/live-check.ts` or retired, the user's choice). Commit.
  Read: the [Pipelines](../../apps/service/src/modules/pipelines/MAP.md) and [Skills](../../apps/service/src/modules/skills/MAP.md) maps; `pipelines/domain/stage-commit.ts`.
- [ ] 7. On the LXC from a copy of HEAD: the three service-test-only items live, and B, D, G, H, K seen once; every Role on Haiku at low effort. Stop the service if the user says so; close the task. Commit.
  Read: [Test Project](test-project.md); the memory note on the LXC; task 30's State in [its file](30-tier-2-acceptance.md) for the set-up it used.

## State

- Steps 1–3 built. Step 1 (apps/web): the card's stretched title link, the Task's "More" menu on `shell/floating-menu.tsx`, "+ Task" opening the Task, Thread tabs by `surfaces/work/thread-tabs.ts`, Changes folded per file. Step 2: Gate and Stage editor words, command toasts per command, the let-go turn note, `OfficeRules.outsideWriteRefusal`, chat instructions. Step 3: contracts' `countedTokens` (input, output, cache writes) behind every count; Now's `tokensToday` and a Stage's `tokens` are now the four kinds (`TokenTotals`), the day tables by kind (migrations 0056–0057, which empty them once); `shell/token-count.tsx` shows the count with its info icon. Spec 2.7 amended. Next: step 4, chats (B, G, K, F).
- Decided with the user on 2026-10-30: a started Task doesn't keep its commands (toast says it runs the new one from its next Stage of that command); spec 2.7's wording for tokens as now written there.
- Budgets already left cache reads out (`TaskTokens`); unchanged. Live checks' logs still total all four kinds (`tokensOf`).
- The other three design-system Menus stay on `Menu`; switch one by its import if it clips.
- Trap: in e2e, a click on a board card's tag or meta is caught by the title's link; click the card by position.
- Trap: `people.e2e.ts:1770` (a skill's update via the 2 s daily check) failed once in a full run and passed on reruns; flaky, not from this task.
- Open, ask at step 6: rebuild or retire task 09's check.

## Progress

- 2026-10-30 · step 0: this file written from the user's answers (one task; H says the turn finishes; D amends spec 2.1; the three items run live); next, step 1, the board and the Task page.
- 2026-10-30 · step 1: the whole board card opens the Task, its menu floats outside the board and flips up, "+ Task" hints at planning and opens the Task, new Stage tabs land after the shown one marked New, Changes fold per file; next, step 2, the words.
- 2026-10-30 · step 2: Gate and Stage editor words, the script note on send back, command toasts as they work, the let-go turn note, the outside-worktree write refusal naming the rule, chat instructions to read with Read and Grep; next, step 3, tokens.
- 2026-10-30 · step 3: every token count leaves cache reads out (contracts' `countedTokens`) with an info icon giving the four kinds and their cost; Now and Stages send the kinds, the day tables keep them; spec 2.7 amended; next, step 4, chats.
