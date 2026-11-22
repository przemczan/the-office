# The shell

Covers: the rail and its two states, the top bar (title and crumb, Project filter, search, Create, fire alarm control, user menu, Chat button), the Theme menu, the status strip and its figures (the Activity figure among them), the Needs you panel, the chat drawer, toasts, the Office messages slot, the Workstation figure, the Test instance banner.

## Where it is

- Every signed-in page opens in the shell, except `/setup`, which has its own small frame ([sign-in.md](sign-in.md)).
- `/sign-in` is drawn bare, outside the shell.
- The shell shows only once `GET /account` has answered, and only then connects the event stream.
- Which frame a page gets follows the matched routes, never the location.

## Layout

- A grid: the rail in column 1; the top bar (56px), the status strip and the page in column 2; the chat drawer in column 3 under the strip.
- Page, top to bottom: top bar, status strip, `main` (the page, scrolling).
- The status strip's height (52px, or 94px at two rows) sets the grid's second row.
- The open chat drawer pushes the page aside; at 601-900px it lies over it; at 600px and under it fills the window ([the chat drawer](#the-chat-drawer)).
- A page lays itself out by its own width (`@container page`), so an open drawer folds it; only what is on the body keeps `@media`.
- Toasts stack in the page's corner.
- In a test instance of The Office the grid gets a row above the rail and the top bar for the [Test instance banner](#test-instance-banner).

## Test instance banner

- Shown on every page of a service started with `OFFICE_TEST_INSTANCE=true`, `/sign-in` and `/setup` included, above the rail and the top bar; it can't be closed.
- Amber (the warning tones), with a filled "Test instance" mark, so it is never taken for the real Office in the next tab; `role="note"`.
- The web reads `testInstance` from `/api/health`, which needs no sign-in.
- Why: [6](../6-permissions-and-safety.md#test-instances).

## Rail

- A nav named "Surfaces". At its head the Office mark, a link to `/now` named "The Office".
- Items in order: **Now** (`/now`), **Work** (`/work`, also active on `/tasks/…`), **People** (`/people`), **Projects** (`/projects`), **Stats** (`/stats`; also matches `/stats/system-health`), **Live view** (`/live-view`).
- Then a spacer, then **Settings** (`/settings`), **Theme**, and the toggle.
- The active item is marked `aria-current="page"`.
- Two states: icon-only, with each label as a tooltip beside the icon; or expanded, with each label beside its icon, the Office mark's name "The Office" shown, and no tooltips.
- The toggle at its foot reads "Expand sidebar" / "Collapse sidebar".
- The choice is kept in this browser's local storage, never sent to the service; icon-only when none is kept or storage is blocked.
- The rail sets its own width and the grid follows it.
- The Needs you count is never a rail badge.

## Theme menu

- The rail's **Theme** item opens a 180px menu; its tooltip is hidden while the menu is open.
- Heading **Palette**: one row per palette, with its swatch and name, a check on the one in use.
- Heading **Density**: **Compact**, **Comfortable**, **Relaxed**, each with an icon (`rows-4`, `rows-3`, `rows-2`), a check on the one in use.
- Until a palette is chosen the system's light or dark is shown.
- A choice is saved to the account (`PUT /account/appearance`), as in Account › Appearance ([account.md](account.md)).

## Top bar

- Left: the page's title as `h1`, then its crumb: a parent link, " › ", then the crumb text.
- The title and crumb come from the page; a route without its own uses its static title.
- Right, in order: Project filter, search, **Create**, fire alarm control, user menu, Chat button.
- Under 600px wide a button keeps its mark alone (the words "Create", "Sound the alarm", "All clear…", the user's name and "Chat" are hidden); under 720px the bar's padding shrinks and the Project filter shows no label.

## Project filter

- A button named "Project filter: <label>" with `aria-haspopup`; the label is **All projects**, the one Project's name, or "<N> projects".
- While narrowed, the button shows up to 3 Project marks and is marked narrowed; while on All projects it shows the `layers` icon.
- It opens a group "Projects shown": first **All projects** (choosing it closes the menu), then each Project with a check, its mark and its name.
- Pressing a Project turns it on or off and the menu stays open; the last one shown stays on, as none is no choice.
- Turning every Project on counts as **All projects**, so Projects added later show.
- Each row has a crosshair button, "Show only <name>" (title the same), which shows that Project alone and closes the menu.
- Under 720px the menu is fixed to the window's right, 52px from the top.
- The choice is kept in this browser's local storage (`the-office.project-filter`), never in the address, so no Saved view holds it; another tab's change is followed.
- Projects the service no longer has are left out of the filter.
- The filter narrows Needs you (on Now, in the panel and in the strip), Running, Queue, Shaping, Since you left, and every Work tab; the rail never shows a count ([now.md](now.md), [work-board.md](work-board.md)).
- What it leaves out is counted in a note: "N more <things> in other Projects", with **Show all projects** at its end, which turns the filter back to All projects.

## Search

- A combobox named "Search The Office", placeholder "Find a Task, person, Idea…", with a shortcut hint: `⌘K` on Mac and iOS, `Ctrl K` elsewhere.
- ⌘K or Ctrl+K focuses and selects it from anywhere in the app and opens it.
- It reads `GET /search` for the words typed, with the Project filter; the words are at most 12, letters and digits only, lower-cased, each once, each matched as the start of a word.
- People are matched here, from those hired (not let go), by name or title, each word as the start of a word.
- Results are listed in groups, in this order, a group with nothing left out: **Tasks**, **Initiatives**, **Ideas**, **People**, **Documents**.
- Each option shows a kind icon, its label, a badge ("Archived" for a Task off the board) and the marks of the Projects it belongs to (none for a person or an Office-wide record).
- Keys: arrows choose (wrapping), Enter opens the chosen one; a press (mouse down) opens one.
- An empty result reads "Nothing matches “<query>”."
- Matches the Project filter leaves out are counted in the note "N more matches in other Projects", with **Show all projects**.
- Picking opens: a Task's page, an Initiative's page, Work › Ideas with `?idea=<id>`, a person's page, or a document in a window rendered as Markdown (held by the top bar so it stays once the search closes).
- Picking closes the search and clears the text.
- Records are also found by their id or a pasted link ([2.1.6](../2.1.6-board-and-search.md)).

## Create

- A secondary button, plus icon, named "Create".
- It opens one window ([task-page.md](task-page.md) for the Task it makes): **Task** or **Idea** chosen at its top by a segmented control, Task first; below it the body of "New Task" or "Capture an Idea", the window titled after it.
- It starts in the Project of the Project page or Task page shown, else the one Project the filter shows, else none; the user may choose otherwise.
- Switching between Task and Idea keeps the title, the Description (the Idea's notes), the Project chosen (Office-wide kept for the Idea while the Task shows its own) and the Attachments.
- New Task: a title, a **Kind**, a Description, Attachments, the Project and Tags; it then opens the new Task's page.
- Kind: a segmented control of **Feature**, **Bug** and **Chore**, each with its glyph, between the title and the Description; Feature at first ([2.1.3](../2.1.3-tasks.md#task-kind)). "Add a Task to <Initiative>" has it too; an Idea has none.
  - Choosing Bug while the Description is empty fills in the Bug outline, "**Steps to reproduce**", "1. ", "**Expected**" and "**Actual**", the cursor at the end of "1. ".
  - While the Description is the untouched outline, its hint reads "Optional. Choosing Bug filled in this outline because the Description was empty. Edit it freely.", and on a Bug the field is eight rows tall rather than four.
  - Leaving Bug while the Description is still the untouched outline empties it again; a Description with the user's words is never touched.
  - The outline is the web's alone: the service sees only a Description.
  - A changed Kind is unsaved input.
- Tags' hint: "Optional. Words to find it by, such as its area."
- See [2.1.3](../2.1.3-tasks.md) and [2.1.2](../2.1.2-ideas-and-attachments.md).

## Fire alarm control

- While off: a danger-ghost menu button with the siren icon, label "Sound the alarm", title "Fire alarm: pause automated work", opening a menu 400px wide of the three ways ([2.8](../2.8-fire-alarm.md)), each a tall item with room around it and a gap between items, its name over a one-line hint:
  - **Safe pause ASAP**: "Every Stage stops at its next safe point; chats lose their tools."
  - **Safe pause after the current Stages**: "Running Stages finish; no new Stage starts."
  - **Safe pause after the current Tasks**: "Started Tasks finish; no new Task starts."
- Choosing a way asks no confirmation. The toast reads "Alarm sounded: every Stage stops at its next safe point. Chats stay open.", "Alarm sounded: running Stages finish, then no new Stage starts. Chats keep their tools." or "Alarm sounded: started Tasks finish, then no new Task starts. Chats keep their tools."
- While on: a danger button "All clear…", title "See what will resume, then give the all clear". It opens the review on Now (it goes to `/`).
- While on in a softer way, it is a split: "All clear…" joined to a chevron button named "Make the alarm stricter", opening a menu of the stricter ways only. The toast reads "Alarm made stricter: " and the way's words, as above.
- A refusal shows a notice "The alarm wasn't sounded" (or "The alarm wasn't made stricter") with the service's reasons.
- The alarm is read from Now's data; its changes arrive by `fire-alarm.sounded` and `fire-alarm.all-clear`.
- The review is on Now ([now.md](now.md#fire-alarm-panel)).
- Under a chat's composer, while the alarm is on ASAP, a note: "Alarm on: <name> answers but runs no tools." with the button **Let <name> act in this thread**; once lifted: "<name> may run tools in this thread while the alarm is on." with **Take it back**. A refusal shows "That didn't change". A Stage Thread has no note.
- A Task the alarm holds shows the state "Paused by the alarm"; one its engine's usage window holds shows "Usage window used up · resumes 14:00" (local time).
- See [2.8](../2.8-fire-alarm.md).

## User menu

- A ghost button with the user icon, named "User menu: <name>" (the name, or "Account" until read), opening a menu 200px wide.
- **Account** goes to `/account` ([account.md](account.md)).
- **Sign out** signs this device out and lands on `/sign-in`; it is disabled while it runs.

## Chat button

- At the top bar's end, labelled "Chat"; it opens the chat drawer, and while the drawer is open it closes it. Its `aria-expanded` follows.
- It shows a face and a dot, never a number: nothing new is a `message-circle` icon, named "Chat: nothing new"; a person answering shows their avatar with an answering dot, "Chat: <name> is answering"; an answer waiting shows up to the 2 latest answerers' avatars with an answered dot, "Chat: <A> and <B> answered".
- With an answer waiting it opens that person's chat on the newest answer; otherwise where the user left off.
- It reads `GET /chats/activity` with the hired people who have chat on.
- Closing the drawer gives focus back to the button.

## Status strip

- A `status` region named "Status strip", under the top bar, live from `now.changed`; it is its own container (`@container strip`).
- Left, never hidden: **Needs you**, the **5-hour window**, **Desks in use**, **Activity**, **Tokens today**; then **Fire alarm** while the alarm is on.
- Right: the Workstation figure and the Office messages slot.
- Each figure is a small label over its value; one that opens something is a button, the rest are plain.
- Widths (by the strip's own width): under 1,180px the Workstation's cores and a narrower slot (260px); under 900px shorter words, gaps of 12px and a slot of 216px; under 600px two rows (93px high), labels shortened ("Desks in use" to "Desks", "Tokens today" to "Tokens", "5-hour window" to "5h window"). A figure is never hidden by width, only words. Words hidden by width stay in the DOM.
- Needs you: label "Needs you" with a live dot while the count is above 0, then the count of items in the Projects shown, then, while Waiting for you holds items in the Projects shown, a small faint "· N waiting" ("·N" when tight, title "N waiting for you"), and "+N in other Projects" ("+N" when tight, title "N more in other Projects") while more wait elsewhere. A button named "<N> need(s) you[, N more in other Projects][, N waiting for you]", which opens the [Needs you panel](#needs-you-panel). It is an alert while something waits in the Projects shown, a softer tint while only other Projects have something, and quiet otherwise; it pops once each time the count goes up (not on the first load; reduced motion has no pop). Waiting for you's count never changes the tone, the pop or the live dot.
- 5-hour window: nothing until an engine's windows are read. One engine: its % with a meter, "resets 14:20" (or "used up until 14:20" / "used up"), and "7d N%". Two or three engines: each engine's meter and %. More than three: the highest, and the word "highest". The % and meter turn amber from 90% (nearly used) and red at 100% (used up). A button named "5-hour window: <engine> N%, …" that opens a list "Usage by engine": per engine, the 5h and 7d windows each with a meter, % and "resets …"; engines in Settings › Engines' order, one no longer listed last by its id. The list is drawn on the body, placed under the figure.
- Desks in use: a dot (running while above 0, idle otherwise), the count and "/ <limit>"; title "N of M desks in use". While the fire alarm is on ASAP it reads 0, though its Tasks keep their desks; under a softer way it counts as usual.
- Activity: label "Activity" with a live dot while anything runs, then in bold the count `GET /activity` answers (what runs and the ended items not yet seen, [2.14 The count](../2.14-activity.md#the-count)); shown once it has answered, and live from `activity.changed`. A button named "Activity: N running[, M ended not yet seen]", which opens the [Activity panel](activity.md).
- Tokens today: the count of input, output and cache writes (cache reads left out) with an info icon giving each kind and its cost.
- Fire alarm figure: a siren icon and "Fire alarm", then "Stopping at safe points" or "On since 14:02" ("On" when tight) under ASAP, "Stopping after Stages" or "Stopping after Tasks" under a softer way. A button named "Fire alarm: <words>. See what will resume, then give the all clear", which opens the review on Now.
- See [2.11.3](../2.11.3-system-health.md) for Stats; the strip's figures are Office-wide whatever the Project filter shows, except Needs you.

## Workstation figure

- Label "Workstation" ("CPU" when tight); an icon, the CPU use in % (tinted when busy or high), and "· N cores" (hidden under 1,180px). While no use is read yet it says "Measuring…".
- It polls `GET /workstation/load` every 2 s itself (paused while the tab is hidden), so it shows while Now loads; nothing shows after a failed read.
- A button named "Workstation: <use> CPU, <cores>" that opens a panel (dialog "Workstation") placed under it, right-aligned, on the body.
- The panel: a head with the CPU model and speed ("3.2 GHz") and "Live · every 2 s" with a live dot; two tiles **CPU** (use, cores, a sparkline) and **Memory** (use in %, "Used" and "N GB / M GB", a sparkline); **Use per core** (a bar per core, up to 32 a row, each titled "Core N: P%"); a memory bar split into "The Office", "Other used" and "Available" in GB; the foot: **Load average** (1, 5 and 15 minutes, where the system reports one) and **Up for** (for example "3d 4h", "2h 5m", "12m").
- Levels colour each meter: calm, busy from 60%, high from 85%.
- The sparklines keep the last 60 reads (about 2 minutes), in this browser only, empty after a reload and not growing while the tab is hidden.

## Office messages slot

- A button of fixed width at the strip's right end, shown only while there is something to tell, so a long message never moves a figure. It shows the first message's icon, its short line (about 34 characters at most), who says it and when, "+N" for the rest and a chevron. Named "Office Notifications: <short line>[, N more]".
- It opens a popover headed "Office Notifications · N" that lists each message whole, each with its tone (amber, red, green, blue or grey on its left edge), icon, line, who says it and when, and its action.
- Order: **Reconnecting to The Office…** first (while the web lost the service; its icon pulses; line "The web has lost the service and is reconnecting. The figures are the last ones read.", detail "Figures may be out of date"); then the Office's own open Notifications (kinds starting `office.`), newest first; then a scheduled update or restart ("Update scheduled" / "Restart scheduled", with "Waiting for N things" or nothing when none); then **Turn on desktop notifications** until the user answers.
- A Notification's kind sets its look: window nearly used (amber, `gauge`), window used up (red), window reset (green, `rotate-ccw`), service down and engine down (red, `triangle-alert`), alarm lifted (green, `siren`), update done (green, `check`), update failed (red).
- The meta line is the speaker's avatar, name and the time ("Pam · 13:05"), or the time alone while nobody speaks (The Office).
- A message naming an instant words it in the browser's time zone: "17:10" the same day, "Tue 17 Nov 17:10" otherwise.
- Actions: **Open Settings › Updates** (a link, for a scheduled update or restart and an `office-update` Notification); the button **Turn on desktop notifications** (the browser asks once).
- A slot's list opens under the slot from its left edge, kept inside the window, and the slot shows no tooltip on hover.

## Needs you panel

- A drawer titled "Needs you", description "<N> need(s) you, oldest first", opened from the strip's Needs you figure; it lies over any page and shows the same cards as Now, with the Waiting for you group under them ([now.md](now.md#waiting-for-you)); the description counts only the Decisions and Gates.
- Its left edge resizes it (handle "Resize the Needs you panel"); its width is kept, and at a narrow window it fills the window.
- Esc closes one thing at a time: a menu, then a window, then the side panel opened last (the panel, the Activity panel, the chat drawer and a conversation's drawer are side panels).
- Nothing shows while the panel is closed or Needs you is unread.
- A Decision or Gate is answered in place; a Gate window's Open Changes goes to the Task and leaves the panel out of the address.

## Notification channels

- In-app: a toast (below). Desktop: the browser's own notification, left out for a Notification quiet hours hold (the toast still shows). Phone: the service pushes it; the web ignores it.
- A raised Notification takes the place of those it `replaces` (collapsed Outcomes).
- The tab's title is "(N) The Office" while Needs you holds N items across every Project, else "The Office"; while the tab is hidden an item new to it blinks the title between "(N) The Office" and "N need(s) you" and the favicon each second, never under reduced motion. Outcomes, Office kinds and Waiting for you aren't counted.
- The web raises its own "service down" while the service is out of reach: the line "I lost touch with the service and am reconnecting." (the speaker is the holder of Default person to talk to, else the Caretaker) or, with no speaker, "The Office lost its service and is reconnecting.", to the browser's channels the user's routing gives it.
- Opening a Notification goes to its Task, its Initiative (an Initiative Decision at its card), Now for the Office's own state or a Stand-in choice (with the speaker's chat open for an Office kind that has a speaker), or Settings › Updates for an Office update.
- While the tab is focused, the user is reported active once a minute, which holds phone pushes.
- See [2.7](../2.7-notifications.md).

## Toasts

- Short messages in the page's corner. A confirmation of what the user just did stays 4 s; a Notification's notice (with a title and a description) stays 10 s.
- Each toast is a status of its own, with a close button; the stack has no role.
- A toast with the same key replaces the earlier one.

## The chat drawer

- An `aside` named "Chat with <name>" (or "Chat" at the picker), focus moved into it on opening; Esc or the close button "Close (Esc)" closes it; it is a side panel, not a window, so the page stays usable and it stays open as the user moves about.
- Where it stands lives in this tab's session storage (Links, Back and Forward leave it; a reload keeps it); `?chat=…&thread=…` is a way in and is taken out of the address as it opens.
- Width: 360px at least, 420px standard, 720px at most, and as far as the room leaves the page 480px beside it or 240px under it; the choice is kept in this browser's local storage (`the-office.chat-drawer-width`). Its left edge resizes it ("Resize the chat"). Beside the page (over 900px) it pushes it; at 601-900px it lies over the page with no backdrop, right under the strip; at 600px and under it fills the window and has no resize edge.
- It lists direct chats only; people with chat off aren't listed.

### The person picker

- With no chat open: head "Chat" with "Pick a person to talk to" and the close button; each person with chat on, in one fixed order: avatar, name, title and their standing.
- Standing: "No Threads yet", "Answered · <day and time>" (wins over answering, as it waits on the user), "Answering…", or the time of the last move.
- The note "People with chat off aren't listed. Chat is turned on in a person's Role card."

### A person's chat

- The head: one switch to someone else (title "Chat with someone else"), the whole person: their avatar, name, title and a chevron, and a line "Reads, and changes only in a Thread where you allow changes" for the Caretaker, "Reads every Project and changes no file" for everyone else; all of it shows hover and focus. The close button stands apart, beside it.
- The switch opens a menu "Chat with": each person as a radio with their avatar, name, title and a standing dot (title: their standing), and a foot "Open <name>'s page for their Role card and Memory." linking to `/people/<role>`.
- Under the head, tabs, one per person opened (a tablist "People open in the chat", each with a × to close and a title "<name> · <standing>"); opening a person adds a tab or shows the one open; closing one shows its right-hand neighbour, else the left, else the picker. Each tab keeps the Thread or Thread list the user left it on. A person no longer offered has no tab.
- One column: the open Thread fills the drawer; the Thread list is a step back from it.
- The Thread list: a button **New thread** (plus icon) and "Threads · N", then each Thread: its title (or "New thread"), a dot while it has an answer the user hasn't seen, a context dot (warm: "Cache warm"; else "Starts fresh with a brief, or continues a small context"), the day and time of its last move, "answering" and "answered" marks; a page at a time with **Show more**.
- Empty list: "No threads with <name> yet." and "A new Thread starts a session that reads every Project's base branch." with **New thread**.
- Inside a Thread: the way back **Threads** (title "Every Thread with <name>", a dot while another Thread has an unseen answer), an icon button "New thread", then the Thread ([thread.md](thread.md)).
- A refusal to start a Thread shows "No new Thread".
- The Thread's `@` picker offers the Open page and a message mentioning it sends it ([thread.md](thread.md#open-page)); the drawer is the only place that offers one.
- A Mention of a waiting Decision opens its window rather than moving the page.
- A Proposal's card in Waiting for you opens its chat at that Thread with the Proposal's card brought into view and marked (`aria-current`, the focus ring); the mark is the drawer's own and leaves with any other move in the drawer, and is never kept in session storage.
- The newest message on screen is reported to the service while the tab is visible, so what the user has seen holds in every browser ([2.4.1](../2.4.1-threads.md#what-the-user-has-seen-in-a-chat)).
- Below 901px, "Show it on the flow" on a Proposal closes the chat; "Back to the Thread" opens it again.
- Asking someone from a page (a Project's Commands, a library Pipeline, a Project's Pipelines) opens a new chat Thread whose composer starts from the question left for it, or shows a note while nobody holds the duty.
- See [2.4](../2.4-conversations.md).

## States

- Loading: the shell waits for the account before drawing; each figure shows nothing until its data is read.
- Service out of reach: "Reconnecting to The Office…" in the slot; the figures keep their last values.
- Signed out: any `/api` 401 sends the page to `/sign-in?returnTo=<path and query>`; the WebSocket's close code 4401 stops the stream for good.
- First-run setup open: every page but `/setup` and `/settings/engines` goes to `/setup` ([sign-in.md](sign-in.md)).
- Narrow window: see Layout and the widths above; under 600px the top bar shows marks alone.
- Reduced motion: no pops, pulses or blinking.

## Domain facts

- Needs you, Decisions and Gates: [2.4.2](../2.4.2-decisions.md#where-a-decision-shows), [2.3.3](../2.3.3-gates-and-checks.md).
- Notifications and channels: [2.7](../2.7-notifications.md#channels).
- Fire alarm: [2.8](../2.8-fire-alarm.md).
- Chat and Threads: [2.4.1](../2.4.1-threads.md), [thread.md](thread.md).
- Appearance and signing in: [2.10](../2.10-users-and-signing-in.md), [4.1](../4.1-ui-rules.md).
- Usage windows: [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md).
