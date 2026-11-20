# Archived tab

Covers: the Archived tab of Work, archived Tasks (their Kind and Drop reason), archived Initiatives (search, state filter, months, pages), Restore, the Archived badge, the Archive period hint.

## Where it is

- Route: `/work/archived`, the last tab of the Work page ([work-board.md](work-board.md)); its label is **Archived**, with no count.
- `?kind=initiatives` shows the archived Initiatives; without it the archived Tasks show.
- The Initiatives archive keeps its own search, state filter and page in the address: `query`, `state` (`done` or `dropped`) and `page` (from 2), each left out at its default.
- The Project filter narrows both lists ([shell.md](shell.md)).

## Layout

- A bar: the kind switch and the Archive period hint.
- Below it, the archived Tasks, or the archived Initiatives with their filter bar, table, pages and note.

## Kind switch

- A segmented control in a group named "What is archived": **Tasks**, **Initiatives**.
- Pressing **Initiatives** adds `?kind=initiatives`; pressing **Tasks** drops it and the Initiatives' search, filter and page.
- Hint beside it, once the Archive period is read: "Done and Dropped ones leave the board <n> day(s) after they ended, or by Archive."

## Archived Tasks

- A table of the archived Tasks the Project filter shows, the one archived last on top.
- Columns: **Task** (its Kind mark, [work-board.md](work-board.md#marks), and its title, linking to the Task page, [task-page.md](task-page.md)), **Project** (chip), **State** (its state badge), **Archived** (the day), and **Restore** at the right.
- A Dropped Task's State cell shows its Drop reason under the badge, muted: "Won't fix", "Can't reproduce", the Other words, or "Duplicate of <Task>" ([2.1.3](../2.1.3-tasks.md#drop-reason)); none with no reason.
- The note "<n> more archived Tasks in other Projects" with **Show all projects** counts those the filter hides.
- Empty: "No archived Tasks. Archive a Done or Dropped Task from its More menu."

## Archived Initiatives

### Filter bar

- A search landmark named "Filter the archived Initiatives".
- The search box: label "Search archived Initiatives", placeholder "Search archived Initiatives and their outcomes".
- A group named "State": the chips **All**, **Done**, **Dropped**, each with its count (thousands separated); the pressed chip is the filter.
- **Clear** (ghost) while a search or state is set.
- Changing the search or state returns to page 1 and replaces the address entry.

### Table

- Columns: **Initiative** (its name linking to the Initiative page, [initiative-page.md](initiative-page.md); under it its Projects and its final count of Tasks), **State** (badge with a dot, Done or Dropped), **Ended** (the day, "—" when none) and **Restore** at the right.
- A line per month the Initiative ended in sits above its run, "November 2026"; "Ended before its end was kept" where nothing dates the end.
- The one that ended last is on top.
- 25 to a page, read a page at a time from the service.
- The note "<n> more archived Initiatives in other Projects" with **Show all projects** counts those the filter hides.

### Pages

- A pager shows from the second page on, with the total and the page size.
- A Restore that empties the last page shows the one before it.

### Note

- Under the table, with an info icon: "The one that ended last on top, by month. Restore puts an Initiative back on the board, in Done or Dropped, for another Archive period; its page and Threads stay readable while it is archived."

### Empty

- With a search: "No archived Initiative matches “<query>”."
- With archived Initiatives but none matching: "None matches the filters."
- With the Project filter narrowing and none in it: "None in the Projects shown."
- Otherwise: "No archived Initiatives. A Done or Dropped Initiative comes here <n> day(s) after it ended, or by Archive in its card's More menu." ("once its Archive period has passed" until the period is read).

## Restore

- **Restore** (archive-restore icon, secondary, small) on each row; hover "Return it to the board in the state it had"; label "Restore <title or name>".
- One click, no confirmation: the Task or Initiative is back on the board in the state it had.
- Toasts: "<title> is back on the board." and, on archiving, "<title> is archived." (an Initiative by its name); a refusal shows as a toast with the reason.
- The Task page and the Initiative page show the same **Restore** while the record is archived.

## Archived badge

- A neutral badge with an archive icon, "Archived 25 Oct", beside the state on an archived Task's page and Initiative's page; nothing on one on the board.

## States

- Loading: the list shows nothing until it is read.
- Error: a danger alert with the error's message.
- Empty: as above for each kind.
- Narrow window: the tables wrap their wrapping columns (Task, Initiative).

## Domain facts

- [Task states](../2.1.3-tasks.md#task-states).
- [Initiatives](../2.1.4-initiatives.md).
- [Work](../2.1-work.md): [Defaults](../2.1-work.md#defaults) (the Archive period).
