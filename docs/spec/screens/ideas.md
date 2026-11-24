# Ideas tab

Covers: the Ideas tab of Work, New Ideas and their cards, shaping an Idea into a Task or an Initiative, planning it at once, editing, attaching, dropping and restoring, an Idea's History, Shaped and Dropped Ideas, a linked Idea.

## Where it is

- Route: `/work/ideas`, the second tab of the Work page ([work-board.md](work-board.md)).
- A link to an Idea, as one mentioned in a chat, is `/work/ideas?idea=<id>`: the page scrolls to that Idea, centred, and marks it (`aria-current`, the `linked-to` outline).
- An Idea is captured with the top bar's **Idea** ([shell.md](shell.md)); this tab has no capture button.
- The tab shows a count of the new Ideas while it is above 0 ([work-board.md](work-board.md#tabs)).

## Layout

- The note of Ideas in other Projects, above the page.
- Two panels side by side: **New** (with its count) and **Shaped** (with its count).
- The Shaped panel ends with the **Dropped** fold.

## Project filter

- The page shows the Ideas whose Project the Project filter shows; an Office-wide Idea (no Project) follows the filter's own rule ([shell.md](shell.md)).
- The Idea a link opened at shows whatever the filter is.
- The note "<n> more Ideas in other Projects" with **Show all projects** counts the Ideas the filter hides.

## New panel

- Heading: lightbulb icon, **New**, count.
- One Idea card per new Idea, in the order the service lists them.
- A danger alert with the error's message shows above the cards when the Ideas can't be read.
- Empty: `No new Ideas. Capture one with "Idea" in the top bar.`

### Idea card

- The card is an article labelled by the Idea's title.
- Head: lightbulb icon, the title, and the **More** menu (label "More for <title>").
- Under it: the Project chip, then "· <name> captured it · <day and clock>". The name is "You" for the signed-in user ([shell.md](shell.md)).
- Under that, for an Idea found while working on a Task: "Found while working on <Task>", the Task's title with its icon linking to its page, or "a Task no longer readable" once it can't be read ([2.1.3](../2.1.3-tasks.md#found-while-working-on)).
- The notes, when there are any.
- The Idea's Attachments as a gallery ([2.1.2](../2.1.2-ideas-and-attachments.md)).
- A row of actions, as many as fit one line; the More menu lists every one.
- Last, a fold **History** (history icon), folded; the History is read only once it is unfolded ([History](#history)).

### History

- One row per entry, oldest first: "Created in Backlog by …", "Moved from Ready to Planning by …", "Title edited by …", each with its day and clock.
- Who reads as [2.1.3 History](../2.1.3-tasks.md#history) names them: "the user Ann Lee", "the person in the Role planner".
- Empty: "Nothing has changed yet."; a failed read shows a danger alert "The History wasn't read" with the service's message.
- Rules: [2.1.3](../2.1.3-tasks.md#history).

### Idea actions

- Each is coloured by its tone, in the buttons and in the More menu ([Action tones](../4.1-ui-rules.md#action-tones)).
- **Shape into a Task** (list-checks icon): makes a Feature Task in Backlog in the Idea's Project; toast "<title> is a Task in Backlog."
  - It is a split button: its arrow, "Shape into a Task of another Kind", offers **Shape into a Feature Task**, **Shape into a Bug Task** and **Shape into a Chore Task**, each with its Kind's glyph ([2.1.2](../2.1.2-ideas-and-attachments.md#idea)).
  - Shaping a Bug from an Idea with no notes gives the Task the Bug outline as its Description ([shell.md](shell.md#create)); an Idea with notes keeps its notes, whatever the Kind.
- **Plan as a Task with <name>** (map icon), "whoever holds Plans" when nobody holds it; offered only while someone holds Plans. It makes the Task and sends it to Planning at once; toast "<title> is in Planning: message <name> to start, or write the Plan yourself." and the Task page opens ([task-page.md](task-page.md)).
- **Shape into an Initiative with <name>** (flag icon), "Shape into an Initiative" when nobody holds shaping; makes an Initiative in Shaping and opens its page ([initiative-page.md](initiative-page.md)).
- A refusal shows as a toast with the service's reason.
- An action that is pending can't be chosen again.

### Which Project is the Task in?

- A window that opens when the Idea is Office-wide and **Shape into a Task** or **Plan as a Task** is pressed: "<Idea> is Office-wide. A Task belongs to one Project."
- A choice of Project, one radio per Project (the first chosen), and the confirming button named as the action that opened it.
- For Shape into a Task, a **Kind** row as in New Task, on the Kind chosen from the split button (Feature for its main part).
- The alert "The Idea can't be shaped" shows the service's reason.

### More menu

- The actions above, then a divider.
- **Edit…**: the window "Edit the Idea" with **Idea** (placeholder "Show battery level on the device list"), **Notes** (hint "Optional.", three rows) and **Where** (Office-wide or one Project), the button **Save**; toast "Idea saved: <title>." The alert "The Idea can't be saved yet" shows a refusal. Closing with changes asks first.
- **Attach…**: adds an Attachment ([2.1.2](../2.1.2-ideas-and-attachments.md)).
- **Copy link**: copies the Idea's link ([shell.md](shell.md)).
- A divider, then **Drop** (danger): toast "Idea dropped: <title>."; the Idea moves to Dropped.

## Shaped panel

- Heading: check icon, **Shaped**, count.
- A row per shaped Idea: its title, its Project chip, and "· became <link>" to the Task (list-checks icon, its title) or to the Initiative (flag icon, its name); the day it was captured at the end.
- A row has no actions.
- Empty: "None yet".

## Dropped fold

- A fold at the end of the Shaped panel: archive icon, "Dropped · <count>".
- It opens by itself when the linked Idea is among them.
- A row: the title, "dropped <day>", and **Restore**.
- **Restore** puts the Idea back among the New ones; toast "<title> is back among the new Ideas."; a refusal shows as a toast.

## States

- Loading: no cards until the Ideas are read; the empty line of New shows only once they are read.
- Error: the danger alert above the cards of New.
- Shaped with no row: "None yet". Dropped with none: the fold shows "Dropped · 0".
- A shaped Idea whose Task or Initiative isn't read yet shows no "became" link.
- Narrow window: the actions that don't fit a card's row are hidden and stay in its More menu.

## Domain facts

- [Ideas and Attachments](../2.1.2-ideas-and-attachments.md).
- [Work](../2.1-work.md): [Task states](../2.1.3-tasks.md#task-states), [Defaults](../2.1-work.md#defaults).
- [Initiatives](../2.1.4-initiatives.md), [Planning and start](../2.1.5-planning-and-start.md).
