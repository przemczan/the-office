# 18 · Tier 1 fixes: the acceptance run's problems

Status: in progress

## Goal

Fix the problems the tier 1 acceptance run surfaced ([archive/17-settings-acceptance.md](archive/17-settings-acceptance.md), Progress, step 5), so the base reads clearly before tier 2 builds on it. Each problem's proposed fix there is the requirement; the numbers below are its numbers.

## Definition of Done

- [x] Markdown (12): messages, handover notes, Stage outcomes and Decision text render Markdown, sanitised, with no raw HTML. Check: a unit test that a `<script>` and an `onerror` attribute come out as text; Playwright sees a handover note's list and heading. (`markdown-text.test.tsx`; `people.e2e.ts`, the Decision test's Handover note.)
- [x] Message fields (11): the Composer, a Decision's free answer and a Gate's feedback send on Enter and break on Shift+Enter; while the Agent is answering, Enter says why it can't send. Check: the shared field's unit test; Playwright in the Composer and the Gate's feedback. (`message-field.test.tsx`; `people.e2e.ts`, the chat tests and the Gate test.)
- [x] Working indicator (4): a Thread shows "<name> is working…" from the moment a turn starts until it ends, in every Thread. Check: a unit test of the Thread's log while answering with no output yet. (`message-list.test.tsx`.)
- [x] Before Ready (5, 6): the planning panel shows a "Before Ready" checklist (Plan confirmed, Definition of Done confirmed, Pipeline taken or declined, no Decision waiting), each line ticking as it is met, built from the same Work rules that refuse Mark Ready; Mark Ready is disabled until every line is met; a Ready Task says "Ready: start it when you want; nothing starts by itself". Check: a domain test that the checklist and the refusal reasons agree; Playwright ticking the lines one by one. (`task-states.test.ts`, "the Before Ready checklist"; `people.e2e.ts`, the planning test.)
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at each fix in the running app. Check: the commands; the user's word, logged below.

## Read first

- The problems with their fixes: [archive/17-settings-acceptance.md](archive/17-settings-acceptance.md), lines 13–29.
- The [Work surface map](../../apps/web/src/surfaces/work/MAP.md) and the [web app map](../../apps/web/src/MAP.md) (`shell/conversation/`, `shell/work/`, `shell/pipelines/`).
- The [e2e map](../../apps/web/e2e/MAP.md): its traps decide which file a new test goes in.

Leave out: everything tier 2 (spec 3), including a queue for Start and a confirmation when a Task is Ready (problem 6 only says that nothing starts by itself). This task holds only the fixes that would be harder to make after tier 2 changes the code around them; the rest (1, 2, 3, 7, 8, 9, 10, 13) wait for the fixes after tier 2 ([README](README.md#after-tier-2-the-remaining-fixes)), as does any later fix that won't get harder by waiting.

## Steps

- [x] 1. Markdown (12): one sanitised Markdown view in the shell, used for messages, handover notes, Stage outcomes and Decision text. Adding the renderer is a new dependency: name it and why in the commit. Commit.
  Read: `shell/conversation/message-list.tsx`, `decision-card.tsx`, `surfaces/work/stage-words.ts` (`latestHandoverNote`) and where Stage outcomes show, by range; the Message styles in [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js), by grep.
- [x] 2. Message fields and the working indicator (11, 4): one keyboard rule shared by the Composer, the Decision's free answer and the Gate's feedback; while busy, Enter explains; the Thread's working line from turn start to first output, read from the Thread's `answering` state and its messages. Commit.
  Read: `shell/conversation/composer.tsx`, `thread-view.tsx`, `decision-card.tsx`, `shell/work/gate-actions.tsx`; `threadStateSchema` in `packages/contracts/src/conversations.ts`; the Conversations module map if the service needs to say when a turn started.
- [x] 3. Before Ready (5, 6): the readiness lines from the Work domain's Ready rules (`markTaskReady` and `stateChangeProblems` in `apps/service/src/modules/work/domain/task-changes.ts`) on the Task's view, the checklist in the planning panel, Mark Ready disabled until met, the Ready words. Commit.
  Read: the [Work module map](../../apps/service/src/modules/work/MAP.md); `surfaces/work/planning-actions.tsx`, `planning-parts.tsx`, `use-planning.ts`; the Task contract in `packages/contracts/src/`.
- [ ] 4. The user looks at each fix in the running app; `npm run verify:linux`; close the task. Commit.
  Read: [test-project.md](test-project.md) if the user wants it on the Test Project.

## State

- Tier 2's order was accepted by the user on 2026-10-27 ([README](README.md)); this task fixes tier 1's problems first. Tasks 19–30 get their files when they become current, after their open questions (spec 8) are settled with the user.
- Decided with the user (2026-10-27): a fix is made now only when it would be harder after tier 2's changes; the rest wait in the README's "After tier 2: the remaining fixes" (spec amendments agreed then). Kept here: 5 and 6, so Ready's conditions are one list in the Work domain before tier 2 adds more (Initiatives, dependencies, a Start queue); 11 and 12 were already built. The checklist sits in the planning panel.
- Trap for tier 2: problem 13 changes what a token count holds; new token figures (the Office Manager's status view, phone views) must use the existing sums (`threadTokens`, `totalTokens`, the Now sum), so the later change stays in those three places.
- Built (step 1): `apps/web/src/shell/markdown-text.tsx`, `MarkdownText` on `react-markdown` with `remark-gfm` and `remark-breaks` (a single line break stays a break); `inline` for a line inside a row. Used for user and person messages, Handover notes (message list and Stage row), the Brief, a Decision's question, context and recommendation reason, a free answer, and a Stage row's detail line (inline, so a script's summary shows its code spans). Tooltips and `aria-label`s stay plain (`firstLine` in `stage-words.ts`).
- Trap: a Stage row's detail joins The Office's words and Stage names with the outcome; a Stage name with Markdown characters renders as Markdown there.
- Built (step 2): `shell/conversation/message-field.tsx`, `MessageField`, the one keyboard rule (Enter sends, Shift+Enter breaks, Enter while busy shows the reason under the field) for the Composer, the Decision's free answer and the Gate's feedback. The Thread's working line was already there from turn start (the Thread is `answering` as soon as the turn begins, and tool lines stream live), but as a static grey caption; it is now a spinning, body-size "<name> is working…" with `role="status"`.
- Built (step 3): `readinessLines` in `task-states.ts` is the one list of Ready's conditions (refusals and checklist both come from it); `GET /tasks/:id/readiness` (`Readiness` contract); `surfaces/work/ready-block.tsx` ("Before Ready" in the record, "Ready" words once Ready); `useReadyConditionsMet` disables Mark Ready in the head and the menu. A Decision's events now also refresh `["tasks"]`, since a waiting Decision is one line.
- Found by the user (2026-10-27): talking to the Planner on a Done Task failed with a misleading "binary failed to launch" (its worktree is gone after Publish). Decided with the user: a Done Task's Threads are read-only with a plain reason. Built: `TaskThreadSetup.sessionRefusal` (Work fills it for Done; `SessionPlaces` refuses a session with it, while labels and Briefs still read the setup), and `ThreadView`'s `readOnlyReason` swaps the Composer for the reason. Trap: `ThreadContexts` and `Briefs` call the setup for every Thread read, so the setup must never throw for a Done Task.
- Next: step 4, the user looks at each fix in the running app; `npm run verify:linux`; close the task.

## Progress

- 2026-10-27 · slicing: tier 2 ordered into tasks 18–30 with the user, this task's file written; next, step 1, Markdown.
- 2026-10-27 · step 1: Markdown in messages, Handover notes, the Brief, Decisions and Stage rows through one sanitised `MarkdownText`; next, step 2, message fields and the working indicator.
- 2026-10-27 · step 2: one message field for the Composer, Decision answers and Gate feedback (Enter sends, Shift+Enter breaks, busy Enter explains); the working line made visible; next, step 3, the board and "+ Task".
- 2026-10-27 · replanned with the user: only the cheap fixes stay here; 2, 5, 8 and 13 move to the fixes after tier 2, and the user's look becomes step 6. Next, step 3.
- 2026-10-27 · replanned with the user: only fixes that get harder after tier 2 stay (5, 6); 1, 2, 3, 7, 8, 9, 10 and 13 wait. Next, step 3, Before Ready.
- 2026-10-27 · step 3: the "Before Ready" checklist from one list of Ready's conditions, Mark Ready disabled until met, the Ready words; next, step 4, the user's look and closing.
- 2026-10-27 · found by the user: a Done Task's Threads are read-only with a plain reason, and the service refuses a session on them; next, step 4, the user's look and closing.
