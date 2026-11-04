# Design proposals

Pages here are **proposals**: interactive mock-ups to look at and compare before anything is built. They are not the UI spec, and an adopted one stays as it was made.

- [**The Task page**](task-page.html), **adopted** by [task 48](../tasks/48-task-page-redesign.md): a full-width Pipeline rail with each Stage's history, a full-width Needs you card under it with room for screenshots, a tabbed record (Overview with its foldable blocks, Changes, Attachments by round), and a conversation that shows every Thread as one timeline of chapters, with a Details switch that hides tool calls. A scenario switcher at the top shows it in Planning, Running, Waiting on you, Failed with a loop-back and Done, at wide and narrow width, in the Light and Dark palettes.
- [**The Task page, round 2**](task-page-2.html), **proposed** for task 51 from the user's notes of 2026-11-04 on the page task 48 built. It starts from a copy of the adopted page, and its "Stage history" switch shows three versions to choose from. It adds two Backlog scenarios.

## Round 2: what it changes

- **Backlog:** a Task whose Plan and Definition of Done the user wrote and confirmed offers Mark Ready beside Plan with…, so Planning is optional (the user's answer of 2026-11-04; spec 2.1 changes with task 51).
- **Before Ready:** a read-only checklist. Confirm goes back to the Plan's and the Definition of Done's blocks, and the Planner's Pipeline proposal sits inside the rail, at its bottom, centred. With nothing waiting, Before Ready takes the Needs you card's place.
- **The rail:** a loop-back is drawn square, up, across and down, with small rounded corners.
- **A Description** (2026-11-05), optional, above the Plan: what the user wants in their own words, so a Task is more than a placeholder title. In Backlog the Planner's tab offers Make a plan, which plans from the title and the Description with nothing more to write. A new glossary term.
- **The Stage history** lists the runs on the left in a line or two each: number, state, times, tokens and the gist of the outcome. Everything about the run picked shows on the right. An Agent run has two tabs: Summary, with the outcome and its Handover note at reading width, and Thread, which follows a running Stage live and takes a message to it, landing at the next safe point. In a Thread a Handover note shows its first lines and "Read it in full", which opens the Summary. A Project command's run shows its whole log. A strip of every Stage under the head moves between them. Version 1 opens it in a window over the page, version 2 in a panel from the side, version 3 in place of everything under the rail, with "Back to the Task" above it.
- **Layout:** Needs you and Before Ready sit above the tabs in the record's column; the conversation keeps its own column, at the same widths.
- **A Decision** with nothing to look at is answered in place, each answer on its own line and the user's own words last. One with Attachments shows its question, the recommended answer with Accept, and Open details, a window with the context, every answer and the pictures. **The Gate** shows what it waits for, Continue and Show details, a window with its four facts, this round's pictures, Open Changes, Send back with notes… and Drop.
- **The conversation** has a tab for the Planner and for each person who ran a Stage of the Task, each with that person's one Thread on the Task, written in at any time (task 49, pulled into task 51). The composer always writes in that tab's Thread; its To line marks the cache warm, with the minutes left of its hour, or cold, before the person's name, and it offers Auto, Continue and Start fresh with what each does. While the person's Stage runs, the tab says so and links to the Stage history, the only place to write into that work. Stage Threads live only in the Stage history.
- **Components:** where a part of today's page looks almost like a `packages/ui` component (a button, a select, a tab) but is styled on its own, the build uses the component. Parts made for one feature, such as the rail, stay.

## The chat flow: Chapters

The user chose Chapters from the three flows compared here. Each Thread is a box. The Thread you're on and any Thread with an open Decision stay unfolded; the others fold to one line with their Handover note, so a long Task stays short. One author's neighbouring messages join into a turn, regular messages sit on the plain surface, and your own stay neutral. Decisions, Handover notes and a failed run's line keep their colour. "Chapter" is this design's name, not a glossary term: in the app it is simply a Thread.

## What the implementation must keep

- **Attachments by round:** the Attachments tab uses the app's `AttachmentGallery` and `attachmentRounds`: the newest round open on top, earlier rounds folded under "Round n" with the send-back's feedback, and a viewer that steps through every picture. Moving the Attachments to a tab must not lose this.
- **One screenshot size:** 160 by 100 wherever a screenshot shows, as `.attachment-thumbnail` in the app. In Needs you, the screenshots scroll past a height of 176px, so the card stays small however many a Task has.

## What a proposal changes

[Spec 4](../spec/4-ux-direction.md) and the click-through are the UI spec. They change only when an implementation Task adopts a design from here and the user agrees to the change; that Task then updates spec 4 and the click-through with it, as task 48 did for the Task page. Where the mock-up and the task differ, the task's [What was settled](../tasks/48-task-page-redesign.md#what-was-settled) stands.

## Opening a page

Each page is one self-contained file, with its CSS, script and fonts inline: open it in a browser by double-click, offline. It makes no network requests.

Its colours, type and density are copied from The Office's tokens (`design-system/tokens/`, `packages/ui/src/appearance/palettes/{light,dark}.css` and `packages/ui/src/appearance/densities/comfortable.css`), so when those change, a page here keeps the values it was made with. Its tabs, buttons, badges, avatars, cards and messages are re-drawn after `packages/ui` and `apps/web/src/shell/conversation/`, so an implementation Task uses those components rather than copying this CSS. The app's themed scrollbars are in `packages/ui`. Its mock data follows the shapes of `Task`, `TaskStage`, `Thread` and `Decision` in `packages/contracts`, with a few fields for display only (people's names, messages, which Definition of Done statements are met).
