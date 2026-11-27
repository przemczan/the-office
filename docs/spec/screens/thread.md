# Thread view

Covers: the Thread as the chat drawer, the Task page and the Initiative page draw it: head, context bar, log (turns, tool calls, sessions, cards, lines), the composer (Mentions, images, Office and skill commands, Open page, Handover note), the context reading, the Sub-agents and Processes line and window, the Details switch, Copy.

## Where it is

- In the chat drawer ([shell.md](shell.md#the-chat-drawer)), on a Task's page for the person's Thread and Stage Threads ([task-page.md](task-page.md)), and on an Initiative's page for its shaping and planning Threads ([initiative-page.md](initiative-page.md)).
- One component, `ThreadView`, with the composer, log and context bar shared by every place; a place passes what is its own: the way back, why nothing can be written, the Open page.
- A Thread read in a window (a Stage run's Thread, a Consultation) uses the same log with its own head.

## Layout

- A section named after the Thread's title.
- Top to bottom: the head (the place's way back, the title, the Details switch), the context bar, for the Caretaker's chat the Allow changes bar, the log (scrolling), the alarm note, the Sub-agents and Processes line with the context reading beside it, the composer (or the read-only note), and the context bar's refusal.
- The log scrolls on its own; the page around it never does.

## Head

- The place's way back first (in the chat drawer **Threads** and the new-Thread button, see [shell.md](shell.md#a-persons-chat)).
- The Thread's title as `h3`: a chat Thread's title or "New thread"; a Task's or Initiative's Thread "With <name>" or "<title> · <name>"; a Consultation's own title.
- A pencil icon button, "Rename the Thread", shows once the Thread has a title; it turns the title into a field "Thread title" with **Save** and **Cancel** (Enter saves, Esc cancels); a refusal shows "The title wasn't saved".
- In a chat Thread a trash icon button, "Delete the Thread", opens the confirmation window of [shell.md](shell.md#a-persons-chat); it is off, its tooltip saying why, while the Thread is locked ([2.4.1](../2.4.1-threads.md#deleting-a-chat-thread)). No other Thread has it.
- The **Details** switch (group "Details", title "Tool activity and context lines"): on shows tool activity and the context lines in every Thread's log; one browser setting for all Threads.

## Context bar

- A line under the head: what the next message does to the session and what it costs, and the Thread's tokens ("tokens in this Thread", with the info icon giving each kind and its cost).
- Where a choice is offered (the session can continue or start fresh) a segmented control **Auto**, **Continue**, **Start fresh**; each option's title says what it does, the label beside it says it for the one chosen.
- Auto is the Context policy's choice (no override); Continue sets `continue-anyway`; Start fresh sets `start-fresh` (`PUT /threads/:id/context-override`).
- Labels: "Continues · cache warm, 41 min left"; "Continues anyway · cache cold, so the whole context is read again"; "Back to the Context policy's choice"; "Continues · <name>'s session default"; "Starts fresh · <name>'s session default · Brief ~3k tokens"; "Continues · cache cold, but the context is small"; "Starts fresh · cache cold, context large · Brief ~3k tokens"; "Starts fresh · Brief ~3k tokens".
- A Thread with no session to choose about says what the next message starts: "Starts a session with a Brief ~3k tokens", or "<Move> · <reason>" (moves: Continuing, Fresh, Hand-off).
- The size itself is the context reading's, shown once.
- When the cache goes cold the Thread is read again, as the service's move was read while it was warm.
- A refusal shows "That didn't change".
- See [2.5](../2.5-context-policy.md#overrides).

## Allow changes bar

- Only in the Caretaker's chat Threads (`changesAllowed` not null), and not read-only.
- Read-only note: "The Caretaker only reads in this Thread." with **Allow changes** (shield icon), disabled while the person is answering (title "Wait for the answer to finish, then Allow changes").
- **Allow changes** opens the window "Allow changes in this Thread?": "The Caretaker can read and edit any file and run any command on the workstation in this Thread, git push included. Your secrets stay refused: SSH keys, credentials, browser profiles, the Office identity and the database credentials." and "The Caretaker's session restarts under the new rules."; its button **Allow changes** (danger); a refusal shows "Changes weren't allowed".
- Allowed: the banner "Changes allowed in this Thread: the Caretaker can do anything on the workstation except read your secrets" with **Switch off**.
- The log gets the line "Changes allowed" or "Changes switched off", by you or by the user's name.
- See [2.4.1](../2.4.1-threads.md#allow-changes).

## The log

- Rows: an avatar on the left, the name and the time over what was said, one author's neighbouring messages as one turn; the user's own avatar is gray and named "You" (another user by their name); a person's is their Avatar or initials.
- A turn's text is Markdown: sanitised, raw HTML shown as text, headings kept out of the page's outline, a link to a Task, Initiative, Decision or Idea drawn as its chip, a link to another page of the app opened in place; every fenced code block and every quote has **Copy** (labels "Copy the code" and "Copy the quote") in its corner, and copying shows a toast; a selection copies as Markdown ([2.4.4](../2.4.4-messages.md#copy)).
- A user's message may show, under its text: its images as thumbnails (each opens the viewer, which steps through them; one whose content no longer loads reads "Image removed"), the line "With <chip> open" for the Open page it carried, and its delivery mark.
- Delivery marks: **Lands at the next safe point** (waiting, clock icon), **Delivered** (check), **Not delivered: the Stage ended first** (in a Stage Thread) or **Not delivered: <name> finished first**.
- A message that sent a Handover note from a Link card reads "You · Handover note from <person>".
- A message that is a skill command shows the mark "Skill command", the skill's name and its input.
- A new day opens with a day line once what shows spans more than one day.
- The log follows its end: each new message, or the person starting to answer, scrolls to it; a reader who scrolls up (more than 40px from the end) stays there as the log grows, but for what they send themselves.
- A Decision's link opens the log at its card once, centred.
- Tool calls: a lone call shows whole (tool name and summary); neighbouring calls fold under "N tool calls · <latest tool and summary>", opening to every call. They show only while Details is on.
- While the person answers: a row "<name> is working" with three dots; with Details off it adds the latest tool call, opening to the call whole.
- With Details off and only hidden lines to show: "Tool activity is hidden. Turn on Details to see it."
- A call whose card shows it (a Decision, a Proposal, a Link card, an Idea, the Office status) has no activity line.

### Sessions

- A Thread's log splits into sessions at each fresh or hand-off context line after the first.
- Each starts with a rule, shown whatever Details says: "New session · you chose it · brief ~3k" (a hand-off says "New session · hand-off · …"), with the **Brief** openable under it (read once opened).
- Each earlier session folds into a closed block: "Earlier session · 12 messages · ended at 85k context"; its messages stay in the DOM, and a fold holding a linked Decision card opens itself.
- A Thread with one session shows as a plain log.
- Context lines (Details on): "Continuing · cache warm · 41k context", "Fresh · cache expired, 48k context · brief ~3k"; one that started with a Brief opens to show it.
- Reasons read: "new Thread", "another person", "cache warm", "cache expired, small context", "cache expired, 48k context", "<name>'s session default", "you chose it", "as the Stage declares", "context full, Handover note written", "engine changed", "Allow changes switched", "duties changed".
- See [2.5](../2.5-context-policy.md#what-a-thread-shows).

### Lines and cards in the log

- **Handover note · <name>**: the note as Markdown; a long one shows its first lines with **Read it in full** where a reader exists.
- **Refusal**: "<tool> refused: <reason>"; **MCP server**: "The MCP server <name> didn't start: <reason>."; **Failure**: "<reason> · <time>"; **Consultation line**: the Office's own line.
- Office lines (small, muted): "Changes allowed" / "Changes switched off", a usage-window used-up notice ("Usage window used up · resumes 14:00", local time), an engine switched, a held line (a square for Stop, a pause icon for Pause or the fire alarm), and the stopped line "<user> stopped <name>." (a square) where a user stopped their answer, adding "Their session ended, as their engine can't interrupt a turn: the next message starts a new one." on such an engine.
- A user message's delivery mark reads "Lands at the next safe point", "Delivered" or "Not delivered: <name> finished first" / "Not delivered: you stopped <name>"; the user's own message that was stopped shows **Send again** beside it.
- A **Decision** card ([decision-card.md](decision-card.md)) and the answer line of a Decision.
- A **Proposal** card (Apply change, Not now, and by kind: Edit before hiring, Show it on the flow, Apply anyway; the card says what changes, as it was and as proposed; a generic Proposal is titled "Proposal: <action's title>", links its subject, adds Edit before applying where the subject has its own editor, and reads "Out of date" once its subject changed, [2.4.2](../2.4.2-decisions.md#proposals-and-approvals)), a **Link card** (a person's status and the button that opens a new chat Thread whose composer takes the Handover note, which the user edits or leaves out), an **Idea** card (an Idea captured in the Thread, with Shaped or Dropped when it is), the **Office status** card ("Office status", reading "Reading what waits on you…" until read). Their rules are in [2.4.1](../2.4.1-threads.md#what-a-thread-reads), [2.2](../2.2-people.md) and [6](../6-permissions-and-safety.md#a-persons-office-tools), which logs them in whichever Thread the user talks in, never in a Stage's Thread.
- A Proposal The Office declined on its own says why instead of who declined it: "Declined as its Consultation closed", "Declined as its Thread was deleted" or "Declined as a newer Proposal changing the same was applied" ([2.2](../2.2-people.md), [2.4.3](../2.4.3-consultations.md#proposals-in-a-consultation)).
- A link to a Proposal (`?proposal=<id>` with `taskThread` or `initiativeThread`, or its Waiting for you card opening a chat) brings its card into view and marks it (`aria-current`, the focus ring), as a link to a Decision does ([decision-card.md](decision-card.md)).

## Composer

- A box named "Message" (2 rows, 4 while a Handover note is prefilled) with an `@` icon button "Mention a Task, Decision or Idea" and a round send button.
- Placeholder: "Write to <name>…", or "Write to <name>… (lands at the next safe point)" while the person answers.
- The send button reads "Send (Enter)", or "Remove the images that can't be sent first" while an image breaks a rule, or the busy hint "You write here while a Stage runs".
- Keys: Enter sends, Shift+Enter breaks the line; Enter that confirms an input method's word is no send. While nothing can be sent, Enter shows the reason under the field instead of doing nothing.
- A message may be images alone.
- While the person answers, a message lands at the next safe point (barge-in); a Stage Thread takes the user's messages only while the Stage's person is answering ([2.4.4](../2.4.4-messages.md#barge-in)). A refusal shows "The message wasn't sent".
- While the person answers, a **Stop** button (square icon, "Stop <name>", "Stopping <name>…" while it ends the turn) shows between Mention and Send, and Send stays for a message that redirects them, in every Thread but a Stage Thread and a Consultation; one click stops, with no confirmation ([2.4.5](../2.4.5-stopping-and-restarts.md#stop-in-a-persons-thread)). A refusal shows "<name> wasn't stopped".
- A draft is kept while the Thread is out of sight where the place says so (the chat drawer), and goes once sent.
- A Task's first message to a person is written before its Thread exists and offers no commands.

### Mentions

- Typing `@` at the start or after a space (up to 40 characters on the line), or the `@` button, opens the picker "Mention a record": Tasks, Initiatives, open Decisions and Ideas whose words hold the query or whose kind (Task, Initiative, Decision, Idea) starts with it, 8 at most. Dropped records are left out; a Decision on no Task isn't offered; a Decision is labelled "Decision on <Task>".
- Rows show the kind icon, the label and the kind.
- Arrows move (wrapping), Enter or Tab picks, Esc closes the picker only; a press picks and keeps the field's focus.
- The text shows `@<name>`; on send, each record still in the text becomes a Markdown link to its page, which The Office reads as a Mention.
- Empty: "Reading The Office's records…" while loading, then "Nothing matches “<query>”."
- A Mention of a waiting Decision in a chat opens its window.
- A Task's Description in New Task and on the Task page, an Idea's notes (Capture an Idea, Edit the Idea) and an Initiative's outcome use the same picker ([2.4.4](../2.4.4-messages.md#mentions)).

### Images

- Images pasted into the box or dropped on it (it is marked while dropping) wait as small thumbnails over the field, each with its ×. A paste with text stays text.
- The contract's rules (type, size, count, and "no images with a skill command") are checked before anything uploads; their words list under the thumbnails and Send stays off while one is broken.
- At Send each image uploads (`POST /threads/:id/images`), then the message names their ids; sending again after a refusal uploads only those not yet uploaded.
- See [2.4.4](../2.4.4-messages.md#images-in-a-message).

### Commands

- Offered in every Thread but a Stage Thread, where "/" stays ordinary text.
- A "/" list shows while the draft starts with "/" and has no whitespace yet: the Office commands (`/clear`, `/help`, `/stop`), then the Thread's skill commands, each by its kind and filtered by prefix; arrows, Tab and Enter complete "/<name> ", Enter on a name typed whole sends.
- An Office command never reaches the person, even while the Thread is busy: `/clear` chooses Start fresh where the context bar offers it, answering "Your next message starts a fresh session." (else "There's no session to start fresh yet: your next message starts one." or "Your next message starts a fresh session already."); `/help` lists the commands; `/stop` stops the person as Stop does, answering "<name> isn't answering: nothing to stop." when idle. Each answers in a note above the composer (labelled "Clear", "Stop" or "Commands"), not logged, closed by Esc, its × or the next message.
- A skill command is sent as ordinary text.
- See [2.4.4](../2.4.4-messages.md#commands-in-the-message-box).

### Open page

- Only in the chat drawer, when the open page is a Task, an Initiative, an Idea open on Work › Ideas, a person's page or a Project's page (any of their tabs or sections); not on any other page or an address naming no record.
- The `@` picker's first row is "open page" with the record's chip where the kind is, offered while the query starts "open page" or "current page" (an empty query included).
- Picking it writes `@open page`; nothing else on the composer says the page would go.
- A message whose text holds `@open page` on its own (any case, picked or typed) goes with the page open as it is sent; the text keeps the words as written.
- The user's message shows "With <chip> open" under its text.
- See [2.4.4](../2.4.4-messages.md#open-page).

### Handover note prefilled

- A Link card's Handover note starts the draft; above the box: "Handover note from <name>, prefilled. Edit it before sending, or" with **Leave it out**.
- A draft the user left (or a question a page asks for them) stands over it.

### Alarm note and read-only

- While the fire alarm is on (not in a Stage Thread) the note and the button of [shell.md](shell.md#fire-alarm-control) show above the composer.
- Where nothing more can be written the composer is replaced by a lock note with the reason; the Thread stays readable.

## Context reading

- At the right end of the row above the box (the Sub-agents and Processes line fills it from the left): the session's context size against its model's window, "41k of 200k context", with a meter whose mark stands at 80%, where The Office asks for a Handover note.
- It is amber from 70% ("starts fresh at 160k" for a 200k window) and past the mark ("Handover note at this turn's end"); never red.
- Quiet readings: "No session yet" (a new Thread, another person), "Not read yet", and the size alone ("41k context") for a session read before its window was kept; while the person answers past the mark it reads "Writing a Handover note · 170k" ("Handing over" on a phone's width); a Thread whose context is full and Handover note written reads as starting fresh next.
- Its words by width: "context" and the mark text only from 520px; "of 200k" and the figure always; a phone's (under 400px) shows the figure alone.
- A focusable `img` named "Context: 41k of 200k" whose tooltip says it whole, for instance "At 160k (80%), The Office asks <name> for a Handover note and the next message starts a fresh session."
- A Stage run's ended reading is "Ended at 41k of 200k".
- A Stage Thread's meter marks the Stage's limits instead: "Soft limit 100k" and "Hard limit 180k"; a Stage with No limit has no marks.
- The log says "Context passed the soft limit at 101k: asked for a Handover note" and "Context passed the hard limit at 181k: turn stopped, Handover note asked".
- Each restart is its own line, "Fresh session at 102k context, Handover note passed on" (or "…, no Handover note"), and opens to show the Brief like other fresh-session lines.
- It asks nothing, so it is no button.

## Sub-agents and Processes

- A line right above the message input once the session has had any Sub-agents or Processes (a full-width button, bot icon or a live dot while any runs): "2 sub-agents, 1 process running · 3 ended, 1 failed" or, once none runs, "3 sub-agents, 1 process ended · 1 failed"; "Show" and a chevron at its end; named "<line>. Show them." Neutral: it asks and tells nothing.
- It shows nothing while the session has had none.
- Pressing it opens a large window titled "Sub-agents and processes" with "<name>'s chat · <Thread title>" (or the Thread's title) under it, which keeps one height; its bar says "Read-only: only the Agent can stop them" (lock icon) and Close. Where a place gives its own handler (the Stage history's run) it switches to its tab instead.
- The view: a list on the left, details on the right; under 640px wide one pane at a time, with "‹ All sub-agents and processes" to go back.
- The list: group **Running**, then **Ended** (the one that ended last first); each row's title (its description, or a Process's command, or "Sub-agent"), and a second line "Process · Failed · exit code 1 · 3m 10s" or "Sub-agent · Explore · Finished · 3m 12s · 45k context" (the context size live from the Sub-agent's tokens, and nothing without a figure, never 0). The first running (else the first ended) item is picked; what shows stays picked.
- States: **Running**, **Finished**, **Failed** (a Process adds "· exit code N" where the engine gives one), **Stopped** ("by the Agent", "when the turn was interrupted", "with the session", or "· ended when The Office restarted").
- A Sub-agent's details: a head with its title, its state badge, its kind badge, **In the background** where it runs there, and facts ("Started by <name> at 14:02", "running for 45s" or "ran 3m 12s, until 14:05", "N tool calls"); **Its prompt** with **Read it in full**; **Messages and tool calls** (with the Details switch), drawn by the Thread's own log; "N earlier messages and tool calls aren't kept."; **Reported back** ("Reported back to <starter>", Markdown) once it ended; an ending strip for a failure or a stop.
- A Process's details: the head and facts (an id where the engine gives one), **Command**, **Output** (monospace; "Following the end" with a live dot while the reader is within 24px of the end of a running Process, else **Jump to the end**; "Nothing printed yet." while it runs, "Printed nothing." once ended; "1.9 MB of earlier output isn't kept. The last 256 KB show here."), and the ending strip. A Process's shell isn't shown.
- Ending strips: "Finished with exit code 0 at 14:05.", "Failed with exit code 1 at 14:05. <reason>", "Stopped by the Agent at 14:05 (TaskStop).", "Ended when The Office restarted, at 14:05. It may still be running on the machine."; a finished Sub-agent has none.
- A failed read of the output or messages shows "The output wasn't read" or "The messages weren't read" with **Try again**.
- Nothing in it stops anything.
- The list is kept live by the start, change and end events for that Thread; the output and the messages of the item shown are subscribed to only while it is shown, caught up by sequence after every reconnect ([2.9.3](../2.9.3-streaming-and-ui.md#catching-up-when-a-page-opens-late)).
- See [2.9](../2.9-sub-agents-and-processes.md).

## States

- Loading: a Thread draws nothing until its record is read; the Thread list in the chat shows nothing until read.
- Empty: a Thread with no messages shows an empty log and the composer; "Tool activity is hidden…" only when Details alone leaves it empty.
- Waiting: the person's "is working" row; a user message's delivery mark; Submit and Accept on a Decision card wait while the person answers ([decision-card.md](decision-card.md)).
- Error: a refused send, rename, context choice or Allow changes shows its alert (titles above).
- Narrow window: the context reading shortens (see above); the Sub-agents and Processes view stacks under 640px; the chat drawer fills the window under 601px ([shell.md](shell.md#the-chat-drawer)).
- Loaders: a block whose data hasn't arrived shows `BlockLoader` (rows, bars or lines), a status with a hidden label that fades in after 200ms so a quick answer shows no flash, and holds still under reduced motion.

## Domain facts

- Threads, homes, who wrote it: [2.4.1](../2.4.1-threads.md).
- Messages, barge-in, Mentions, Copy, images, Open page, commands: [2.4.4](../2.4.4-messages.md).
- Context policy and the Brief: [2.5](../2.5-context-policy.md).
- Sub-agents and Processes: [2.9](../2.9-sub-agents-and-processes.md), [2.9.3](../2.9.3-streaming-and-ui.md#the-ui).
- Decisions in a Thread: [2.4.2](../2.4.2-decisions.md), [decision-card.md](decision-card.md).
- Stopping: [2.4.5](../2.4.5-stopping-and-restarts.md); in a Stage Thread Stop is on the Task page's run controls ([task-page.md](task-page.md)), in every other Thread it is in the Composer ([2.4.5](../2.4.5-stopping-and-restarts.md#stop-in-a-persons-thread)).
- Deleting a chat Thread: [2.4.1](../2.4.1-threads.md#deleting-a-chat-thread).
