# 48 · The Task page redesign

Status: in progress

## Goal

The Task page takes the design in [docs/design/task-page.html](../design/task-page.html). A full-width Pipeline rail shows where the Task is and each Stage's history. A full-width Needs you card under it holds everything that waits on the user. Below them sit a tabbed record (Overview with foldable blocks, Changes, Attachments) and one conversation showing every Thread of the Task as a timeline, with folding and a Details switch. The Initiative page takes the same conversation and foldable record, and chats take the same turns. No feature of today's page is lost unless [What was settled](#what-was-settled) removes it.

## Definition of Done

- [x] Spec 4 and the click-through describe the new page. Check: read spec 4's Task page line against the click-through, done 2026-11-04.
- [x] The rail shows every Stage of the Task, before Start too, with its person or command, state, runs, time and tokens, in all eight Stage states. A loop-back draws its arc from the runs' `carriedFailure`. Selecting a Stage opens its history: each run's times, tokens, session, carried failure, send-back feedback, commands, Gate action, outcome and Handover note, with a way to its Thread. The arrow keys and Esc work. Check: unit tests of the rail's words and loops; e2e of selecting a Stage on a Task with a loop-back.
- [x] The Needs you card shows each open Decision and a waiting Gate, answered there, and says so when nothing waits. A Decision waiting on a Consultant shows marked "Waiting on X", not counted, with its take-over. A slim bar shows while the card is out of view. A Decision's `?decision=` link lands on its card. In a Thread a Decision shows its short form, then its answered form. Check: e2e of answering a Decision, a Consultation take-over, and Continue, Send back and Drop.
- [x] A Decision can name Attachments of its Task, of any kind, and its card shows them: pictures at the one screenshot size with the viewer, the others as chips. Check: service test of `open_decision` with Attachments, refusing one from another record; e2e of the card.
- [x] The Gate's card shows four facts (Files changed, Lines, Tests, Definition of Done), the pictures of this round and Open Changes, beside `GateActions`. Check: web test of the facts, Tests with a failed result and with none; e2e of Open Changes.
- [x] In Planning the card's place holds Before Ready: today's checklist with the Plan's and Definition of Done's Confirm and the `ProposedPipeline`. Mark Ready stays the user's step. Check: e2e of confirming each part and Mark Ready.
- [x] The record has the tabs Overview, Changes and Attachments, each in the address. Overview's blocks fold, are remembered per Task in the browser, and start open in Planning for the Plan and the Definition of Done. Check: e2e of a fold surviving a reload; of Attachments by round, with Add and the viewer stepping through every picture.
- [x] The Definition of Done shows which statements are Reported met, by the same rule the walk uses. Check: service test of the outcome in the response; web test of the words, with a later run lowering the count.
- [x] A Task that published shows "Open pull request" in its head, from a `pullRequestUrl` on Publish's outcome. Check: service test of the outcome; web test of the button, and of no button on an older run without the field.
- [x] The conversation shows every Thread of the Task in order, each folded to one line with its Handover note unless it is the Thread the user is on or holds an open Decision. Every message kind still renders. One author's neighbouring messages join into a turn, in chats too. Check: e2e with several Threads; unit tests of which Thread starts unfolded and of grouping into turns, and `message-list-kinds.test.tsx` rendering every kind, done 2026-11-04.
- [x] The Details switch, off at first, hides tool activity and the context lines with their Brief; refusals, failures, held lines and delivery marks always show, and the latest tool line shows beside "is working". It is one setting, remembered in the browser, shared by the Task page, the Initiative page and chats. Check: e2e of the switch on the Task page and in a chat, done 2026-11-04.
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
- **The Gate:** as the mock draws it. Stage results leave for the rail, the diff for Open Changes, non-picture Attachments for the tab, and each test's result for Changes. Tests looks only at the checks before the Gate: "n failed" when any failed; else "Not run" when any of those did not run, or none sits before it; else "Passed". A check after the Gate, such as a Build that hasn't had its turn, is ignored. The Definition of Done fact is the Reported met count. The mock's "on the rail · clock" link stays out: the head shows the Gate's name and clock.
- **Planning:** Needs you stays Decisions and Gates; no "To confirm". No "Confirm both", and a Task never becomes Ready by itself.
- **Nothing open on a held Task:** a Task Paused, Stopped or Paused by the alarm with no open Decision shows "Nothing needs you".
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
| Paused | Resume, with its words as today | Held Stage shows Paused | An open Decision if any, else "Nothing needs you" |
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
- [x] 1. Contracts and service: `definitionOfDoneMet` on the outcome, `pullRequestUrl` on Publish's outcome, Attachments on a Decision (contract, `open_decision`, storage), the read of a Task's unanswered Decisions, those with a Consultant included. No web change beyond types. Read: the pipelines and conversations maps; [pipeline-responses.ts](../../apps/service/src/modules/pipelines/adapters/http/pipeline-responses.ts).
- [x] 2a. The page's frame, first half: the head's pull request button, the record's three tabs, each in the address; Attachments moves to its tab.
- [x] 2b. The page's frame, second half: Overview's blocks as folds with their memory per Task in the browser (a new fold beside `RecordBlock`, which step 7 reuses per Initiative); the head's token meter; the Initiative link moves to Origin; the Plan as Markdown; the Definition of Done with Reported met. Read: `task-record.tsx`, `planning-parts.tsx`, `dependencies-block.tsx`, `origin-block.tsx`, `shell/rail-store.ts` (the browser-storage pattern), the mock's `foldOpen`, `fold`, `renderRecord`.
- [x] 3a. The Pipeline rail across the page: every Stage with its person or command, state, runs, time and tokens; before Start the library's Stages; "Edit for this Task" and the removed Pipeline's note in its header. All of it is the Work surface's words, so nothing went to `packages/ui`.
- [x] 3b. The Stage history, the rail's selection with the arrow keys and Esc, and the loop-back arcs. Split from the Stages block's removal to stay within a session's size.
- [x] 3c. The Stages block goes from the record, leaving `ProposedPipeline` a home until step 4; the e2e's `Stages · …` lookups move to the rail and the history. Read: `task-record.tsx`, the e2e lines in [State](#state).
- [x] 4a. The full-width Needs you card under the rail with open Decisions answered there, "Nothing needs you", a Decision with a Consultant marked and not counted, with its take-over; the slim bar while the card is out of view; `?decision=` landing on the card; a Thread's short form, then answered form, of a Decision.
- [x] 4b. A Decision's Attachments on its card (pictures at the one screenshot size with the viewer, others as chips); the Gate in the card with its four facts, the pictures of this round and Open Changes, beside `GateActions`; the Gate block leaves the record. Read: `gate-view.tsx`, `needs-you-card.tsx`, `decision-card.tsx`, the mock's `gateCard`, `askCard`, `screenshotsHtml`.
- [x] 4c. Before Ready in the card's place in Planning, beside any open Decision, with the `ProposedPipeline` remnant moved in, and the card's other words from the states table (Ready, Dropped, and so on). Read: `ready-block.tsx`, `planning-parts.tsx`, `needs-you-card.tsx`, the mock's `planningCards`.
- [x] 5a. Chapters: every Thread of the Task in one list by `startedAt`, each folded to one line with tokens and its Handover note unless it is the Thread the user is on or holds an open Decision; the chapter's head with Thread rename; Consultations with their note; `taskThread` unfolds that Thread and scrolls to it; one composer at the foot, with a chapter's "Write here" until step 6's "To" line. Read: `record-threads.tsx`, `thread-view.tsx`, `message-list.tsx`, the mock's `segmentHtml`, `chapterOpen`.
- [x] 5b. One author's neighbouring messages join into a turn in `MessageList`, in chats too; the chapter's head gets its way to the rail, a link per Stage the Thread ran, with the rail's selection lifted out of `StageTrack`. Read: `message-list.tsx`, `pipeline-rail.tsx`, the mock's `groupedMessages`.
- [x] 5c. The Details switch, off at first, one setting in the browser shared by the Task page, the Initiative page and chats. Read: `message-list.tsx`, `shell/rail-store.ts`, the mock's `visibleMessages`.
- [x] 6a. One composer: the "To" line with its rule, a pure function, starting on the live Thread and switching to any writable Thread, or saying why none is; the context label follows it; "Write here" and "Writing in" go; the composer stays mounted, so a draft goes with the To line. Read: `composer.tsx`, `context-bar.tsx`, `thread-composer.tsx`, the mock's `composer`.
- [ ] 6b. "New messages": the button over `useTimelineScroll`, the rule that a reader who scrolled up isn't moved, the e2e of barge-in, of a Planner message on a running Task and of scrolling up while messages arrive, which closes the composer box in the Definition of Done. Read: `use-timeline-scroll.ts`, the mock's `messagesAtEnd`, `startLiveScript`, `newMessagesPill`.
- [ ] 7. The Initiative page: the conversation of steps 5 and 6 in place of its Thread tabs, its blocks in the folds of step 2. `RecordThreads` goes if nothing else uses it. Read: `initiative-page.tsx`.
- [ ] 8. Narrow width and scrollbars: the drawer, the rail at narrow width, themed scrollbars in `packages/ui`. Read: the mock's `fitConversation`, its `.narrow-demo` rules.
- [ ] 9. Close: the states in the table looked at in the running app in both palettes, the design README marked as adopted (its branch note on Attachments is out of date too), the maps refreshed, `npm run verify:linux`. Read: [the design README](../design/README.md).

## State

Steps 1 to 5c are built: the contracts and service carry what the page needs; the head has "Open pull request" and the token meter; the Pipeline rail runs across the page under the head, each Stage opening its Stage history, and is now the only place the Stages show; the Needs you card sits under it with the Task's Decisions, their Attachments and its Gate, Before Ready takes its place in Planning, and the other states say where the Task stands; the record has its three tabs, each in the address (`recordTab`, read by `recordTabOf`), and Overview's Plan, Definition of Done, Dependencies and Origin fold; the conversation is the timeline, every Thread a chapter, its messages in turns, with the Details switch in its head, over one composer with its To line. The user settled all the questions on 2026-11-04: see [What was settled](#what-was-settled). Next is step 6b, "new messages"; the composer box in the Definition of Done closes with it.

- The To line: `to-line.ts` is the rule (`writableThreads`, `liveThread`, `toLineNow`, `toLinePicked`), `timeline-foot.tsx` draws it, the context label and the composer. Neither the mock nor the spec says what a pick does when the live Thread changes, so, as the brief said: a pick holds until the live Thread next changes, or for as long as there is a draft; an empty draft doesn't snap it back. A line the user didn't pick holds for a draft the same way. If its Thread closes under a draft, To takes the live Thread and says so (`closedUnderDraft`), or stays on the closed Thread with today's busy hint when none is left. `takesMessages` (`shell/conversation/thread-writing.ts`) is the one rule of a Stage Thread being closed.
- A Stage's session ends at its Decision in the e2e's Task, so its Thread is `waiting`: Waiting on you is closed, as today, and the To line stays on Planning there. Step 6b needs a Stage really running for barge-in, the Planner message and To following a starting Stage, which only the unit tests cover so far: look in `apps/service/src/e2e.ts` and the scripted adapter for a way to hold a turn. A message landing shows "Lands at the next safe point".
- An open Decision's `threadId` is the asker's, so To starts on Planning in a Consultation, and joining means choosing it in To (the e2e does, with a draft). The Consultation no longer starts unfolded just for being the newest; choosing it unfolds it.
- The foot's composer is not keyed, so the draft and its mentions go with the To line. That is safe as Handover notes and a page's drafts wait only in chats' Threads; `ThreadComposer`'s comment says so. An ended Task's foot shows only its reason, with no context label, as there is no next message.
- Choosing in To also sets the address, as "Write here" did, which lands the timeline on that chapter and leaves it anchored there until the reader takes over: step 6b should look at that. The foot's composer still has no `autoFocus`. e2e reads it with `getByLabel("To", { exact: true })`, as a Decision's label can hold the word.
- A Consultation The Office opens is the newest writable Thread, so the To line goes there and unfolds it, with no click (people.e2e.ts, Publish failing).

- The timeline is `thread-timeline.tsx`, `ThreadTimeline` taking only Threads and what the page knows of them, so step 7 passes the Initiative's; its rules are `timeline-words.ts`. `ThreadView` is split into `ThreadLog` and `ThreadComposer`, which chats still use together. The Thread the user is on is the To line's; `threadTabs` there only marks New and follows the address, and its `shownId` (the address's, else the newest) is what unfolds when nothing is writable. The "New" mark stays until unfolded or the To line lands on it.
- "Holds an open Decision" goes by the Decision's `threadId` among `decisionQueries.unanswered`, those with a Consultant too, as the mock does; a Consultation is not unfolded for it unless the user is on it. The chapter's count shows only for those waiting on the user.
- A chapter once unfolded stays so until the user folds it (`ChapterFolds`), or an answered Decision would fold text under the reader.
- Following `taskThread`: a change of it unfolds and makes that Thread the one the user is on. Folding the chapter it names takes it off the address, and each link in the page also calls `bringChapterIntoView`, as a link followed again changes no address.
- `useTimelineScroll` holds the timeline on the address's Thread, else its end, through a `ResizeObserver` as chapters load, until the reader takes over (wheel, touch, pointer, key); back at the end it follows again. A linked Decision's card outranks both, once, which is how an answered one still lands: `MessageList` with `inTimeline` neither scrolls nor lands. Step 6 only needs the "new messages" button on this. It moves only `scrollTop`.
- The folded line shows the whole Handover note as plain words, cut by CSS: notes often start with a heading alone.
- The chapter's head has a link per Stage the Thread ran (`chapterWork`), a single Stage too. A link only selects, never toggles, so following it again still shows the history, and `focusStage` moves focus to the Stage's button, which scrolls it into view and is where the rail hears its keys. The selection sits in `TaskBody`, keyed by Task, as one Pipeline's Stages have the same keys on every Task. Step 7's Initiative has no Stages, so `onShowStage` is never called there.
- Details: `message-visibility.ts` is the rule, `visibleMessages` filtering before `groupedMessages`, with every kind marked in `SHOWS` so a new one fails to compile, and a kind it doesn't know showing at run time. `details-store.ts` is the one setting, read in `ThreadLog` and passed to `MessageList` as a prop. `DetailsSwitch` sits in the timeline's head and in `ThreadView`'s, which covers chats and, until step 7, the Initiative page, whose log would otherwise have no way to its tool lines; a chat with no Thread has no switch, as it has no log. `lines` counts what shows, so a hidden tool line doesn't scroll a chat. Details on leaves the "is working" line to its name alone, as the mock does. The design system's labelled `Switch` leaves `role="switch"` unnamed, so `DetailsSwitch` names a group round it, which is what e2e looks up (`detailsSwitch`, people.e2e.ts).
- `groupedMessages` (`shell/conversation/message-groups.ts`) makes the turns: only `user` and `person` messages join, by the same `roleKey` for a person; a Handover note the user passed on joins nothing, as it has its own by-line; neighbouring tool calls make one block; every other kind stands alone, ending the turn, which is how a card stays in its place. It runs on what shows, so 5c filters before it and turns then join across hidden lines, as the mock's `visibleMessages` does. Each of the user's messages keeps its delivery mark inside the turn. `TurnFrame` also draws the Decision's answer, so `.message.mine` is gone: the user's words read as the mock's sunken turn, full width.

- The card (`needs-you-card.tsx`, words in `needs-you-words.ts`) reads `decisionQueries.unanswered`; the Decision events refresh it through the `["decisions"]` key, and `useAnswering` invalidates it. A Dropped Task reads only "This Task was dropped." `needsYouClearWords` has the other words: a queued Task is Ready in the contract, so Ready's words and Usage estimate go by `useQueued`.
- `before-ready.tsx` is Before Ready: each checklist line takes what settles it by its `part` (new on the readiness contract, so nothing matches on a label): Confirm on the Plan's and the Definition of Done's, `ProposedPipeline` under the Pipeline's. It sits beside the Needs you block in `.needs-you-beside`, which wraps by width; the slim bar stays outside that row, or its sticky box would be the row. With no Decision or Gate there is no bar, as Needs you stays Decisions and Gates.
- The Gate is `gate-card.tsx`, words in `gate-card-words.ts`, after the Decisions as the mock has it, and counts in the card and the bar. `testsBeforeGate` picks the checks before the Gate and `testsFact` words them, as [What was settled](#what-was-settled) says, so a Gate before a Build reads "Passed" with the Tests Stage passed (people.e2e.ts shows it). `GateActions` is unchanged but for an `alongside` slot, which holds Open Changes. The bar's words with a Gate have an e2e at a 300px high window.
- `CardColumns` and `CardAttachments` (`shell/attachments/card-attachments.tsx`) serve both cards: the columns go by the card's own width, so a Decision stacks in the panel. Pictures looked at on the Task page at 1600: comfortable, with four in a row and the viewer over the page. `namedAttachments` leaves out a removed one.
- `decision-card.tsx`: `DecisionCard` is the whole open card (Now, the panel, Needs you); `DecisionInThread` is the short and answered forms; `DecisionFrame` is what they share. A `?decision=` link marks both forms. An open Decision's landing is `bringDecisionCardIntoView`, from the card's effect and from the short form's link, since a link followed again changes no address; only `NeedsYouCard` passes `landing`, which sets the element id. An answered one still lands in its Thread through `MessageList`.
- The slim bar stays in the flow where the card is, sticky at both edges in an empty box, so no measuring; `.shell-main` is the page's scroller. `useInView` is `IntersectionObserver`, whose root is the window, and the scroller's clipping counts.

- The rail (`pipeline-rail.tsx`, words in `stage-rail-words.ts`): each Stage's button is stretched over its column, as the token info beside it is a button too. Its columns are equal, so the line and the arcs are shares of the width, and step 8 only has to bring the current Stage into view. The history (`stage-history.tsx`, words in `stage-history-words.ts`) is a disclosure, kept out of the address as the mock keeps it; its keys are on the track, not the document, and `EditTaskStagesDialog` stays outside that wrapper because React events bubble through portals.
- A loop's count is `loopBacks`' trips: a run counts only when the failing Stage ran just before it, as a run resumed after a Decision or a Pause carries the same failure. A Stage run again in place (`rounds: 1`, same key) draws no arc.
- e2e reads a Stage with `stageOnRail` (people.e2e.ts); a run's words need the Stage selected first.
- Chromium's `scrollIntoView` answers a promise: never return it from an effect, or React crashes on unmount.

- The button reads the newest Publish run that ran to the end (`pullRequestUrlOf`), so a Publish going again or skipped doesn't hide a pull request still open.
- `RecordFold` with `useFold(record, block, startsOpen)` is the fold; the record is `{ kind, id }`, so step 7 only passes the Initiative. Origin already folds on the Initiative page, as the block is shared; its other blocks wait for step 7.
- Edit stays on the fold's side, beside the Proposed or Confirmed badge. Anything started from the side that must be seen calls `fold.open`, as Edit and Add do. A folded body stays mounted, so its text is in the page but hidden: e2e must unfold before asserting it is visible, and the folded line's words differ from the body's ("No Plan yet" against "No Plan yet.").
- `LinkButton` in `packages/ui` is the secondary Button as a real link; it copies that look in CSS, as `design-system/` stays as exported.
- `AttachmentsBlock` still serves the Initiative page; step 7 puts it in a fold there.

- `GET /tasks/:id/stages` answers `definitionOfDoneMet`, the statement numbers Reported met by the walk's rule (`reportedMet`). Each done outcome also has its own run's report (null for a Script Stage) and `pullRequestUrl` (null but on a Publish that opened one, so an older run reads as none). The web reads the top-level field and never works it out from the outcomes; the head's button takes the latest Publish run's `pullRequestUrl`.
- `Decision.attachmentIds` is always a list; `open_decision` takes an optional `attachments` and refuses any that isn't the Task's.
- `GET /tasks/:taskId/decisions/unanswered` is the Needs you card's read, with `putTo` set on those with a Consultant.

Traps for the build:

- One Thread can span several runs and Stages: a `continue` session resumes in the previous Thread ([stage-threads.ts:223](../../apps/service/src/modules/conversations/application/stage-threads.ts#L223)). The mock assumes one run per Thread, so a chapter's head and its way to the rail must take several.
- Consultations are Threads with no run; they need a place in the timeline, by `startedAt`, with their note.
- Threads can overlap in time. "In order" is by `startedAt`, not by when they ended.
- Tokens: use `countedTokens`, which leaves out cache reads. The mock's `sumTokens` counts them.
- `estimatedTokens` can be null. The Task's Stages are null before its copy is made: the rail then reads the library Pipeline.
- `MessageList` scrolls to the end on each new message; the timeline must not, and it must not scroll the page around it (the comment at [message-list.tsx:52](../../apps/web/src/shell/conversation/message-list.tsx#L52)).
- `AttachmentGallery` and `attachmentRounds` are on main, whatever the design README says.
- An e2e run after a web change goes through the root `npm run test:e2e`, which rebuilds.
- An Attachment removed after its Decision opened stays in `attachmentIds`: the card looks each id up among the Task's Attachments and leaves out what isn't there.

## Progress

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
