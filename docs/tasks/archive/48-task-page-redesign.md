# Progress log: 48 · The Task page redesign

Moved from [48-task-page-redesign.md](../48-task-page-redesign.md) when the task was done. One line per commit, newest last.

- 2026-11-04 · drafted from docs/design: compared with the page, contracts and service; 15 questions listed; next is settling them with the user.
- 2026-11-04 · step 0: the user settled the questions; this file, spec 4 and 2.4, the glossary and the click-through rewritten; task 48 is current, task 49 added; next is step 1.
- 2026-11-04 · step 1: `definitionOfDoneMet` on the outcome and the Task's Stages, `pullRequestUrl` on Publish's outcome, Attachments on a Decision, and the read of a Task's unanswered Decisions; next is step 2.
- 2026-11-04 · step 2a: step 2 split; "Open pull request" in the head, the record's three tabs in the address, Attachments in its tab; next is 2b, the folds.
- 2026-11-04 · step 2b: Overview's blocks fold, remembered per record in the browser; token meter; the Initiative link in Origin; the Plan as Markdown; Reported met on the Definition of Done; the pull request button a real link; next is step 3.
- 2026-11-04 · step 3a: step 3 split; the Pipeline rail across the page with its words, "Edit for this Task" and the removed note in its header; next is 3b, the Stage history, keys and loop-back arcs.
- 2026-11-04 · step 3b: the Stage history, selection with the arrow keys and Esc, the loop-back arcs, and `taskThread` followed within the page; the removal of the Stages block is split off as 3c, which is next.
- 2026-11-04 · step 3c: the Stages block, its styles and `latestHandoverNote` are gone; `ProposedPipeline` has its own block in the record until step 4; the e2e read the rail and the history; next is step 4, the Needs you card.
- 2026-11-04 · step 4a: step 4 split; the Needs you card with the Task's Decisions, the take-over, the slim bar, `?decision=` landing on it, a Thread's short and answered forms; next is 4b, Attachments and the Gate in the card.
- 2026-11-04 · step 4b: a Decision's Attachments on its card, the Gate in the Needs you card with its four facts, this round's pictures and Open Changes; the Gate block and Stage results left; next is 4c.
- 2026-11-04 · step 4c: Before Ready in the card's place with Confirm and the Proposed Pipeline on their lines, beside any Decision; the card's words for Ready, Dropped and the rest; Tests reads "Not run" when any check didn't run; Tags save in order; next is step 5.
- 2026-11-04 · step 4c: the user settled it: the Gate's Tests fact counts only the checks before the Gate, so one after it is ignored; next is step 5.
- 2026-11-04 · step 5a: step 5 split; every Thread a chapter of one timeline, folded to tokens and its Handover note unless the user is on it or it holds an open Decision; rename in the head, Consultations with their note, `taskThread` unfolds and scrolls, one composer at the foot with "Write here"; next is 5b, turns and the head's way to the rail.
- 2026-11-04 · step 5b: turns in `MessageList` by `groupedMessages`, for chats too; a chapter's link per Stage selects it on the rail, the selection lifted to `TaskBody`; next is 5c, Details.
- 2026-11-04 · step 5c: the Details switch, one browser setting in the timeline's head and `ThreadView`'s, `visibleMessages` before the grouping, the latest tool line beside "is working"; the board's drop names only cards on show; next is step 6.
- 2026-11-04 · step 6a: step 6 split; the To line with its rule in `to-line.ts`, the foot in `timeline-foot.tsx`, one mounted composer, "Write here" and "Writing in" gone; next 6b, "new messages" and the e2e that close the composer box.
- 2026-11-04 · step 6b: the "new messages" button and count in `new-messages.ts`, a reader who scrolled up left alone, a To pick and a send following the Thread's newest messages; e2e of a running Stage held by scripted `send` steps closes the composer box; next step 7, the Initiative page.
- 2026-11-04 · step 7: the Initiative page has the timeline, one composer and Details, with `initiativeThread` in the address; Outcome and Attachments fold; `RecordThreads` went and `thread-tabs.ts` became `threads-seen.ts`; next step 8, narrow width and scrollbars.
- 2026-11-04 · step 8a: step 8 split; themed scrollbars in `packages/ui`, `color-scheme` per palette, and the rail scrolls to the current Stage; next is 8b, the drawer.
- 2026-11-04 · step 8b: the conversation is a drawer at 900px and below on the Task and Initiative pages, with its count, links, focus and Esc; the top bar no longer overflows; next is step 9.
- 2026-11-04 · step 9: the line for a chapter of only tool activity; the conversation sticks and fits the window; the slim bar opaque and clear of the handle; states and Kept walked, design README adopted, Turn in the glossary; next is the user's review of the states.
- 2026-11-04 · step 9: the flaky test's Decision reopened behind its last read, as its session had no script; it now answers in a Stage Thread. A Stopped Task's head reads Stopped; the three answers settled; next is the user's review of the states.
- 2026-11-04 · step 8c: the head, rail, Stage history, Needs you, folds and conversation drawn as the design, checked beside the mock with its data in Light and Dark; step 9's review is next.
- 2026-11-04 · step 9: the user's notes on the page became task 51 and its design proposal; maps up to date, `npm run verify:linux` passes; task done
