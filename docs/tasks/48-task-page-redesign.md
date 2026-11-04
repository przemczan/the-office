# 48 · The Task page redesign

Status: in progress

## Goal

The Task page takes the design in [docs/design/task-page.html](../design/task-page.html). A full-width Pipeline rail shows where the Task is and each Stage's history. A full-width Needs you card under it holds everything that waits on the user. Below them sit a tabbed record (Overview with foldable blocks, Changes, Attachments) and one conversation showing every Thread of the Task as a timeline, with folding and a Details switch. The Initiative page takes the same conversation and foldable record, and chats take the same turns. No feature of today's page is lost unless [What was settled](#what-was-settled) removes it.

## Definition of Done

- [x] Spec 4 and the click-through describe the new page. Check: read spec 4's Task page line against the click-through, done 2026-11-04.
- [ ] The rail shows every Stage of the Task, before Start too, with its person or command, state, runs, time and tokens, in all eight Stage states. A loop-back draws its arc from the runs' `carriedFailure`. Selecting a Stage opens its history: each run's times, tokens, session, carried failure, send-back feedback, commands, Gate action, outcome and Handover note, with a way to its Thread. The arrow keys and Esc work. Check: unit tests of the rail's words and loops; e2e of selecting a Stage on a Task with a loop-back.
- [ ] The Needs you card shows each open Decision and a waiting Gate, answered there, and says so when nothing waits. A Decision waiting on a Consultant shows marked "Waiting on X", not counted, with its take-over. A slim bar shows while the card is out of view. A Decision's `?decision=` link lands on its card. In a Thread a Decision shows its short form, then its answered form. Check: e2e of answering a Decision, a Consultation take-over, and Continue, Send back and Drop.
- [ ] A Decision can name Attachments of its Task, of any kind, and its card shows them: pictures at the one screenshot size with the viewer, the others as chips. Check: service test of `open_decision` with Attachments, refusing one from another record; e2e of the card.
- [ ] The Gate's card shows four facts (Files changed, Lines, Tests, Definition of Done), the pictures of this round and Open Changes, beside `GateActions`. Check: web test of the facts, Tests with a failed result and with none; e2e of Open Changes.
- [ ] In Planning the card's place holds Before Ready: today's checklist with the Plan's and Definition of Done's Confirm and the `ProposedPipeline`. Mark Ready stays the user's step. Check: e2e of confirming each part and Mark Ready.
- [ ] The record has the tabs Overview, Changes and Attachments, each in the address. Overview's blocks fold, are remembered per Task in the browser, and start open in Planning for the Plan and the Definition of Done. Check: e2e of a fold surviving a reload; of Attachments by round, with Add and the viewer stepping through every picture.
- [ ] The Definition of Done shows which statements are Reported met, by the same rule the walk uses. Check: service test of the outcome in the response; web test of the words, with a later run lowering the count.
- [ ] A Task that published shows "Open pull request" in its head, from a `pullRequestUrl` on Publish's outcome. Check: service test of the outcome; web test of the button, and of no button on an older run without the field.
- [ ] The conversation shows every Thread of the Task in order, each folded to one line with its Handover note unless it is the Thread the user is on or holds an open Decision. Every message kind still renders. One author's neighbouring messages join into a turn, in chats too. Check: e2e with several Threads; unit tests of which Thread starts unfolded and of grouping into turns.
- [ ] The Details switch, off at first, hides tool activity and the context lines with their Brief; refusals, failures, held lines and delivery marks always show, and the latest tool line shows beside "is working". It is one setting, remembered in the browser, shared by the Task page, the Initiative page and chats. Check: e2e of the switch on the Task page and in a chat.
- [ ] One composer has a "To" line that starts on the live Thread (the running Stage's, else the one with an open Decision, else the newest writable) and switches to any writable Thread; with none writable it says why. A Stage Thread stays closed when no Stage runs, as today. The context label keeps Start fresh, Continue anyway and Auto with their costs. New messages never move a reader who scrolled up; a "new messages" button brings them to the end. Check: e2e of barge-in, a Planner message on a running Task, joining a Consultation, and scrolling up while messages arrive.
- [ ] The Initiative page shows its Threads as the same timeline with one composer and Details, and its blocks fold, remembered per Initiative in the browser. It has no rail, no tabs and no Needs you card. Check: e2e of a fold surviving a reload and of writing in a chosen Thread.
- [ ] Every action in [Kept from today's page](#kept-from-todays-page) works in its new place. Check: the existing e2e tests, moved to the new layout, pass.
- [ ] At 900px and below the conversation is a drawer with an unread count, and the rail scrolls to the current Stage. The themed scrollbars are in `packages/ui`. Light and Dark both read right. Check: e2e at narrow width; screenshots in both palettes.
- [ ] The design README says the design was adopted. Check: read it.
- [ ] `npm run verify` and `npm run verify:linux` pass.

## Read first

- [docs/design/README.md](../design/README.md): the choices made and what the implementation must keep.
- [docs/design/task-page.html](../design/task-page.html) opened in a browser. Its CSS and script are about 170 KB without the fonts, so grep a function and read its range. Its markup, CSS and data are not to be copied (the README says why).
- The [Work surface map](../../apps/web/src/surfaces/work/MAP.md) and [the web app's map](../../apps/web/src/MAP.md).

Leave out:

- The phone (task 28 is postponed). Narrow here means a narrow desktop window.
- Attachment versions (task 39).
- The demo controls of the mock-up (scenario, width and palette switches, "Forget remembered folds").

## What was settled

The user's answers of 2026-11-04. Spec 4, spec 2.4 and the glossary carry them; this is what they leave out or what the build must not undo.

- **Talking to an Agent when no Stage runs:** not here. A Stage Thread takes messages only while its Stage runs, and at a Gate the way to reach the Agent is Send back. The mock's "Continues the session" is out. Task 49 will decide it.
- **Attachments on a Decision:** an optional list of the Task's Attachments the Agent names in `open_decision`, any kind, when the Decision is about them. No `facts` field. If the card turns out too small to view them comfortably, stop and rethink it with the user.
- **The Gate:** as the mock draws it. Stage results leave for the rail, the diff for Open Changes, non-picture Attachments for the tab, and each test's result for Changes. Tests reads "Passed", "n failed" or "Not run". The Definition of Done fact is the Reported met count.
- **Planning:** Needs you stays Decisions and Gates; no "To confirm". No "Confirm both", and a Task never becomes Ready by itself.
- **The pull request:** the head button only, no Attachment. Parsing the summary text is not an option.
- **"Duplicate":** left out.
- **Chats:** take turns, the message styling and the Details switch, so two looks can't drift. The "To" line is for the timeline only: a chat modal shows one Thread, picked from its own list.
- **The Initiative page:** an Initiative has no Decisions (`decisions.task_id` is required, and spec 2.4 gives its conversation shaping only), so it gets no Needs you card.

### The states the mock doesn't show

No new mock-up; these are built from this table and the user reviews them in the running app.

| State | Head actions | Rail | Card under the rail |
| --- | --- | --- | --- |
| Backlog | Plan with…, Start rules as today | Library Stages, "Not started" | Nothing needs you |
| Planning | Mark Ready | Library Stages or the Task's copy | Before Ready |
| Ready | Start, with Usage estimate, Overlap and queue as today | As Planning | "Ready: start it when you want", with the Usage estimate |
| Queued | Queued mark, Move up, Take out of the queue | As Planning | Nothing needs you |
| Paused | Resume, with its words as today | Held Stage shows Paused | An open Decision if any, else nothing |
| Stopped | Resume, with its words as today | Held Stage shows Stopped | As Paused |
| Paused by the alarm | As today | As Paused | As Paused |
| Dropped | None | As it stood | "This Task was dropped"; composer read-only |

## Kept from today's page

Places the mock doesn't show:

- **Head:** Project chip, Tags editable in place (the mock shows them as text), priority, Pipeline name with "edited for this Task", Plan with…, Mark Ready, Start with its Overlap and queue flows, Pause and Stop (Stop stays while Waiting on you; the mock shows only Pause), Resume with its words, and the More menu. The token meter shows only when the Task has `estimatedTokens`; otherwise the plain count. Both keep the breakdown on hover.
- **Rail:** "Edit for this Task" moves to the rail's header, and stays in More. A removed Pipeline shows today's note. A Gate's send-back shows in the Stage's history, without an arc.
- **Overview:** Files to change and the Planner's estimate inside the Plan's fold. Edit and its editors on the fold's side; Confirm is in Before Ready. Dependencies whole, with add and remove. Origin shows for an Idea or an Initiative, so the Initiative link moved there from the head always has a place. The Plan renders as Markdown; today it is plain text.
- **Changes:** today's `ChangesView` as it is: each file folded, Unfold all, test results, Open in editor. The mock's file list with one diff is a sketch, not a change.
- **Attachments:** `AttachmentsBlock`'s content with Add, in the tab.
- **Gate:** `GateActions` as it is, with its wording ("Send back with notes…", "Drop", its Continue label), targets and script note, not the mock's.
- **Conversation:** Thread rename from the chapter's head, the Consultation note inside its Thread, Link cards, Proposals, Ideas, delivery marks, the read-only reason of an ended Task, the "No conversation yet" start with its Plan button.
- **Links:** `taskThread` unfolds that Thread and scrolls to it, `recordTab` also takes `attachments`.
- **Words:** The Office's real Decisions, not the mock's. For example a budget Decision offers "Raise it to…" and "Drop the Task", with no "same budget" option ([walk-decisions.ts:113](../../apps/service/src/modules/pipelines/domain/walk-decisions.ts#L113)).
- **Folded Threads:** the line shows tokens and the Handover note, which the page already has. The mock's message count is left out, since it would mean loading every Thread's messages or a new field.

## Steps

Sized from the task-file steps so far: 5 and 6 are the largest. Every step leaves the page working and moves the e2e tests it breaks. `Record`, `Conversation` and `Stage results` are looked up in [work.e2e.ts](../../apps/web/e2e/work.e2e.ts) and [people.e2e.ts](../../apps/web/e2e/people.e2e.ts), which also has about 12 such lines.

- [x] 0. Settle the questions. Rewrite this file from the answers; update spec 4, the glossary and the click-through.
- [ ] 1. Contracts and service: `definitionOfDoneMet` on the outcome, `pullRequestUrl` on Publish's outcome, Attachments on a Decision (contract, `open_decision`, storage), the read of a Task's unanswered Decisions, those with a Consultant included. No web change beyond types. Read: the pipelines and conversations maps; [pipeline-responses.ts](../../apps/service/src/modules/pipelines/adapters/http/pipeline-responses.ts).
- [ ] 2. The page's frame: the head with the pull request button, the record's three tabs, the folds and their memory; Attachments moves to its tab. Read: `task-page.tsx`, `task-record.tsx`, `router.tsx` (the Task route's search), the mock's `renderHead`, `renderRecord`, `fold`.
- [ ] 3. The Pipeline rail and Stage history, in `packages/ui` where generic and in `surfaces/work/` otherwise; the Stages block goes. Read: `stage-words.ts`, the mock's `renderRail`, `layoutRail`, `loopBacks`, `runHtml`.
- [ ] 4. The Needs you card and its slim bar, with a Decision's Attachments, the Gate's facts and Before Ready; the Gate block leaves the record; `?decision=` lands on the card; a Thread shows a Decision's short form. Read: `gate-view.tsx`, `decision-card.tsx`, `ready-block.tsx`, the mock's `renderNeeds`, `updateNeedsPin`.
- [ ] 5. The conversation as chapters: every Thread in one list, folding, turns in `MessageList`, Details there and in the chat modal. Read: `record-threads.tsx`, `thread-view.tsx`, `message-list.tsx`, the mock's `segmentHtml`, `chapterOpen`, `groupedMessages`.
- [ ] 6. One composer and following the live Thread: the "To" line, the context label, "new messages". Read: `composer.tsx`, `context-bar.tsx`, the mock's `composer`, `startLiveScript`.
- [ ] 7. The Initiative page: the conversation of steps 5 and 6 in place of its Thread tabs, its blocks in the folds of step 2. `RecordThreads` goes if nothing else uses it. Read: `initiative-page.tsx`.
- [ ] 8. Narrow width and scrollbars: the drawer, the rail at narrow width, themed scrollbars in `packages/ui`. Read: the mock's `fitConversation`, its `.narrow-demo` rules.
- [ ] 9. Close: the states in the table looked at in the running app in both palettes, the design README marked as adopted (its branch note on Attachments is out of date too), the maps refreshed, `npm run verify:linux`. Read: [the design README](../design/README.md).

## State

Nothing built yet. The user settled all the questions on 2026-11-04: see [What was settled](#what-was-settled). Spec 4, spec 2.4, the glossary and the click-through describe the new page. Next is step 1; steps 5 and 6 are the largest.

Traps for the build:

- One Thread can span several runs and Stages: a `continue` session resumes in the previous Thread ([stage-threads.ts:223](../../apps/service/src/modules/conversations/application/stage-threads.ts#L223)). The mock assumes one run per Thread, so a chapter's head and its way to the rail must take several.
- Consultations are Threads with no run; they need a place in the timeline, by `startedAt`, with their note.
- Threads can overlap in time. "In order" is by `startedAt`, not by when they ended.
- Tokens: use `countedTokens`, which leaves out cache reads. The mock's `sumTokens` counts them.
- `estimatedTokens` can be null. The Task's Stages are null before its copy is made: the rail then reads the library Pipeline.
- `MessageList` scrolls to the end on each new message; the timeline must not, and it must not scroll the page around it (the comment at [message-list.tsx:52](../../apps/web/src/shell/conversation/message-list.tsx#L52)).
- `AttachmentGallery` and `attachmentRounds` are on main, whatever the design README says.
- An e2e run after a web change goes through the root `npm run test:e2e`, which rebuilds.

## Progress

- 2026-11-04 · drafted from docs/design: compared with the page, contracts and service; 15 questions listed; next is settling them with the user.
- 2026-11-04 · step 0: the user settled the questions; this file, spec 4 and 2.4, the glossary and the click-through rewritten; task 48 is current, task 49 added; next is step 1.
