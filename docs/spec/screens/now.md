# Now

Covers: Now (the home), Needs you (the Off-board Task failed card among it) and its Waiting for you group, Running, Queue, Shaping, Since you left, today's tokens, the fire alarm panel and the all clear's review.

## Where it is

- Route: `/now`; the rail's first item ([shell.md](shell.md#rail)) and the Office mark open it.
- Page title "Now". It is the page the user opens first.
- Notifications that point at the Office's own state, a Stand-in choice or Since you left open it ([shell.md](shell.md#notification-channels)); the fire alarm control's "All clear…" and the strip's Fire alarm figure open its review.
- The Project filter in the top bar narrows its feeds ([shell.md](shell.md#project-filter)).

## Layout

- The fire alarm panel above, only while the alarm is on.
- Below it two panels side by side: left **Needs you**, with **Waiting for you** under its cards; right **Running**, then **Queue** (only while a Task is queued), **Shaping** (only while an Initiative is in Shaping), **Since you left**, and the line of today's tokens.
- Each section is a heading (icon, title, a count or words) over a feed of cards.
- Panels are named "Needs you" and "Running and since you left".
- At 1,224px of page width and under the panels are 1.2fr and 1fr; at 664px and under one column, with 14px padding.
- Nothing else is on Now.
- All of it comes from the one `now` query, which `now.changed` replaces whole, except Since you left (own per user), the queued Tasks' Usage estimates and what each Needs you card reads for itself.

## Needs you

- Heading: inbox icon, **Needs you**, the count of items in the Projects shown.
- Oldest first. Each item is a card with a left edge (Decision or Gate) and is answered in place.
- A **Decision** on a Task: the Task's title (link to its page) and Project chip above the Decision card, with when it was asked in place of where; the card is answered here ([decision-card.md](decision-card.md)).
- A **Decision on no Task** in an Initiative's Thread: the Initiative's name (link to `/work/initiatives/<id>?initiativeThread=<thread>&decision=<decision>`) and one Project chip per Project; the card is the same.
- An **Off-board Task failed** card, in place of the Decision card, for an Off-board Task's out-of-tries Decision once it is the user's ([2.1.3](../2.1.3-tasks.md#off-board-tasks)):
  - the badge **Off-board Task failed**, the Task's title (link to its page), its Project chip and "<time> ago";
  - "<Stage> failed, and its rounds are used up." and the error, in monospace;
  - **Retry**, hover "Retry runs <Stage> again, with the failure in its Brief.", which answers the Decision with its first option and no guidance; a refusal toasts the service's words;
  - **Open the Decision**: the Task page at the Decision, for guidance, Continue with the issues or Drop.
- A **Gate**: the Task's title and Project chip over the Gate's card, which reads the Task's changes and its Stages ([task-page.md](task-page.md)).
- A **Stand-in choice**: The Office's own Decision on the Stages Paused by a used-up usage window whose context is over Settings › Engines' size; one card for all of them, its rows read from `GET /stand-in-choices` and narrowed by each Task's Project. Each row has **Switch now** and, with two or more, **Switch all now**; each run's result shows beside its row while the row is still listed.
- Counted once in the tab and the strip.
- Empty: "Nothing needs you. Enjoy it." or, while other Projects have items, "Nothing needs you in these Projects."
- The note "N more need you in other Projects" ("1 more needs you…") with **Show all projects** ([shell.md](shell.md#project-filter)).

### Waiting for you

- A group under Needs you's cards, shown only while it holds an item in the Projects shown: what waits on the user without blocking anyone ([2.4.2](../2.4.2-decisions.md#waiting-for-you)).
- Heading: **Waiting for you** and its own count of the items shown.
- Oldest first; Skill updates come last.
- Each item is a card with the message edge: a badge naming its kind, a link to where it is handled, its Project chips, and under them what else it says and since when it has waited (none for Skill updates).
- **Proposal**: "Drafted by <first name>", opening its Thread at the Proposal's card: the chat drawer for a chat's, `/tasks/<id>?taskThread=<thread>&proposal=<id>` for a Task Thread's, `/work/initiatives/<id>?initiativeThread=<thread>&proposal=<id>` for an Initiative Thread's.
- **Pull request**: the Task's title, linking to the Task's page, then "#N on GitHub" (the pull request, in a new tab) and "Checks failing", "Conflicts" or both.
- **Skill updates**: "N Skills have updates" ("1 Skill has an update"), their names under it, linking to Settings › Skills.
- **Office update**: "Version X is available" or "Commit abc1234 is available", linking to Settings › Updates.
- **Shaping reply**: "<shaper> answered", linking to `/work/initiatives/<id>?initiativeThread=<thread>`.
- An Office-wide item (Skill updates, the Office update, a chat's Proposal) shows whatever the Project filter.
- The note "N more wait for you in other Projects" ("1 more waits for you…") with **Show all projects**.
- Never counted in Needs you's heading, the strip's main Needs you count, the tab title or the favicon; the strip shows its own small count ([shell.md](shell.md#status-strip)).

## Running

- Heading: activity icon, **Running**, the desks as "N of M desks", and the action **Open Work** (`/work`).
- One card per running Task: its title (link), the **Off-board Task** badge on an Off-board Task ([2.1.3](../2.1.3-tasks.md#off-board-tasks)), its Project chip, and a badge when it isn't In progress (Paused, Waiting on you…, with how it was paused and when it resumes).
- Second line: "Starting" before a Stage exists; else the person's avatar and name (or "No Agent"), a badge with the Stage's name, and "<time> in Stage" counted from the Stage's latest run.
- Left edge: running while In progress, paused otherwise.
- Empty: "Nothing is running." or "Nothing is running in these Projects."
- Note: "N more Tasks in other Projects."

## Queue

- Shown only while a Task is queued; heading: list-ordered icon, **Queue**, the count.
- A Task is queued for Start; it starts by itself once a desk and its person are free and its caps allow it.
- One card per queued Task: a **Queued** badge, its title (link), the **Off-board Task** badge on an Off-board Task, its Project chip, then "Place N · <reasons>", then its Usage estimate line (from Work's `GET /usage-estimates`).
- Empty (only in a narrowed view): "Nothing is queued in these Projects."
- Note: "N more Tasks in other Projects."
- See [2.1.5](../2.1.5-planning-and-start.md).

## Shaping

- Shown only while an Initiative is in Shaping; heading: sparkles icon, **Shaping**, the count.
- Oldest first. One card per Initiative: a **Shaping** badge, its name (link to its page), one Project chip per Project; a second line: the person who holds Shapes Initiatives (avatar and name) or "Nobody shapes Initiatives yet", "No Tasks yet" / "1 Task" / "N Tasks", and "Shaped for 18 min" / "Shaped for 3h 10 min" / "Shaped for 1 day" / "Shaped for N days".
- An Initiative with no Tasks yet is in no Project, so the Project filter always shows it.
- Empty (narrowed): "Nothing is being shaped in these Projects."
- Note: "N more Initiatives in other Projects."
- See [2.1.4](../2.1.4-initiatives.md).

## Since you left

- Heading: moon icon, **Since you left**, and "since 22:00" (today) or "since 25 Oct, 22:00"; nothing until the user is first seen.
- One card per Task finished since the user left: an outcome badge (**Done**, **Failed** or **Paused**), its title (link), its Project chip, and the time of the outcome at the card's end.
- Left edge by outcome.
- Empty: "Nothing finished since you left." or, in a narrowed view, "Nothing finished in these Projects since you left."
- Note: "N more Tasks in other Projects."
- The status strip's "done since you left" reads the same list.

## Today's tokens

- A line at the foot of the right panel: the count of tokens today (input, output and cache writes, with the info icon giving each kind and its cost) followed by each engine's "N% of <engine>'s 5-hour window".
- Office-wide whatever the Project filter shows; desks and tokens never narrow.

## Fire alarm panel

- Shown above the panels while the alarm is on; Office-wide whatever the Project filter shows. A section named "Fire alarm".
- Stopping: siren icon, "Stopping all automated work", text "Every Stage stops at its next safe point, between tool calls; anything still running after 60 seconds is stopped hard. Pushes already running finish."; the button **All clear…** is disabled.
- On ASAP: "Alarm on since 14:02", text "Nothing automated runs: no Stage, no Task starts, no consultation. Chats stay open; Agents answer but run no tools unless you let them in a thread."; the button **All clear…** (danger).
- On after the current Stages: "Alarm on since 14:02 · stopping after the current Stages", text "Running Stages finish, then their Tasks pause; no new Stage or Task starts. Chats work as usual."; never Stopping.
- On after the current Tasks: "Alarm on since 14:02 · finishing the current Tasks", text "Started Tasks finish; no new Task starts. Chats work as usual."; never Stopping.
- The list of Tasks the alarm paused: Project chip, title (link), "· <Stage> · <person>", and a badge: "Stopping at the next safe point" while it has no resume plan yet, **Stopped** after, **Push finished** where its push finished during the alarm.
- Under a softer way, then the started Tasks it lets go on (In progress or Waiting on you), with the badge "Stopping after its Stage" or "Finishing its Task".
- Empty: "Nothing was running."
- The foot under ASAP: "Tasks waiting on you keep waiting; answering one doesn't restart it until the all clear."; after the current Stages: "Answering a Task waiting on you lets its Stage finish; then it pauses until the all clear."; after the current Tasks, none.
- **All clear…** (here or in the top bar or the strip) turns the panel into the review.

### The all clear's review

- Section named "Before the all clear", heading "Before the all clear", text "Each Task continues from where it stopped, through the Context policy. Hold or drop any of them first."; shown while the alarm is no longer stopping.
- One row per paused Task: Project chip, title, Stage and person, then how it goes on: a pill (**Continues**, **Fresh**, **Script**) and a line.
- Lines: "Continues the same session · cache still warm · 41k read from cache"; "Continues the same session · cache expired · re-caches 41k"; "Starts fresh · brief and Handover note ~3k"; "Runs the <Stage> script again · no model call"; "Its push finished during the alarm; Publish records the result · no model call"; "Waits on you again · no model call"; "Goes on with <Stage> · no model call".
- Each row has a group named "What happens to <title>": **Resume** (the default), **Hold**, **Drop**, joined, each a little taller than a control with room on either side of its word; a row not resuming is dimmed.
- Empty: "Nothing to resume."
- The foot: "N to resume · about 41k tokens before work continues" plus " · N held or dropped"; the buttons **Keep the alarm on** (secondary) and **All clear: resume N** (or **All clear** when none resume), with room between the summary and each button.
- A refusal shows "The all clear wasn't given". On success the toast "All clear. N Tasks resume." ("1 Task resumes") and the review closes.
- See [2.8](../2.8-fire-alarm.md#all-clear).

## States

- Loading: each section shows its heading and an empty feed until its data is read.
- Empty: each feed's words above; a narrowed view says "in these Projects".
- Alarm on: the panel above; under ASAP Desks in use reads 0 in the strip.
- Service out of reach: the strip's slot says so ([shell.md](shell.md#office-messages-slot)).
- Narrow window: see Layout.

## Domain facts

- Needs you, Decisions, Gates: [2.4.2](../2.4.2-decisions.md#where-a-decision-shows), [2.3.3](../2.3.3-gates-and-checks.md).
- Waiting for you: [2.4.2](../2.4.2-decisions.md#waiting-for-you).
- Task states and outcomes: [2.1.3](../2.1.3-tasks.md#task-states).
- Queue for Start: [2.1.5](../2.1.5-planning-and-start.md).
- Fire alarm: [2.8](../2.8-fire-alarm.md); Context policy's moves: [2.5](../2.5-context-policy.md).
- Stand-in choice: [5.4.6](../5.4.6-stand-in-engines-and-usage-windows.md).
