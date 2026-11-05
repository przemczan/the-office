# 51 · The Task page, round 2

Status: in progress

## Goal

The Task page takes the user's notes on the page task 48 built, drawn in [docs/design/task-page-2.html](../design/task-page-2.html):

- A Task gets an optional **Description**, and Planning becomes optional.
- **Before Ready** becomes a read-only checklist.
- The **Stage history** opens as a large window: the runs as a list, and the picked run's Summary, Thread or log beside it.
- **Needs you** moves into the record's column.
- **Decisions** with something to look at, and the **Gate**, open their details in windows.
- The **conversation** becomes one tab per person, each with that person's own Thread on the Task, written in at any time. This takes in task 49.

Every window in the app follows the new [UI rules](../spec/4.1-ui-rules.md): three sizes, and a bar with its actions and Close. Parts of the page that look almost like a `packages/ui` component become that component.

## Definition of Done

- [x] Spec 2.1, 2.4, 2.5 and 4, the glossary and the click-through describe the new page and the new conversation. Check: read each changed line against [What was settled](#what-was-settled), done 2026-11-05.
- [x] A Task has an optional Description: a field in "+ Task" under the title, a block above the Plan with Edit, and part of the Planner's Brief. Check: service test of creating and editing it, and of the Brief holding it; e2e of creating a Task with one and of seeing it above the Plan.
- [x] In Backlog, the Planner's tab offers Make a plan, which starts Planning from the title and the Description with no message to write. Mark Ready shows in Backlog once the Plan and the Definition of Done are confirmed and nothing else holds Ready, and takes the Task to Ready without Planning. Check: service test of Mark Ready from Backlog and of its refusals; e2e of Make a plan, and of writing both parts by hand and marking Ready.
- [x] Confirm sits on the Plan's and the Definition of Done's blocks. Before Ready is read-only, each unmet line saying where it is settled. The Planner's Pipeline proposal sits in the rail, under the Stages and centred. A loop-back is drawn square. Check: e2e of confirming each part and the Pipeline in their new places; web test of the loop-back's path.
- [x] Needs you and Before Ready sit above the tabs in the record's column, and the conversation keeps its own column at today's widths. Check: e2e at 1600 and 1100px; screenshots in both palettes.
- [x] A Decision with no Attachments is answered in place, one answer per line with your own words last. One with Attachments shows its question, the recommended answer with Accept, and Open details. Open details opens a large window: the context, the pictures, every answer as a choice with the recommended one picked, your own words, and Answer in its bar. Check: e2e of each way of answering.
- [x] The Gate's card shows what it waits for, Continue and Show details. Show details opens a large window with the four facts, this round's pictures, and Continue, Open Changes, Send back with notes… and Drop in its bar. Send back's notes open over the bar, with Send back and Cancel. Check: e2e of Continue, Send back and Drop from the window.
- [ ] Selecting a Stage opens its history in a large window of one height.
  - Its top is the Pipeline in small: each Stage's mark and name, to move between them, with ← and →.
  - The runs list on the left, a line or two each.
  - On the right, everything about the run picked. An Agent run has Summary (the outcome, the carried failure and the Handover note at reading width) and Thread, with the Details switch on that tab's row. A Project command's run shows its outcome and each command's output.
  - A running Stage's Thread follows live and takes a message, which lands at the next safe point.
  - In a Thread, a Handover note shows its first lines and "Read it in full", which opens the Summary.

  Check: service test of a command's output kept and capped; e2e of moving between Stages and runs, a barge-in from the window, and reading a Handover note.
- [ ] The conversation has a tab for the Planner and for each person who ran an Agent Stage of the Task (and each Consultant, as settled in step 0). Each tab holds that person's one Thread on the Task, written in at any time while the Task hasn't ended; the composer always writes there.
  - The To line marks the cache warm, with the minutes left, or cold, before the person's name.
  - Auto, Continue and Start fresh say what each does and its cost.
  - While the person's Stage runs, the tab says so and opens the Stage history.
  - Stage Threads show only in the Stage history.

  Check: service test of a person's Thread on a Task (its session, Brief, tools and tokens, as settled in step 0) and of `cacheWarmUntil`; e2e of asking two people and of the To line's marks.
- [ ] `packages/ui`'s `Dialog` takes the three sizes and the frame of [the UI rules](../spec/4.1-ui-rules.md#windows), and every window in the app uses them. Check: a web test of the frame; e2e of the windows of each surface still passing; a look at each in both palettes.
- [ ] Controls on the Task page that copy a `packages/ui` component are that component. Check: a list in the State of what was swapped and what stays bespoke and why.
- [ ] Every action in [Kept from task 48](#kept-from-task-48) works in its new place. Check: the existing e2e tests, moved to the new layout, pass.
- [ ] The design README says round 2 was adopted. Check: read it.
- [ ] `npm run verify` and `npm run verify:linux` pass.

## Read first

- [docs/design/README.md](../design/README.md), the "Round 2" section, and [docs/design/task-page-2.html](../design/task-page-2.html) opened in a browser. Grep a function and read its range: the file is about 5,600 lines. Its markup, CSS and data are not to be copied.
- [The UI rules](../spec/4.1-ui-rules.md).
- The [Work surface map](../../apps/web/src/surfaces/work/MAP.md), [the web app's map](../../apps/web/src/MAP.md), and the State of [task 48](48-task-page-redesign.md#state): where everything on today's page lives, and its traps.

Leave out:

- The Initiative page keeps task 48's timeline of chapters. Only the Task page gets the people's tabs.
- The phone (task 28).
- The mock-up's demo controls (scenario, width and palette switches, "Forget remembered folds").

## What was settled

The user's answers of 2026-11-04 and 2026-11-05.

**Planning and the record**

- **Planning is optional:** a Task whose Plan and Definition of Done the user wrote and confirmed goes from Backlog to Ready by Mark Ready. Ready's other rules stay: no Pipeline proposal and no Decision open. Plan with… stays beside it in the head. Mark Ready shows in Backlog only once both parts are confirmed.
- **Description:** optional, the user's own words of what they want. It sits above the Plan, open before the Task starts. Empty, it reads "None: the title is all there is", and the title alone is enough to plan from. "+ Task" gets the field under the title, so a Task can be more than a placeholder. "Description" is a new glossary term, distinct from the Plan, which the glossary calls "a Task's description of how it will be implemented"; reword that entry so the two don't collide.
- **The Description in every Brief, and from an Idea's notes** (Settled: the user, 2026-11-05). Every Agent Stage's Brief (Implement, Review, …) holds the Description, worded as the Planner's. A Task shaped from an Idea takes the Idea's notes as its Description, editable until Start.
- **Make a plan and Plan with…, two ways to start Planning** (the user, 2026-11-05). Both move the Task to Planning. **Make a plan** sits in the Planner's empty tab in Backlog: "Angela plans from the title and the Description, so there is nothing more to write." The Planner starts at once from the record, as a Thread on an Initiative starts on its opening (`startOnInitiative`). **Plan with…** stays in the head and works as today: it opens the Planning Thread (`openOnTask`) and the Planner waits for the user's first message.
- **Before Ready:** a read-only checklist (Plan confirmed, Definition of Done confirmed, Pipeline chosen, No Decision open); each unmet line says where it is settled and links there. With nothing waiting, it takes the Needs you card's place; in Backlog it shows only once a part is written.
- **Confirm** goes back to the Plan's and the Definition of Done's blocks, beside the Proposed badge. The **Pipeline proposal** goes into the rail, at its bottom, centred: Confirm, or Use and Keep, and Another Pipeline…, as `ProposedPipeline` has them.
- **Loop-back arcs:** square, up, across and down with small rounded corners, the arrow kept.

**Needs you, Decisions and the Gate**

- **Layout:** Needs you and Before Ready sit above the tabs, in the record's column. The conversation has its own column, at today's widths.
- **A Decision:**
  - With nothing to look at, it is answered in place: the question, the context, each answer on its own line with the recommended one marked, the recommendation's reason, and your own words last.
  - With Attachments, it shows the question and two boxes. One is the recommended answer with its reason and Accept below. The other is Details with Open details.
  - The window answers as a form: pick, the recommended answer picked at first, or "In your own words" with a text field, then Answer.
- **The Gate:** its card shows what it waits for, a line of its facts, Continue and Show details. The window has the four facts, this round's pictures, and the actions in its bar. The words are `GateActions`': Continue, Open Changes, Send back with notes…, and Drop in red. Close is on the bar's right, with Drop last on its left; the user found the two close enough together to be fine. Task 48's open point on `GateActions`' look ends here: the window's bar is its place.

**The Stage history**

- **A large window**, chosen over a side panel and a view in place of the page. It keeps one height. Its head has the Stage's name, its person or command, its state and the ← → hint. Its bar has Close.
- **The Pipeline in small** at the top of the body: each Stage's rail mark and its name under it, joined by the line, the selected one highlighted. Pressing one, or ← and →, moves to it.
- **Runs:** on the left, newest first, each a whole button. It shows the run's number, state and times, its tokens for an Agent Stage, a ↺ when it was briefed with a failure, and two lines of its outcome, with no commands. On the right is everything about the run picked, by default the newest:
  - An **Agent run** has two tabs. **Summary** has the outcome, the carried failure, the Gate action, and the Handover note as Markdown at reading width in its own tinted box. **Thread** has the run's Thread and the Details switch on the tab's row. An ended run opens on Summary and a running one on Thread. The choice is kept per run while the window is open.
  - A **Project command's run** has its outcome, then each command's line, result, duration and whole output, in a terminal block. The output is new: the service keeps each command's output, capped to the last 64 KB of each command's output, with a line saying how much was cut.
  - A **Gate's run** has what it waits for and a link to Needs you.
- **Writing to a running Stage** happens only in its Thread tab here, as barge-in does today: the To line names the person and the Stage, and a message lands at the next safe point. An ended run's Thread is read-only, with "Ask <name> about it" opening that person's tab.
- **A Handover note in a Thread** shows its first four lines and "Read it in full", which opens that run's Summary. A view of every run's note on the Task was proposed and left out until reading run by run turns out tedious.

**The conversation**

- **Tabs:** the Planner first, then each person who ran an Agent Stage of the Task, in the order they first worked. Each has a live dot while their Stage runs.
- **One Thread per person on the Task**, written in at any time while the Task hasn't ended, for asking anyone who worked on it about anything in it. The Planner's Thread is today's Planning Thread. A Done or Dropped Task's tabs are read-only, with today's words.
- **The composer always writes in the tab's Thread**, never in a running Stage's. While the person's Stage runs, a banner says so and opens the Stage history: "To write into that work, open its Stage history."
- **The cache mark** sits in the To line before the person's name, not on the tabs: a warm mark with the minutes left of the cache's hour, or a cold mark. A Thread with no session yet has none and says "Starts a session with a Brief ~3k tokens".
- **Auto, Continue and Start fresh**, a segmented control under the composer, with what each would do and cost: today's context label and overrides, as a control.
- **Stage Threads** show only in the Stage history. A Decision's "in Oscar's Thread" link opens that tab. Its "in Implement, run 6" link opens the Stage history at that run.
- **The first tab** is the one whose Thread holds an open Decision, else the person whose Stage runs, else the Planner.

**Windows and components** ([spec 4.1](../spec/4.1-ui-rules.md), written from the user's notes)

- Small 440px for confirmations, medium 720px for forms, large 1180px for what is read or looked at; each at most 94% of the browser window's width. The Stage history, a Decision's and the Gate's windows and the picture viewer are large.
- Every window has a head with its X, a body that scrolls, and a bar with its actions on the left and Close on the right, always. A step before an action opens over the bar, and the bar's actions become the step's. No window opens on another, except the picture viewer.
- Windows close by Esc, X or Close, never by a press on the backdrop (`overlays.tsx`).
- A control on the Task page that looks almost like a `packages/ui` component is that component. A part made for one feature (the rail, the Pipeline in small) stays bespoke on the design system's tokens.

### To settle in step 0

Task 49's questions, which the people's tabs answer, each with a proposal; all settled by the user on 2026-11-05 as proposed:

- **Which session answers:** the person's own Thread is its own session, under the Context policy like any chat Thread. Its first session's Brief is the record: title, Description, Plan, Definition of Done, Stage results, answered Decisions, the diff summary, and that person's Handover notes on this Task. A later fresh session (Start fresh, or a cold cache under Auto) gets the Context policy's Brief only, as any chat Thread; the record is the first session's Brief only. *Settled: the user, 2026-11-05.*
- **Whose budget:** its tokens count to the Thread and to the Task, never to a Stage's budget, and the Usage estimate and Window caps see them as any session's. *Settled: the user, 2026-11-05.*
- **Whether it can change code:** no. It reads the Task's worktree but doesn't edit it or run commands that change it. Changes go through a Stage: Send back at the Gate, or a running Stage's Thread. *Settled: the user, 2026-11-05.* This is how `ThreadRunner` runs every session but the Caretaker's with changes allowed (`thread-runner.ts:505-513`: `edit: false`, read-only git), so it costs nothing to build.
- **The Planner's Thread outside Planning:** proposing a Plan, a Definition of Done or a Pipeline is refused outside Planning (`planning-changes.ts`, `proposingProblems`), and a Task never moves back to Planning. Once the Task is Ready, the Planner gets the read-only tools of the other people's Threads, with the Planning instructions swapped for theirs. *Settled: the user, 2026-11-05.*
- **Make a plan and Plan with…:** two actions, as in [What was settled](#what-was-settled). *Settled: the user, 2026-11-05.* In Backlog the Planner's tab has no composer, as today: nothing is written until one of the two buttons moves the Task to Planning. Compared with today, the only addition is Make a plan.
- **Whether it holds the Gate:** no. Asking doesn't hold or release anything; only Continue, Send back and Drop act at the Gate. *Settled: the user, 2026-11-05.*
- **While the person's Stage runs:** the two sessions run side by side. The tab's session reads what the worktree holds then. *Settled: the user, 2026-11-05.*
- **Consultations:** a Consultant who answered a Decision on the Task gets a tab. Their Consultation shows in it, above their Thread on the Task, with its note. *Settled: the user, 2026-11-05.*
- **The command output's cap:** the last 64 KB of each command's output, the rest dropped with a line saying how much was cut. *Settled: the user, 2026-11-05.*
- **New messages in another tab:** a tab whose Thread got a message the user hasn't seen shows a count. Inside a tab, the "new messages" button works as today. *Settled: the user, 2026-11-05.*

## Kept from task 48

Everything in task 48's [Kept from today's page](48-task-page-redesign.md#kept-from-todays-page) and [What was settled](48-task-page-redesign.md#what-was-settled) that round 2 doesn't change. In particular:

- the head's actions and token meter;
- "Edit for this Task" in the rail's header;
- the record's three tabs in the address;
- the folds remembered per Task;
- `?decision=` landing on its card;
- the slim Needs you bar;
- the drawer at 900px and below, now holding the tabs;
- the Details setting shared with chats;
- "new messages" in a tab;
- an ended Task's words.

The address's `taskThread` now names a person's tab, or a Stage run whose history opens at that run.

## Steps

Sized from task 48's steps, where one task-file step ran 140 to 280k tokens of context: a step touching both the service and the web is split.

- [x] 0. Settle [To settle in step 0](#to-settle-in-step-0) with the user. Then update spec 2.1 (Planning optional, the Description), 2.4 (a person's Thread on a Task; Stage Threads in the Stage history, written in while running), 2.5 (the cache's time left shown), 4 (the Task page), the glossary (Description, the Plan's entry) and the click-through. Read: spec 2.1, 2.4, 2.5 and 4; the glossary's Task, Plan and Thread entries.
- [x] 1. `packages/ui`'s `Dialog`: the three sizes, the frame with its bar (actions on the left, Close on the right) and a step over the bar. A web test of the frame. No surface moves yet. Read: `packages/ui/src/overlays.tsx`, `design-system/components/overlays/Dialog.jsx` (it has `width` and right-aligned `actions`; the wrapper adds what the rules need).
- [x] 2a. Service: the Description (contract, storage, `POST /tasks` and an edit, the Planner's Brief); Mark Ready from Backlog in the Work rules; Make a plan, which moves the Task to Planning with the Planner starting at once from the record (Plan with… keeps today's empty Thread); the checklist's labels. Read: the work map; `planning-service.ts` (`plan`, `openPlanningThread`); `task-states.ts` (`NEXT_STATES` has no Backlog → Ready; `readinessLines` holds the labels, still "Pipeline taken or declined" and "No Decision waiting"); `task-changes.ts` (`markTaskReady`); `thread-service.ts` (`openOnTask`, `startOnInitiative`); `packages/contracts/src/work.ts` (`newTaskSchema`, `taskSchema`). Grep the subscribers of `TaskStateChanged` (Notifications, Now, the queue, Initiatives) for one that assumes Ready comes from Planning.
- [x] 2b. Web: the Description in "+ Task" and its block above the Plan; Mark Ready in Backlog; Confirm on the blocks; Before Ready read-only; the Pipeline proposal in the rail; square loop-backs. The blocks' Edit already shows in Backlog (`NOT_STARTED` in `planning-parts.tsx`), and the service confirms either part in Backlog; only the empty blocks' words ("proposes it during planning") change. Where each Before Ready line is settled is the web's, mapped from the line's `part`. Read: `before-ready.tsx`, `planning-parts.tsx`, `task-record.tsx`, `pipeline-rail.tsx`, `new-task-dialog.tsx`.
- [x] 3a. The layout and Needs you: Needs you and Before Ready into the record's column, the conversation keeping its own column; the Decision's two forms (no Attachments: answered in place, one answer per line with your own words last; with Attachments: its question, the recommended answer with Accept, and Open details) and its large window. Read: `needs-you-card.tsx`, `shell/conversation/decision-card.tsx`, the mock's `decisionCard`, `decisionDetailsBody`, `renderDetails`.
- [x] 3b. The Gate's card (what it waits for, a line of its facts, Continue and Show details) and its large window: the four facts, this round's pictures, `GateActions` in the bar (Continue, Open Changes, Send back with notes…, Drop), Send back's notes as a step over the bar. Read: `gate-card.tsx`, `gate-card-words.ts`, `shell/work/gate-actions.tsx`, the mock's `gateCard`, `gateDetailsBody`, `gateDetailsFoot`.
- [ ] 4a. Service: each command's output kept, capped, on the Stage run's command runs. Read: the pipelines map, `script-stage-runner.ts`, `stageCommandRunSchema`.
- [ ] 4b. Web: the Stage history window: the Pipeline in small, the runs list, the run's details with Summary and Thread, the log, the Handover note's "Read it in full", barge-in from the Thread tab. `stage-history.tsx`'s disclosure goes. Read: `stage-history.tsx`, `pipeline-rail.tsx`, the mock's `historyWindow`, `runDetailsHtml`, `miniRailHtml`.
- [ ] 5a. Service: a person's Thread on a Task, written in at any time, as settled in step 0 (its session, Brief, tools, tokens); `cacheWarmUntil` on the Thread's context. Read: the conversations and engine maps; `work/adapters/conversations/planning-thread-setup.ts` and `conversations/application/task-thread-setups.ts`; `thread-runner.ts`; `context-policy.ts` (`isWarm`); `threadContextSchema`. Stage Threads set up their sessions in `stage-threads.ts`, apart from this path.
- [ ] 5b. Web: the conversation's tabs. Each tab's Thread and composer, the cache mark in the To line, Auto, Continue and Start fresh as a control, the banner, Make a plan, the first tab, a tab's count. Stage Threads leave the conversation; the To line's rule (`to-line.ts`) goes with them. Read: `thread-timeline.tsx`, `timeline-foot.tsx`, `to-line.ts`, `conversation-drawer.tsx`, the mock's `personPanelHtml`, `composer`; every link that builds `taskThread` (`router.tsx`, `task-page.tsx`, `task-conversation.tsx`, `needs-you-card.tsx`, `stage-history.tsx`, `shell/conversation/decision-card.tsx`, `shell/record-mention.tsx`, `people/conversations-tab.tsx`, `people/memory-tab.tsx`).
- [ ] 6. Every other window to the rules: each `Dialog` in the app takes its size and the bar with Close, surface by surface, its e2e moved. Read: `grep -rn "<Dialog" apps/web/src` (27 uses on 2026-11-05).
- [ ] 7. Components and close: the Task page's near-copies of `packages/ui` components swapped (listed in the State); the design README marks round 2 adopted; the maps refreshed; `npm run verify:linux`.

## State

Steps 0 to 3b done (2026-11-05): spec, glossary and the (local) click-through describe round 2; `Dialog` has the three sizes and the frame, is portalled to the body and leaves Esc to a window over it; the service has the Description, Mark Ready from Backlog and Make a plan; the web has the Description, Confirm on the blocks, Before Ready read-only, Mark Ready and Make a plan in Backlog, the Pipeline proposal in the rail (one centred row that wraps, as the click-through, keeping the reason the mock has), square loop-backs, Needs you and Before Ready first in the record's column, a Decision in place or in its window (`DecisionOnTask`), and the Gate's card and window (`gate-card.tsx`, `gate-window.tsx`). Open for the user: the planning Brief's "Where it came from" quotes an Idea's notes only once the Description was edited away from them.

Decided in 3b: Drop's confirmation is a step over the bar too (no window opens on another; the click-through's `gateWindow`), its button "Drop". `GateActions` stays on Now and in the Needs you panel; the window shares its parts, not the component (`useContinuingAtGate`, `useSendingBack`, `SendBackFields`, `useDroppingTask`, `WhatDroppingDoes`).

For step 7's list: `RadioList` (native radios, named group) replaced the design system's `RadioGroup`.

Traps for 6: without `size`, `Dialog` still renders the design system's Dialog; step 6 moves every caller to `size`, then deletes that branch. `DropTaskDialog` is one of those, on the Task's menu, Now and the panel. A destructive action is a `Button variant="danger"` placed last. A sized `Dialog` is on the body: scope e2e by `page.getByRole("dialog", …)`, not by the card. `getByLabel("Close")` matches both the X and the bar's Close; use `getByRole("button", { name: "Close", exact: true })`.

Traps for the build:

- "Window cap" is already a glossary term (a usage window). The UI rules call a dialog a window in prose only; in code it stays `Dialog`.
- Stage Threads take messages only while their Stage runs (spec 2.4). The people's Threads are not Stage Threads: keep `stageThread` false on them, or a message would wait for a safe point that never comes.
- A command's output isn't stored today (`stageCommandRunSchema` has no output); 4b needs 4a. The cap is the last 64 KB per command, with a line saying how much was cut. `stage_runs.command_runs` is jsonb, so it needs no migration; the process runs in the projects module (`shell-command-runner.ts`), not the platform layer.
- `threadContextSchema` has only `cacheWarm`; the minutes left need the warm-until time from the service (the session's `lastCallAt` plus the cache window, `context-policy.ts` `isWarm`); the web counts down from it.
- `PlanningThreadSetup` is the only setup of a Thread on a Task, and it ignores the person. 5a sets up by person: read-only tools (as `thread-runner.ts:505-513`) for all but the Planner in Planning; its tokens count to the Thread and the Task, never a Stage's budget.
- `taskThread` links come from the People surface and record mentions too; under its new meaning (a person's tab, or a Stage run) each must still land.
- The Initiative page keeps `ThreadTimeline` and its To line; 5b must not remove what it still uses.

## Progress

- 2026-11-05 · step 0: the user settled every open item as proposed; spec 2.1, 2.4, 2.5 and 4, the glossary and the (local) click-through describe round 2; next is step 1, `Dialog`'s sizes and frame.
- 2026-11-05 · step 1: `Dialog` takes the three sizes and spec 4.1's frame (the bar with Close on the right, a step over the bar), the old shape kept until step 6; a later fresh session's Brief settled; next is step 2a, the service's Description, Mark Ready from Backlog and Make a plan.
- 2026-11-05 · step 2a: the Description (contract, column 0089, `PUT /tasks/:id/description`, the Brief), Mark Ready from Backlog, Make a plan (`POST /tasks/:id/make-a-plan`, the Planner starting at once) and the checklist's labels; next is step 2b, the web.
- 2026-11-05 · step 2a follow-up: the Description in every Agent Stage's Brief (`descriptionSection`, shared with the Planner's through Work's `TaskRecords`), and an Idea's notes as the shaped Task's Description; spec 2.1 and 2.5 say so; next is step 2b, the web.
- 2026-11-05 · step 2b: the Description in "+ Task" (the first medium window) and above the Plan, Confirm on the blocks, Before Ready read-only with links, Mark Ready and Make a plan in Backlog, the Pipeline proposal in the rail, square loop-backs; next is step 3, the layout and Needs you.
- 2026-11-05 · step 3a: Needs you and Before Ready first in the record's column, stacked; a Decision answered in place one answer per line, or with Attachments by Accept or in its large window (`DecisionOnTask`, `RadioList`); `Dialog` on the body, Esc to the topmost; next is step 3b, the Gate's card and window.
- 2026-11-05 · step 3b: the Gate's card (what it waits for, a line of facts, Continue, Show details) and its large window, with Send back's notes and Drop's confirmation as steps over the bar; the rail's Pipeline proposal in one centred row; next is step 4a, each command's output kept on its run.
