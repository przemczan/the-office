# Days tab

Covers: the Days tab of Work, the day picker, the counts line, the groups (Initiatives done, Tasks done, Pull requests merged, Failed or dropped), the Also that day line, the day's tokens, the empty day, live updates while today is shown.

## Where it is

- Route: `/work/days`, the sixth tab of the Work page ([work-board.md](work-board.md)); `?day=YYYY-MM-DD` opens any day up to today, today when left out; its label is **Days**, with no count.
- The crumb is "Days".
- Now's Since you left has **See today**, which opens it ([now.md](now.md#since-you-left)).
- It shows what The Office finished on one office day ([2.1.3 Days](../2.1.3-tasks.md#days)); archived Tasks and Initiatives are included.

## Layout

- The day picker.
- The heading of the day: "Today, so far", or the day written out, "Thursday 26 November 2026".
- The counts line.
- The note of records in other Projects.
- The groups, or the empty words.
- The Also that day line.

## Day picker

- **‹** (previous day) and **›** (next day) step one day; **Today**, **Yesterday**; and a date field for any day.
- Each choice changes `?day=`, so a day can be linked to; choosing today leaves `?day=` out, so the page stays live and moves on at midnight.
- The service says what today is (the `today` of its answer): **›** is disabled, and the date field stops, on it; **Today** and **Yesterday** count from it. The browser's date is never used.
- Before the first answer arrives, **Today**, **Yesterday** and **›** are disabled.
- A `?day=` that isn't a day opens today.

## Counts line

- Counts, joined by "·": "9 Tasks done · 7 pull requests merged · 1 Initiative done · 2 failed or dropped · 3.4M tokens".
- A group with nothing is left out; each count jumps to its group.
- Tokens: input, output and cache writes, leaving out cache reads, with the info icon of Now's line ([now.md](now.md#todays-tokens)); Office-wide whatever the Project filter shows.

## Groups

- Each is a heading with its count over compact rows, newest first, the time at the row's end.
- **Initiatives done**: the Initiative's name (link), a Project chip for each Project its Tasks are in, "N Tasks".
- **Tasks done**: the title (link), its Project chip, its Kind, and its pull request's number when it has one.
- **Pull requests merged**: "#N" (to the code host), the Task's title (link), its Project chip, and who merged it ("by you", a name, or "on GitHub").
- **Failed or dropped**: a badge, **Failed** or **Dropped**; the title (link), the Project chip; "Failed at <Stage>" for a failure, the Drop reason in words for a Dropped Task.

## Also that day

- A line "4 Ideas captured · 3 Tasks started"; each count opens a small list of those Ideas or Tasks, each a link.
- A Task started is one whose first move to In progress was that day.

## Project filter

- It narrows every group and count but the tokens.
- Note: "N more in other Projects." with **Show all projects**.

## Empty

- Today: "Nothing finished today yet."
- Another day: "Nothing was finished on Thursday 26 November 2026."
- Narrowed, with records in other Projects: "… in these Projects".
- A day with only tokens still shows the counts line.

## Live

- Only while today is shown: a Task's change of state, a pull request's end, an Initiative's change of state, an Idea captured and Now's outcomes read the day again; so does the window regaining focus, so a page left open past midnight moves to the new day.
- Another day is read once and never read again.

## Defaults

- The tab opens on today.
- The day is the service's office day; the service refuses a later day (400).
