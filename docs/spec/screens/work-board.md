# Work page and board

Covers: the Work page and its tabs, the Task board (filters, the Kind filter, Import issues, Saved views, search, columns, Group by Initiative, Initiative blocks, cards and their marks, dragging), Waiting on you and Needs you, Start Ready Tasks, the queue for Start.

## Where it is

- Route: `/work` (the Tasks tab, the board).
- Open it from the Work item in the rail ([shell.md](shell.md)).
- The page title is "Work"; its crumb is the open tab's: "Tasks by state", "Ideas", "Initiatives", "Pull requests", "CI runs", "Archived".
- Its tabs are the routes `/work`, `/work/ideas`, `/work/initiatives`, `/work/pull-requests`, `/work/ci` and `/work/archived`.
- The Project filter in the top bar narrows every Work tab ([shell.md](shell.md)).
- Work has no "+ Task" button: a Task is made from the top bar's Create ([shell.md](shell.md)), or from GitHub issues with the filter bar's **Import issues…**.

## Layout

- The tab strip, at the top.
- The tab's page below it: on `/work`, the filter bar, the note of Tasks in other Projects, any error, the board and a one-line note about dragging.
- The strip also shows at the top of the Task page (Tasks chosen) and the Initiative page (Initiatives chosen), whose routes sit beside `/work`; pressing a tab there goes to its list.

## Tabs

- In order: **Tasks**, **Ideas**, **Initiatives**, **Pull requests**, **CI**, **Archived**.
- A tab shows a count while it is above 0; **CI** and **Archived** have none.
- Tasks: the Tasks on the board that are neither Done nor Dropped, so never an Off-board Task ([Board columns](#board-columns)).
- Ideas: the new Ideas ([ideas.md](ideas.md)).
- Initiatives: the Initiatives in Shaping that aren't archived ([initiatives-tab.md](initiatives-tab.md)).
- Pull requests: the open pull requests ([pull-requests.md](pull-requests.md)).
- Every count covers only the Projects the Project filter shows, and the board's own filters never narrow it.
- The counts read the same lists as the boards, so their events keep them current.
- Pressing a tab goes to its route.

## Filter bar

- It is a search landmark named "Filter the board".
- First row, left to right: the search box, the Priority chips, the Kind chips, the Initiative select, the **Blocked** chip, **Clear** (only while a filter is set), **Import issues…** and, at the end, the Layout group.
- Search box: label "Search Tasks", placeholder "Search Tasks, Plans and Definitions of Done". The service matches the words, as the top bar's search does. A blank search is the same as none.
- Priority chips: **High**, **Normal**, **Low**, each with its priority glyph; pressing the chip on turns it off, so one priority at most is set.
- Kind chips, a group named "Kind": **Feature**, **Bug**, **Chore**, each with its Kind's glyph; one at most is on, and pressing the one on turns it off ([2.1.6](../2.1.6-board-and-search.md#the-kind-filter)).
- Initiative select: named "Initiative", label hidden, placeholder "Any Initiative", "No Initiative matches" when typing finds none, clear button "Clear the Initiative filter". Typed in, it lists at most 10 Initiatives, best matches first. It offers the Initiatives in the Projects the Project filter shows, and the chosen one wherever it is.
- **Blocked** chip (lock icon): keeps the Tasks that still have a blocker.
- **Clear** drops every filter at once. It keeps Group by Initiative.
- **Import issues…** (secondary, github icon): opens the Import issues window ([project-page.md](project-page.md#import-issues-window)) on the first Project on GitHub the Project filter shows; its Project picker changes it. It and its picker count only the Projects on GitHub with GitHub issues switched on ([Feature switches](../2.1.1-projects.md#feature-switches)); it shows only while the filter shows one.
- The filters are kept in the address (`query`, `priority`, `kind`, `initiative`, `blocked`), so a reload or a link reopens the same board; a filter left empty isn't in the address.
- Changing a filter replaces the address entry rather than adding one, and keeps whatever opens over the page.
- The filters narrow the cards, the column counts, and the Initiatives, Ideas and counts shown elsewhere on the bar only as stated here: blockers and drag placement still read every Task.

## Saved views

- A second row, "Views", shows while at least one view exists or a filter is set that no view has.
- Each view is a chip with a bookmark icon and its name; it is on while the board's filters are exactly its own, so changing any filter turns it off.
- Pressing a view applies its filters; pressing the view that is on clears the filters.
- Each chip has a remove button (hover "Remove the view", label "Remove the view <name>"); a refusal shows as a toast.
- **Save view…** (bookmark-plus icon) shows while a filter is set and no view matches.
- Its window "Save the view": the field "Name" (placeholder "Firmware bugs", hint "A view saves the filters, not the Project filter: it follows the top bar like everything else."), the button **Save view**, and the alert "The view can't be saved" with the service's reason when it is refused.
- A view saves the search, priority, Kind, Initiative and Blocked filters, never Group by Initiative or the Project filter.
- A view saved before Kinds has no Kind filter, and applies as it did.

## Group by Initiative

- The **Group by Initiative** switch sits at the end of the filter bar's first row, in the Layout group.
- It lays the board out and narrows nothing.
- It is set in the address as `?group=initiative` and also remembered in this browser; an address without `group` follows what this browser last chose. It starts off.
- It stays through Clear and through Saved views.
- **Fold all** or **Unfold all** sits beside the switch while more than one group shows and the Initiative filter isn't set; it shows **Unfold all** while every group is folded.
- Grouped, the board keeps its six columns in one row, scrolling sideways, with the groups together under one row of column heads.
- The column heads (name, count, hint) show once, in a frame that sticks to the top as the page scrolls and follows the groups' sideways scroll.
- Each group's header and lines stay pinned to the visible part of the board while it scrolls sideways.
- A column head's count adds the cards shown in every group.

### Groups

- One group per Initiative with a card on the board, then **No Initiative** ("Tasks that aren't part of an Initiative").
- Active Initiatives come before those that ended (Done or Dropped); within those, the newest Initiative first.
- An Initiative in Shaping has no group: its Tasks are off the board.
- A group with no card shown (after the filters) is left out. Under the groups a line names the groups that search, Priority or Blocked left out: "No Task matches the filters in <names>, so its group is left out." (or "their groups are").
- When the filters leave no group at all, one block says "No Task on the board matches the filters. Clear them, or show all projects."
- With the Initiative filter set, only that Initiative's group shows, always open and not foldable. When it has no card to show it says why: "Its Tasks join the board once the Initiative is confirmed." (being shaped), "None of its Tasks is on the board." (all archived or dropped from the board), "Its Tasks on the board are in Projects the Project filter hides.", or "None of its Tasks on the board matches the filters."

### Group head

- Its name (muted for No Initiative), the Initiative's state badge, the Paused badge while it is paused, its Projects and a progress bar with its words (counted over every Task of the Initiative, archived and in Shaping too).
- At the end: the count ("4 on the board", or "3 of 7 shown" while a filter hides some) and the link **Open Initiative** (arrow icon, label "Open Initiative <name>") to the Initiative page ([initiative-page.md](initiative-page.md)).
- A fold button leads the head. A press anywhere on a foldable head folds it, except on a link or button in it.
- A folded group shows one line of counts, "Backlog 1 · In progress 1 · Done 2", with the empty columns left out.
- Each group's fold is remembered in this browser; a Done or Dropped Initiative's group starts folded, the others open.
- Each group has a cell per column, labelled "<column>, <group>".

## Board columns

- Six columns in a row, each a region named by its label, with the label and a count in its `h3` and a hint under it.
- **Backlog**: Tasks in Backlog. Hint "Not planned yet".
- **Planning**: Tasks in Planning. Hint "Plan and Definition of Done with <the holder of Plans>", or "whoever holds Plans" when nobody holds it.
- **Ready**: Ready Tasks that aren't in the queue for Start. Hint "Starting is your call".
- **Queued**: Ready Tasks in the queue, in queue place order. Hint "They start by themselves when their turn comes".
- **In progress**: In progress, Waiting on you and Paused Tasks. Hint "Agents work its Pipeline".
- **Done**: Done and Dropped Tasks, the one that ended last on top (Tasks with no end after them). Hint "Done and dropped".
- Every other column keeps the service's order: priority, then manual order.
- A queued Task stays Ready; the Queued column only shows it apart.
- A Task in Shaping has no column, and an archived Task has left the board ([archived.md](archived.md)).
- An Off-board Task is never on the board: no column, card, column or tab count, or search result shows it; its Project page and Now follow it ([2.1.3](../2.1.3-tasks.md#off-board-tasks)). Publishing and Conflict resolution Tasks stay on it.
- An empty column (grouping off) shows "Nothing here".
- The column counts include only the Tasks the filters match.
- The note in the Project filter area, "<n> more Tasks in other Projects" with **Show all projects**, counts the matching Tasks the Project filter hides.

## Initiative blocks

- With Group by Initiative off, each column gathers an Initiative's cards into one block, placed where its first card falls; the cards of no Initiative stay loose in their place.
- A block is a group named by the Initiative; it is never a region or a heading, so the column stays the board's region.
- Its head: a flag icon and the Initiative's name linking to its page, the Paused badge (small) while it is paused, and a count. The count is the number of its cards in the column; in Queued it is their places ("#2 · #5"). Hover: "<n> of its Tasks in <column>", or "Place 2 in the queue" / "Places 2 and 5 in the queue".
- The name never gives up its width to the count: a count too long to sit beside it, such as many places, moves to a line below, at its right end, and wraps there.
- Hovering or focusing a block head outlines that Initiative's blocks in every column.
- In Done, a block with more than one card shows only the first, with a **Show <n> more** button that becomes **Show fewer**.
- No blocks show while the Initiative filter is set, or until the Initiatives are read: every card shows loose.
- The block's fill is one rule for every palette.

## Board cards

- A card is one link: its title opens the Task page ([task-page.md](task-page.md)); the whole card is stretched over by that link, and the menu, buttons and links on it sit above it.
- Head row: the priority glyph before the title for High and Low only (Normal shows none), the title, and the **More** menu.
- A card shows no Tags.
- The edge is coloured for a Task waiting on you, a Paused one and a Dropped one only.
- Under the title, one row of marks: the Project's mark first, then the others in this order.

### Marks

- **Kind** (right after the Project's mark, on every card): the Kind's glyph in a 20px box, sparkles for Feature, bug for Bug, wrench for Chore; only Bug is coloured (danger tone), the others muted; hover names it ("Feature", "Bug" or "Chore").
- **Waiting on you** (hand icon, warning): the state is Waiting on you, or the Task is in Planning or Paused with a Decision open.
- **Paused** (pause icon, warning): the state is Paused; its hover words follow the Task's Paused words. A Paused Task with a Decision open shows Waiting on you and Paused.
- **Dropped** (circle-x icon): the state is Dropped.
- **Blocked** (lock icon with the number of blocking Tasks): a press opens a popover "Blocked by <n> Task(s)" with "It must be Done first." or "Each must be Done first.", and a line per blocker with its Project mark, its link and its state badge. Hover: "Blocked by <n> Task(s): press for them".
- **Queued** (clock icon, info): hover "Queued: <short reasons>" or "Queued"; a press opens "Queued, place <n>" with "It starts by itself once nothing holds it." and "Waiting for:", the full reasons, the Tasks it is queued behind as links, and "And its <n> blocker(s), under the lock." The reasons beside its blockers only, as the lock holds those.
  - While only its usage holds it, the popover ends with **Start anyway** ([2.1](../2.1.5-planning-and-start.md#start-anyway-past-the-usage-caps)), asking first in the Task page's dialog; disabled, with why under it, while every engine its Stages could run on has a used-up window.
- **Planning** (map icon): a Task in Planning with no Decision open; hover is the planning note, which says when it plans in auto mode.
- **Usage estimate** (gauge icon): on each Ready card, queued ones too; hover is the estimate's words.
- **Stage** (right end): a started Task (In progress, Waiting on you or Paused) at a Stage shows its current Stage's name as a short label, cut with an ellipsis when the row is narrow; also at a Script Stage or a Gate, between runs and while a Decision is open. Hover: "Current Stage: <Stage>" while nobody works on it.
- **Working** (right end, just after the Stage): up to three avatars and "+N", a live dot, the names on hover ("Working now: <names>"; with the Task at a Stage, "Working now: <names> · <Stage>"). A person counts while one of their Threads on the Task is answering with no open Decision; none shows in Planning or in chats.
- **Plan** (right end, instead of Working): on a Backlog card while someone holds Plans and nobody works on it; an icon button "Plan", whose tooltip says "Plan: <name> makes a plan for you to confirm. Auto mode is off." or "Plan: <name> makes a plan in auto mode: the Task is marked Ready without your Confirm." The board stays open.
- A mark that only stands for words shows them on hover (on a press where there is no hover), and a press on it opens the Task.
- The lock and the clock are popovers with links; the card doesn't drag while a button in the row is pressed.
- The queue's place shows only in the clock's popover, never on the card.
- There is no Failed mark.
- The working mark never gets narrower than its live dot, avatars and "+N", and keeps the right end of the row, also when a full row wraps.
- A Done card shows no marks beyond its Project's and its Kind's.
- A Task's lock counts blockers from every Task, in any Project.

### Card More menu

- Label "More for <title>".
- First its planning actions: **Plan with <name>** while in Backlog, and **Mark Ready** where offered ([task-page.md](task-page.md)).
- For a Task that hasn't started: a "Priority" heading with **High**, **Normal**, **Low** (the current one ticked); a change toasts "<title> is now <priority> priority."
- Until the Task has ended: a "Kind" heading with **Feature**, **Bug**, **Chore** (the current one ticked); a change toasts "<title> is now a <Kind>."
- **Archive** on a Done or Dropped Task.
- Until the Task has ended: **Edit Stages for this Task** (not in Shaping), **Move to another Project…** and, after a divider, **Drop…**.

## Dragging

- A card that hasn't started can be dragged to reorder it within its column. Dropped among another priority, it takes that priority and toasts "<title> is now <priority> priority."
- A queued card doesn't drag: its order is the queue's. A started card doesn't drag.
- The board changes nothing else: a drop into the wrong column toasts "A Task changes state through its actions: Plan, Mark Ready, Start."
- With blocks, a card drops only inside its own block, and a loose card among the loose cards. The refusals are "A card moves only within its own block: the board doesn't change a Task's Initiative." and "A card with no Initiative moves only among the cards outside the blocks: the board doesn't change a Task's Initiative."
- Grouped, a card drops only within its column inside its own group, and the one column it can land in is outlined; a refusal toasts "A card moves only within its own group: the board doesn't change a Task's Initiative."
- A drop moves the card at once, and the service settles its priority; a refusal puts the card back and toasts the reason.
- The note under the board says it: "Drag a card that has not started to reorder it within its column, inside its own group | its Initiative's block; dropping it among another priority takes that priority. Queued cards keep their place in the queue." (the middle part follows the layout).

## Waiting on you and Needs you

- A card that waits on the user shows the Waiting on you mark and an amber edge.
- The Task page's **Needs you** card holds what waits: its unanswered Decisions, the Gate it waits at and a Stand-in Engine choice ([task-page.md](task-page.md), [decision-card.md](decision-card.md)). Its head counts "<n> Decision(s) · a Gate · a Stand-in Engine choice · <n> waiting on a Consultant".
- A Decision put to a Consultant isn't counted and doesn't make the card Waiting on you.
- With nothing waiting, the card says where the Task stands: "Nothing needs you right now. You'll see it here first.", "Nothing needs you: this Task is Done.", "This Task was dropped.", "Ready: start it when you want; nothing starts by itself." (Ready and not queued), or for a Task in Shaping "Waiting for its Initiative to be confirmed: it can't be planned or started until then."

## Start Ready Tasks

- **Start Ready Tasks** (play icon) is a head action of an active Initiative with at least one Ready Task ([initiative-page.md](initiative-page.md)).
- It does the normal Start on each Ready Task; an Overlap queues the Task behind the one in progress.
- A toast sums it up, "2 started, 1 queued, 1 refused", leaving out any count of 0.
- An alert under the head, "Start Ready Tasks: <that line>", shows (warning when any was refused, otherwise info) with a group each for **Started**, **Queued** (with its place and reasons) and **Refused** (with reasons), each Task linked.
- The alert lasts until closed; a reload also drops it.
- A refusal of the whole action shows as a toast.

## Queue for Start

- A Ready Task's Start joins the queue when it can't start yet: it keeps its Ready state and shows as Queued, in the Queued column, with its place.
- On the Task page the head shows "Queued" with "Place <n> · <reasons>".
- On a queued Task, **Move up** (split button; its menu "More ways to move up" holds **Move to top**) and **Take out of the queue** stand in for Start; at place 1, only **Take out of the queue**.
- Toasts: "Moved up in the queue.", "Moved to the top of the queue.", "Taken out of the queue; it stays Ready."
- Start says when it would only join the queue ([task-page.md](task-page.md)).
- A Task starts by itself once nothing holds it ([2.1](../2.1.5-planning-and-start.md#a-queue-for-start)).

## States

- Loading: the board shows no cards until the Tasks are read.
- Error: a danger alert with the Tasks' error message above the board; with Group by Initiative on, also the Initiatives' error.
- Initiatives not read yet (grouping off): every card shows loose.
- A Task whose Initiative the board hasn't read yet shows loose.
- Empty column: "Nothing here" (grouping off).
- No match for the filters: see Groups for the grouped board; ungrouped, the columns just show "Nothing here".

## Related

- [2.1 Work](../2.1-work.md): [Task states](../2.1.3-tasks.md#task-states), [Defaults](../2.1-work.md#defaults).
- [Ideas](ideas.md), [Archived](archived.md), [Pull requests](pull-requests.md), [CI runs](ci-runs.md), [the Initiatives tab](initiatives-tab.md), [the Initiative page](initiative-page.md), [the Task page](task-page.md).
- [Shell](shell.md): the Project filter and Create.
