# Design proposals

Pages here are **proposals**: interactive mock-ups to look at and compare before anything is built. They are not the UI spec, and an adopted one stays as it was made.

- [**The Task page**](task-page.html), **adopted** by [task 48](../tasks/48-task-page-redesign.md): a full-width Pipeline rail with each Stage's history, a full-width Needs you card under it with room for screenshots, a tabbed record (Overview with its foldable blocks, Changes, Attachments by round), and a conversation that shows every Thread as one timeline of chapters, with a Details switch that hides tool calls. A scenario switcher at the top shows it in Planning, Running, Waiting on you, Failed with a loop-back and Done, at wide and narrow width, in the Light and Dark palettes.

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
