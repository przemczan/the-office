# 18 · Tier 1 fixes: the acceptance run's problems

Status: in progress

## Goal

Fix the problems the tier 1 acceptance run surfaced ([archive/17-settings-acceptance.md](archive/17-settings-acceptance.md), Progress, step 5), so the base reads clearly before tier 2 builds on it. Each problem's proposed fix there is the requirement; the numbers below are its numbers.

## Definition of Done

- [x] Markdown (12): messages, handover notes, Stage outcomes and Decision text render Markdown, sanitised, with no raw HTML. Check: a unit test that a `<script>` and an `onerror` attribute come out as text; Playwright sees a handover note's list and heading. (`markdown-text.test.tsx`; `people.e2e.ts`, the Decision test's Handover note.)
- [x] Message fields (11): the Composer, a Decision's free answer and a Gate's feedback send on Enter and break on Shift+Enter; while the Agent is answering, Enter says why it can't send. Check: the shared field's unit test; Playwright in the Composer and the Gate's feedback. (`message-field.test.tsx`; `people.e2e.ts`, the chat tests and the Gate test.)
- [x] Working indicator (4): a Thread shows "<name> is working…" from the moment a turn starts until it ends, in every Thread. Check: a unit test of the Thread's log while answering with no output yet. (`message-list.test.tsx`.)
- [ ] Work board and "+ Task" (1, 3): the whole card opens the Task, its menu and buttons stop the click; the "+ Task" dialog says where the work is described and opens the new Task's page. Check: Playwright on a board with one Task.
- [ ] Ready and new Stage tabs (6, 7): a Ready Task says "Ready: start it when you want; nothing starts by itself"; a Stage session that starts adds its tab right after the current one, marked new, and leaves the user where they are. Check: Playwright.
- [ ] Gate (9, 10): the Gate view says "Look at the work so far, then Continue, Send back with feedback, or Drop"; the Stage editor says under a Gate's name that it is a label for the user; send back defaults to the latest Agent Stage, and a Script Stage chosen there says it can't read the feedback and only runs again. Check: a unit test for the default; Playwright for the words.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at each fix in the running app. Check: the commands; the user's word, logged below.

## Read first

- The problems with their fixes: [archive/17-settings-acceptance.md](archive/17-settings-acceptance.md), lines 13–29.
- The [Work surface map](../../apps/web/src/surfaces/work/MAP.md) and the [web app map](../../apps/web/src/MAP.md) (`shell/conversation/`, `shell/work/`, `shell/pipelines/`).
- The [e2e map](../../apps/web/e2e/MAP.md): its traps decide which file a new test goes in.

Leave out: everything tier 2 (spec 3), including a queue for Start and a confirmation when a Task is Ready (problem 6 only says that nothing starts by itself). This task holds only the fixes that are cheap to make; problems 2 (the clipped card menu), 5 (the "Before Ready" checklist), 8 (folding the Changes tab) and 13 (tokens, which amends spec 2.7) wait for the fixes after tier 2 ([README](README.md#after-tier-2-the-remaining-fixes)), as does any later fix that is not cheap or needs a spec change.

## Steps

- [x] 1. Markdown (12): one sanitised Markdown view in the shell, used for messages, handover notes, Stage outcomes and Decision text. Adding the renderer is a new dependency: name it and why in the commit. Commit.
  Read: `shell/conversation/message-list.tsx`, `decision-card.tsx`, `surfaces/work/stage-words.ts` (`latestHandoverNote`) and where Stage outcomes show, by range; the Message styles in [app/conversation.js](../../.scratch/the-office/prototypes/app/conversation.js), by grep.
- [x] 2. Message fields and the working indicator (11, 4): one keyboard rule shared by the Composer, the Decision's free answer and the Gate's feedback; while busy, Enter explains; the Thread's working line from turn start to first output, read from the Thread's `answering` state and its messages. Commit.
  Read: `shell/conversation/composer.tsx`, `thread-view.tsx`, `decision-card.tsx`, `shell/work/gate-actions.tsx`; `threadStateSchema` in `packages/contracts/src/conversations.ts`; the Conversations module map if the service needs to say when a turn started.
- [ ] 3. The board and "+ Task" (1, 3): the card as the link, the dialog's hint and opening the new Task. Commit.
  Read: `surfaces/work/board.tsx`, `task-menu.tsx`, `new-task-dialog.tsx`.
- [ ] 4. Ready and new Stage tabs (6, 7): the Ready words where Ready is shown (the Mark Ready toast in `use-planning.ts` already says part of it); a new Stage tab after the current one, marked new, without switching. Commit.
  Read: `surfaces/work/use-planning.ts`, `task-record.tsx` or `task-page.tsx` where the state shows, `task-conversation.tsx`.
- [ ] 5. The Gate (9, 10): the Gate view's instruction, the Stage editor's note under a Gate's name, the send-back default and the Script Stage note. Commit.
  Read: `surfaces/work/gate-view.tsx`, `shell/work/gate-actions.tsx`, `gate-words.ts` (`defaultSendBackTarget`), `shell/pipelines/stage-editor.tsx`.
- [ ] 6. The user looks at each fix in the running app; `npm run verify:linux`; close the task. Commit.
  Read: [test-project.md](test-project.md) if the user wants it on the Test Project.

## State

- Tier 2's order was accepted by the user on 2026-10-27 ([README](README.md)); this task fixes tier 1's problems first. Tasks 19–30 get their files when they become current, after their open questions (spec 8) are settled with the user.
- Decided with the user (2026-10-27): this task keeps only the cheap fixes (1, 3, 4, 6, 7, 9, 10, 11, 12); 2, 5, 8 and 13 moved to the README's "After tier 2: the remaining fixes", where any later fix that is not cheap or amends the spec goes too. The "Before Ready" checklist, when built, sits in the planning panel.
- Built (step 1): `apps/web/src/shell/markdown-text.tsx`, `MarkdownText` on `react-markdown` with `remark-gfm` and `remark-breaks` (a single line break stays a break); `inline` for a line inside a row. Used for user and person messages, Handover notes (message list and Stage row), the Brief, a Decision's question, context and recommendation reason, a free answer, and a Stage row's detail line (inline, so a script's summary shows its code spans). Tooltips and `aria-label`s stay plain (`firstLine` in `stage-words.ts`).
- Trap: a Stage row's detail joins The Office's words and Stage names with the outcome; a Stage name with Markdown characters renders as Markdown there.
- Built (step 2): `shell/conversation/message-field.tsx`, `MessageField`, the one keyboard rule (Enter sends, Shift+Enter breaks, Enter while busy shows the reason under the field) for the Composer, the Decision's free answer and the Gate's feedback. The Thread's working line was already there from turn start (the Thread is `answering` as soon as the turn begins, and tool lines stream live), but as a static grey caption; it is now a spinning, body-size "<name> is working…" with `role="status"`.
- Next: step 3, the board and "+ Task".

## Progress

- 2026-10-27 · slicing: tier 2 ordered into tasks 18–30 with the user, this task's file written; next, step 1, Markdown.
- 2026-10-27 · step 1: Markdown in messages, Handover notes, the Brief, Decisions and Stage rows through one sanitised `MarkdownText`; next, step 2, message fields and the working indicator.
- 2026-10-27 · step 2: one message field for the Composer, Decision answers and Gate feedback (Enter sends, Shift+Enter breaks, busy Enter explains); the working line made visible; next, step 3, the board and "+ Task".
- 2026-10-27 · replanned with the user: only the cheap fixes stay here; 2, 5, 8 and 13 move to the fixes after tier 2, and the user's look becomes step 6. Next, step 3.
