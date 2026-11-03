# Design proposals

Pages here are **proposals**: interactive mock-ups to look at and compare before anything is built. They are not the UI spec.

- [**The Task page**](task-page.html): a full-width Pipeline rail with each Stage's history, a full-width Needs you card under it with room for screenshots, a tabbed record (Overview with its foldable blocks, Changes, Attachments), and a conversation that shows every Thread as one timeline, with a Details switch that hides tool calls. A scenario switcher at the top shows it in Planning, Running, Waiting on you, Failed with a loop-back and Done, at wide and narrow width, in the Light and Dark palettes. The Threads view stays on the switcher for comparison; One timeline is the concept the user preferred.

## What a proposal changes

Nothing yet. [Spec 4](../spec/4-ux-direction.md) ("record left, conversation right") and the click-through stay the UI spec. They change only when an implementation Task adopts a design from here and the user agrees to the change; that Task then updates spec 4 and the click-through with it.

## Opening a page

Each page is one self-contained file, with its CSS, script and fonts inline: open it in a browser by double-click, offline. It makes no network requests.

Its colours, type and density are copied from The Office's tokens (`design-system/tokens/`, `packages/ui/src/appearance/palettes/{light,dark}.css` and `packages/ui/src/appearance/densities/comfortable.css`), so when those change, a page here keeps the values it was made with. Its tabs, buttons, badges, avatars, cards and messages are re-drawn after `packages/ui` and `apps/web/src/shell/conversation/`, so an implementation Task uses those components rather than copying this CSS. The themed scrollbars are new: the app has none yet, so they belong in `packages/ui`. Its mock data follows the shapes of `Task`, `TaskStage`, `Thread` and `Decision` in `packages/contracts`, with a few fields for display only (people's names, messages, which Definition of Done statements are met).
