# People

Covers: the People grid, a person's page (head, Overview, Work, Conversations, Memory, Role card tabs), editing a Role card, hiring (preset, from scratch, from a Proposal), letting a person go and hiring back, the set-up hint while nobody is hired.

## Where it is

- Routes: `/people` (the grid), `/people/$roleKey` (a person, Overview tab), `/people/$roleKey/work`, `/people/$roleKey/conversations`, `/people/$roleKey/memory`, `/people/$roleKey/role`, `/people/$roleKey/role/edit` ("Edit Role"), `/hire` (hire from scratch), `/hire?proposal=<id>` ("Edit the proposed Role").
- Open it from the People item in the rail ([shell.md](shell.md)).
- The page title is "People"; its crumb is "1 person" or "N people". On a person's page the title is the person's name, the parent link is "People" and the crumb is the person's name and title.
- On `/hire` the title is "People" with the parent link "People"; the crumb is "Hire a Role from scratch", or "Edit the proposed Role" with `?proposal=`.

## Layout

- `/people`: an error alert (if any), then a grid of same-size tiles: one card per person, the Caretaker first, then the Hire tile (or the set-up hint while nobody is hired).
- A person's page: the head, an alert (only for someone let go), the tab strip, then the open tab.

## Person cards

- Order: the built-in Caretaker first, the rest as the service lists them. Someone let go stays in the grid.
- Each card has: the person's Avatar, the name (a link that opens the person's page, the whole card being its target), the title, and the responsibilities text.
- The chat button (icon, label "Open the chat with <name>") shows when the person's Chat capability is on and they are not let go; it opens their chat ([shell.md](shell.md)).
- Foot, left to right: one icon per capability the person has (label as hover and for screen readers); a duties mark when the person holds duties; "Built in" with a lock (the Caretaker); "Let go" (someone let go); the Task limit in short words.
- The duties mark is a briefcase icon with "N duties" (or "1 duty"); hover or focus names each duty by its label. People reads the duties list once for all cards.

## Hire tile

- Title **Hire a Role**, sub-title "From a preset or from scratch".
- Text: "<titles of the presets nobody fills>, … to fill." when any, then "Every setting can change later on the Role card."
- **Hire a Role** (shown only while a preset's Role is unfilled): opens the Hire dialog.
- **Start from scratch**: goes to `/hire`.

## Hire dialog

- Window "Hire a Role", medium. Text: "One person fills each Role. Every setting can change later on the Role card."
- **Preset**: a radio group of the presets whose Role nobody fills. Each option has the preset's title, then its responsibilities, "Suits: …" (the duties it holds by default) and the Task limit in short words.
- **Name**: hint "Shown with the title, as in Ada · Developer."; holds the chosen preset's suggested name until the user types one. It has focus on opening.
- The submit button is **Hire** with the name after it ("Hire <name>") once a name is typed.
- A refusal shows as the alert "The person can't be hired yet".
- On success: the toast "<name> · <title> hired.", the dialog closes and the page goes to the new person's page.
- Closing with unsaved changes asks first (a chosen preset other than the first, or a typed name).

## Set-up hint

- Shows in place of the Hire tile while nobody is hired: every Role other than the Caretaker is unfilled or its person let go. The grid then has the `people-grid-setting-up` layout, the hint a whole row under the Caretaker's card.
- Title "Nobody is hired yet", sub-title "Each preset brings the duties it suits".
- A line per preset: its title, the duties it suits (their labels), its capability icons and its Task limit in short words.
- Fallback text (when duties are loaded): "While nobody holds a duty, you do it yourself, except <duties that fall back to the Caretaker>, which goes to <Caretaker name>, and <duties that stay unstaffed>, whose Pipelines can't start. A Role from scratch can take any duty in Settings › Duties." (a link to `/settings/duties`).
- Buttons: **Hire a Role** (only while a preset's Role is unfilled), **Start from scratch**, and **Set up The Office with <Caretaker name>**.
- The last one opens a new Thread in the Caretaker's chat with the draft "Help me set up The Office. I work on " in the composer; nothing is sent. A refusal shows as the alert "No new Thread".

## Person head

- Left: the Avatar (large).
- Name and title; below them chips: one per capability (icon and label), the Task limit (layers icon), then "Built in" (lock, the Caretaker) or "· Hired <day>", and "· Let go <day>" for someone let go.
- Actions, for someone not let go: **Open the chat** (when Chat is on), **Edit Role** (hidden while its form is open; goes to `/people/$roleKey/role/edit`), **Let go** (not for the Caretaker).
- For someone let go the only action is **Hire <name> back**; on success the toast is "<name> hired back."
- A person let go gets the alert "<name> was let go": "Nobody fills the <title> Role. <name>'s Role card, Memory and chats are kept, unused and readable."

## Tabs

- In order: **Overview**, **Work**, **Conversations**, **Memory**, **Role card**.
- The Role card tab stays chosen while its edit form is open.
- Pressing a tab goes to its route.

## Overview tab

- Two columns.
- Left: **Avatar** block, "Who <name> is" (the responsibilities), and **Works with** (one line per engine type the person sets, "<type>: <model> · <effort>", or "Each engine's default model and effort" when none, then the Task limit; below it "Session default: <label>").
- Right: **Skills** (the skills each session of the person gets, as chips with the skill's description on hover; "None yet." when none; a link "Role card" to the Role card tab).
- The Avatar block holds the image row: the current picture or an empty mark, the hint "PNG, JPEG, WebP or SVG, at most <N> MB" and the upload and remove buttons; the toast is "Avatar saved for <name>." or "Avatar removed for <name>.". For someone let go the hint is "Hire <name> back to change it." and the buttons are gone.

## Work tab

- A filter group labelled "Show": **All**, **Not started**, **In progress**, **Waiting on you**, **Done**, **Dropped**, each with its count; one is pressed.
- The Tasks are those the person has a part in, in the Projects the Project filter shows ([shell.md](shell.md)); the service filters and counts them (`GET /roles/:roleKey/tasks`). A note counts the Tasks in other Projects.
- Table columns: **Task** (the title as a link to the Task page, with its Project chip), **Part**, **State** (the Task's state badge).
- Empty: "No Tasks here. Try another filter."
- Rows come a page at a time; **Show more** loads the next page. Another filter keeps the old rows until its own are read.

## Conversations tab

- Two columns.
- Left: "Chat threads · N" (the person's chat Threads, newest first). Each row is a button with the Thread's title ("New thread" when it has none), "<context> · <tokens> tokens" and the start day and time; it opens that Thread in the chat.
- The block's **Open the chat** button shows when Chat is on and the person isn't let go.
- With Chat off: "Chat is off for <name>: talk to them on a Task. It can be turned on on the Role card; earlier Threads stay readable."
- Empty (Chat on): "No threads yet."
- Right: "Threads on Tasks · N". Each row links to its Task's page with that Thread open; it shows the Thread's title ("A Thread" when it has none), the Task's title and the Project's mark. Empty: "None yet."
- Both lists come a page at a time with **Show more**; the totals come from the service.

## Memory tab

- Block "Memory · N" with the button **Delete memory** (when any note exists), beside the block **Add a note** (only while shared memory is in use).
- When shared memory is off for the person, the alert "Not in use": "Shared memory is off for <name>: the notes are kept, but no session reads them and nothing new is written. Turn it on on the Role card to bring them back."
- Text: "Every new session of <name> reads these at start. Notes are appended, never edited." Empty: "No notes yet."
- Notes are grouped by Project (heading the Project's name, or "All Projects"), newest first. Each note shows its text, its day and time, its source and **Delete**.
- Source: "Added by <user>" (the user adds it), "Written by <name> in a chat" (a button opening that Thread), or "Written by <name> on <Task title>" (a link to the Task with the Thread open; "a Task" once the Task is gone).
- **Add a note**: the textarea "Note" (hint "Short and standing on its own: it is read in a later session, never edited."), the select "About" ("All Projects" or one Project) and **Add note** (off while the note is blank). A refusal shows as "The note can't be added".
- **Delete** opens "Delete this note?" with the note text and "Sessions started after this don't read it."; its button is **Delete the note**; the toast is "Note deleted."
- **Delete memory** opens "Delete the whole memory?" with "All N notes are removed. This can't be undone."; its button is **Delete memory**; the toast is "Memory deleted." A refusal shows as "Nothing was deleted".

## Role card tab

- Left: the block "Role card", the card read-only, in groups. Right: the block "Changes".
- Groups, each with its title and a one-line description: **Identity** ("Who the person is, as People shows them."), **Work** ("What the Agent works from, and how much at once."), **Engine** ("How the person works on each engine type. Where they run is set by the Office, the Project, the Initiative or the Task."), **Capabilities** ("Enforced by The Office; combine them freely."), **Permissions** ("What the Agent may do in a Stage."), **Authority** ("What the person may do with Office tools, and when."), **MCP servers** ("From the library in Settings. Each tool has its own authority setting; a Stage may narrow it."), **Skills** ("From the library in Settings; skills for everyone come with every Role.").
- Identity: "Name and title", "Responsibilities", "Duties" (the duties the person holds; "None." with the link "Change in Settings › Duties"; the Caretaker: "Holds no duty; it is the one to talk to while nobody holds Default person to talk to.").
- Work: "Instructions", "Task limit", "Session default" (with its description).
- Engine: "Works with", a small table with one row per engine type that has an engine listed or that the person sets: the type's icon and name, **Model** and **Effort**, each its value or "Engine's default" in muted text; a type with no engine listed is marked "No <type> engine is listed". Then "Runs on" (for someone not let go: the engine the engine cascade gives outside any Project with the model and effort they work with on it, "<model> · <effort> on <engine>", with a note naming what that engine can't do, "No engine: add one in Settings › Engines" when none, and the list "In <Project>: …" of Projects where another engine, model or effort applies, naming a Project's setting or force).
- Capabilities: one line per capability, a check when on, a minus when off, with its hint.
- Permissions: "Permission profile" (one line per part joined with " · ").
- Authority, in this order ([2.2](../2.2-people.md#authority-and-hard-switches), [6 Authority](../6-permissions-and-safety.md#authority)):
  - one row per tool area with its value; where a value differs on own work and others' work, both on one row, "Own: Allowed · Others': Ask me";
  - inside an area, its named groups (Change Roles and Change Project settings among them) and single tools whose value differs from the area's, or that are capped; the single tools `propose_project_commands`, `propose_test_targets`, `propose_actions` (Proposal or Never), `post_link_card` and `show_office_status` (Allowed or Never) take only the values they can have;
  - then the followed groups, "Run installs" and "Publish outside the Pipeline", each badged "Followed by the Agent", Run installs adding "enforced on run_environment_check"; no other row carries a badge;
  - beside them, the row "Approve held calls and apply Proposals", in no area ([6 The trust anchor](../6-permissions-and-safety.md#the-trust-anchor));
  - a value that consults a Role not yet hired carries the note that it asks the user until the Role is hired.
- A capped row reads "Proposal, Ask me or Never only", linking to its reason: the trust anchor ([6 The trust anchor](../6-permissions-and-safety.md#the-trust-anchor)), or The user's alone for Publishing settings ([6 The user's alone](../6-permissions-and-safety.md#the-users-alone)).
- A value at the preset's default shows in muted text as "Preset default (<value>)", such as "Preset default (Ask me)"; a set value shows plainly ([2.2 Presets](../2.2-people.md#presets)).
- MCP servers: each server by name with the badge "On" or "Off"; on: each tool and its setting; off: "Off: no session gets it until it is on". None: "None yet. Add them to the library in Settings › MCP servers, then give them to <name> with Edit Role."
- Skills: chips; "None yet. Give <name> skills from the library here or in Settings › Skills."
- For the Caretaker, the Task limit, Capabilities, Permissions and Authority groups say "Built in: fixed for the Caretaker." ([2.2](../2.2-people.md#caretaker)).
- **Changes**: a timeline of every change since the hire, newest first as the service lists them, each with its day and time: "Hired", "Role card version N" with the changed fields joined by " · ", and a skills change line; each can end with "proposed by <name>". Under it: "Each change applies from the next session started."

## Edit Role and Hire from scratch

- The same form (`RoleCardForm`) serves "Edit Role", "Hire a Role from scratch" and "Edit the proposed Role"; it fills the page in one card of the same groups, as editable fields.
- Identity: **Name**, **Title**, **Responsibilities** (hint "One paragraph, shown on People.").
- Work: **Instructions** (hint "What the Agent works from: the job's guidance. What it may do is its Authority. Every session carries them, so keep them short."), **Task limit** (hint "Agents on Stages at once. None means no Pipeline may name the Role."; options "None: talks only" and "N at once"), **Session default** (hint "What a Thread does once its cache has cooled, an hour after the last call. A Stage's own choice still wins at a Stage boundary.").
- Engine: **Model and effort for each engine type**, one row per engine type with an engine listed, in Settings › Engines' order, plus any type the person sets that has none (marked "No <type> engine is listed", with **Clear**): the type's icon and name, a **Model** select ("Engine's default" first, then the type's models) and an **Effort** select ("Engine's default" first, then the type's efforts; left out for a type that takes none). Hint: "Used on whichever account of the type a session lands on, and on a Stand-in Engine of that type. A Project can set its own for <name>."
- An engine type's models are those its engines offer together; a model only some accounts offer is marked "Not on every account", as a session on another account works with that account's default model.
- A saved model no engine of the type lists any more stays picked, "<model> · No longer offered", until another is picked ([5.4.5](../5.4.5-engines-and-cascade.md#models-an-engine-lists)).
- Opening the Role card asks, in the background, each engine whose model list is older than a day; the models shown don't wait for it.
- Capabilities: a switch per capability, with its hint.
- Permissions: **Permission profile** (hint "What the Agent may do in a Stage. A Stage may narrow it, never widen it. Read-only git is always allowed."): switch "Edits files in its worktree", select "Runs", switch "Searches and fetches the web".
- Authority: the rows of the Role card tab, each a select of its values (Allowed, Consult _person_, Ask me, Proposal, Never; a capped row offers only Proposal, Ask me and Never), its hint "Followed by the Agent" on a followed group, with "enforced on run_environment_check" added on Run installs (and "asks you until the Role is hired" when it consults a Role not yet hired).
  - A row that differs on own and others' work has two selects, **Own** and **Others'**.
  - A row at the preset's default shows "Preset default (<value>)" in muted text; a set row has **Reset to the preset's default** beside it ([2.2 Presets](../2.2-people.md#presets)).
  - Saving it is a Role card change, under the trust anchor ([6 The trust anchor](../6-permissions-and-safety.md#the-trust-anchor)).
- MCP servers: a check per library server and, for a ticked server that is on, a select per tool (label "MCP tool <name>", the tool's description as hint); tools whose names are too long for sessions are left out.
- Skills: a check per library skill ("For everyone" when it goes to every Role; "Off until you review it" while waiting for review).
- The Caretaker's form shows its capabilities, permission profile, Authority and Task limit disabled with "Built in: fixed for the Caretaker."; its MCP servers stay editable.
- Save bar at the bottom: "You have unsaved changes." or "Changes apply at the next session start: a new Thread or the next Stage."; **Cancel**; **Save changes** (editing), or **Hire the Role** / **Hire <name>** (from scratch or from a Proposal).
- A refusal shows as "The Role card can't be saved yet" (editing) or "The person can't be hired yet".
- Saving from a Proposal applies the Proposal with the edited card. A Proposal no longer open shows the alert "This Proposal is no longer open": "It was applied or declined already; its card in the chat says which."; one that can't be read shows "The Proposal can't be read".
- Save sends the card only when it changed, then each MCP server whose tick changed; the card keeps only the tool settings the user set.

## Let go dialog

- Window "Let <name> go?", small. It shows the refusal alert "<name> can't be let go" when refused.
- Text: "Nobody fills the <title> Role from then on. <name>'s Role card, Memory and chats are kept, unused and readable, and you can hire <name> back." and "Tasks that still need <title> for a Stage are paused, each with a Decision to resume it once someone fills the Role, or to drop it. A Stage <name> is working on finishes its current turn first, as with Pause; to end it now, Stop the Task."
- Button: **Let <name> go** (danger). Toast: "<name> was let go."

## States

- A person that isn't found: an empty state with the service's message (404) and the link **Back to People**; any other error: "The person can't be shown." with the message and the same link.
- The page and each tab draw nothing until their data is read.
- People shows a danger alert with the service's message when the list fails.
- Tabs and tiles follow the window's width: the grid and the two-column tabs reflow in `people.css`.

## Domain facts

- Roles, the Caretaker, presets, the Role card, limits, memory, Avatar: [2.2](../2.2-people.md).
- Authority, its settings and the Hard switches: [2.2](../2.2-people.md#authority-and-hard-switches) and [6 Authority](../6-permissions-and-safety.md#authority); each preset's defaults in [6 Authority by role](../6-permissions-and-safety.md#authority-by-role).
- Duties and who holds one: [2.2](../2.2-people.md#duties-on-screen), set in [settings.md](settings.md#duties).
- Setting up with nobody hired: [2.2](../2.2-people.md#setting-up-an-office-with-nobody-hired).
- Task states: [2.1.3](../2.1.3-tasks.md#task-states).
- Skills: [2.6](../2.6-skills.md).
