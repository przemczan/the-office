# Design proposals

Pages here are **proposals**: interactive mock-ups to look at and compare before anything is built. They are not the UI spec, and an adopted one stays as it was made.

- [**The Task page**](task-page.html), **adopted** by [task 48](../tasks/48-task-page-redesign.md): a full-width Pipeline rail with each Stage's history, a full-width Needs you card under it with room for screenshots, a tabbed record (Overview with its foldable blocks, Changes, Attachments by round), and a conversation that shows every Thread as one timeline of chapters, with a Details switch that hides tool calls. A scenario switcher at the top shows it in Planning, Running, Waiting on you, Failed with a loop-back and Done, at wide and narrow width, in the Light and Dark palettes.
- [**The Task page, round 2**](task-page-2.html), **adopted** by [task 51](../tasks/51-task-page-round-2.md), from the user's notes of 2026-11-04 on the page task 48 built. It starts from a copy of the adopted page and adds two Backlog scenarios.
- [**The Thread dialog**](thread-dialog.html), **Rows adopted** by [task 53](../tasks/53-thread-in-rows.md), from the user's note of 2026-11-05: Decisions and Handover notes look right, the dialog around them doesn't. It compares three designs of the turns with Today on the same messages, with three scenarios, the Details switch, three widths and both palettes. The user chose Rows, as in a team channel: everyone on the left, each turn with an avatar, name and time; Chat and Bubbles stay for comparing. The cards stay as they are and Chapters isn't touched. New with it: tool calls fold to one line and open to every command whole, the Office's lines lose their boxes, a failure gets a tinted strip, a refusal's reason wraps, a Thread that spans days gets a day line, and in a large window the Thread stays in a centred column. "Chat", "Bubbles" and "Rows" are this design's names, not glossary terms.

- [**The chat drawer**](chat-drawer.html), a **proposal**, for the Task "Replace the chat modal with the chat drawer": a person's chat in a drawer on the right edge instead of a modal, opened from a button in the top bar. A switcher shows it behind Now, a Task page and an Initiative page, at wide, 900px and 390px, in the Light and Dark palettes, over the page or pushing it aside, in ten scenarios; Esc really follows the order below, and drafts survive. It changes [spec 4](../spec/4-ux-direction.md), [spec 4.1](../spec/4.1-ui-rules.md) and the click-through only when that Task adopts it. See [The chat drawer: what it proposes](#the-chat-drawer-what-it-proposes).

## The chat drawer: what it proposes

One recommendation for each of the five questions. Stanley (UI/UX Designer) was consulted and worked the Stage; their advice is folded in, and **Moved:** marks where it changed the starting position.

1. **The button** sits at the top bar's right end, after + Idea, right above where the drawer opens, so it is on every page. It has three looks: **nothing new** (its icon and "Chat"), **someone answering** (that person's avatar with a live dot) and **someone has answered** (the avatar of whoever answered, two at most, with an Ember dot). It shows a face and a dot, never a number, so it never reads as the Needs you count in the status strip. Answered wins over answering, as it is the one that waits on the user. Pressing it with an answer waiting opens that Thread; otherwise it opens where the user left off. At 600px and below it shows its mark alone. **Moved:** the answered look leads to the Thread that answered rather than only marking it.
2. **Picking a person:** with no chat open yet, the drawer opens on the people with chat on (Pam, Dwight, Michael, Angela, Jan and Stanley), each with their Role and where their chat stands: Answered, Answering… or when it last moved. Jim and Oscar, with chat off, aren't offered; a line says that people with chat off aren't listed and where chat is turned on. Once a chat is open, the person's name in the head is the switch: a menu of the same people with their dots, which switches without closing the drawer, and links to the person's page. **Moved:** the order is fixed and never sorts by who answered, so a row never moves under the pointer.
3. **Threads in a narrow drawer:** one column. The open Thread fills the drawer, in Rows, under its own row: "‹ Threads", the Thread's title and the Details switch, which serves that Thread only (spec 4.1). The head carries the line on what the person can do. In a Caretaker's Thread, the Allow changes bar sits under the Thread's row, and Allow changes opens its small window. The Thread list is a step back, with New thread at its top; each Thread shows its title, the cache dot, when it last moved and whether it answered. A person with no Threads gets an empty state that says what a Thread is, with New thread. **Moved:** "‹ Threads" carries the Ember dot when another of that person's Threads has answered, so an answer is never hidden one step back.
4. **Beside the page:** the drawer **pushes the page aside** on windows wider than 900px, with no dimmed backdrop: the page gives up the drawer's width and stays whole and usable. Over the page, it would cover the right side, which on a Task or an Initiative page is the conversation and its composer, and on Now the third panel. Dragging its left edge (or ← and → on the focused edge) resizes it between 360px and 720px, leaving the page at least 480px beside it, or 240px in view when it lies over the page, room for the conversation drawer's handle; the default is 420px, a double press on the edge goes back to it, and the width is remembered in this browser, as the rail's toggle is. **Moved:** the drawer sits below the top bar and the status strip, so the button that closes it and the Needs you count stay in reach. **Moved:** from 601px to 900px it lies over the page with no backdrop, as there is no room to push; it fills the window only at 600px and below, since at 900px a full-window chat would hide the page being asked about. Nothing scrolls sideways at any width.
5. **With everything else:**
   - The **Needs you panel** opens over the chat drawer, with its dimmed backdrop, as today: a short visit to answer and close. Beside it, 560px and 420px together would leave little page. The chat stays open under it.
   - A **window** opens over everything, side panels included, such as a Decision's window opened from a Mention in a chat.
   - On a narrow Task or Initiative page, the **conversation drawer's handle** keeps to the page's side of the chat drawer, so neither covers the other's control; the conversation drawer, opened last, lies over the chat.
   - **Esc** closes one thing per press. Drafts are kept throughout, per Thread, as today.

     | Press | What closes |
     | --- | --- |
     | 1 | A window: a Decision's, Allow changes, the Attachment viewer |
     | 2 | A menu or picker inside a panel: the person switch, the mention picker |
     | 3 | The side panel opened last: the chat drawer, the Needs you panel or the conversation drawer |
     | 4 | The next side panel, by the same rule |

     **Moved:** a menu or picker gets its own place in the order, and Esc never steps back inside the drawer, from a Thread to the list.

**This design's names**, not glossary terms: the chat drawer, the Chat button and its looks (nothing new, someone answering, someone has answered or Answered), the person picker, the person switch, the Thread list, over the page and pushes the page aside.

### What the build needs that the app doesn't have

- **A record of what the user has seen in a Thread.** A Thread is only `waiting` or `answering`, and nothing records what the user has seen, so "someone has answered" needs one: the last message seen in each Thread, set when the Thread is on screen in the open drawer. The Task page's unseen counts are kept per page view only today (`threads-seen.ts`) and could move to the same record.
- **The drawer stays open across pages.** The chat lives in the address (`?chat=…&thread=…`) today, which each navigation drops. The drawer's state (open, person, Thread, width) belongs to the shell, and a link that opens a chat, such as a Link card's or the People page's, sets it.
- **The page gives up its width.** To push the page aside, the shell's layout gives the drawer a column below the status strip, and a page folds its side column into its drawer by its own width (844px, the 900px rule less the rail) rather than the window's. That changes spec 4.1's Narrow rule, and the conversation drawer's handle anchors to the page's right edge.
- **Esc by the order things opened.** `useCloseOnEscape` finds the topmost thing by the order of `aria-modal` elements in the document. The chat drawer isn't modal, so "the side panel opened last" needs a shared record of what opened when, in `packages/ui`.
- **A resizable side panel**, a new general part for `packages/ui`, with its edge, its limits and its remembered width.
- **What changes in the spec:** spec 4's "Chats open in a modal", spec 4.1's "A chat's modal is not a window" and its Narrow rule, and the click-through's chat. The chat modal's Thread view, Allow changes bar and Thread items carry over.

### About the mock

- The people's titles are for display: Pam the Office Manager, Dwight Devops, Michael the CTO, Angela the Planner, Jan the Caretaker, Stanley the UI/UX Designer, and Jim (Developer) and Oscar (Reviewer) with chat off. Every answer to a message sent in the mock is the same line.
- Unlike the other pages, it doesn't embed the Geist fonts: it uses them where they are installed and the system's sans-serif elsewhere.

## Round 2: what it changes

- **Backlog:** a Task whose Plan and Definition of Done the user wrote and confirmed offers Mark Ready beside Plan with…, so Planning is optional (the user's answer of 2026-11-04; spec 2.1 changes with task 51).
- **Before Ready:** a read-only checklist. Confirm goes back to the Plan's and the Definition of Done's blocks, and the Planner's Pipeline proposal sits inside the rail, at its bottom, centred. With nothing waiting, Before Ready takes the Needs you card's place.
- **The rail:** a loop-back is drawn square, up, across and down, with small rounded corners.
- **A Description** (2026-11-05), optional, above the Plan: what the user wants in their own words, so a Task is more than a placeholder title. In Backlog the Planner's tab offers Make a plan, which plans from the title and the Description with nothing more to write. A new glossary term.
- **The Stage history** lists the runs on the left in a line or two each: number, state, times, tokens and the gist of the outcome. Everything about the run picked shows on the right. An Agent run has two tabs: Summary, with the outcome and its Handover note at reading width, and Thread, which follows a running Stage live and takes a message to it, landing at the next safe point; the Details switch sits on the Thread tab's row, as only the Thread has tool activity. In a Thread a Handover note shows its first lines and "Read it in full", which opens the Summary. A Project command's run shows its whole log. It opens in a large window (the user's choice of 2026-11-05, over a side panel and a view in place of the page), with the Pipeline in small at its top, each Stage's mark and name, to move between them.
- **Windows** (2026-11-05) come in three sizes, small, medium and large, so the whole app reads the same; the Stage history, a Decision's and the Gate's windows are large. Every window has a head with what it is and its X, and a bar at the foot with its actions on the left and Close, always, on the right. An action that needs a step first opens the step over the bar, and the bar's actions become the step's: the Gate's Send back with notes… shows where to and the notes, with Send back and Cancel. In a Decision's window you pick an answer, the recommended one first chosen, or your own words, then Answer.
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
