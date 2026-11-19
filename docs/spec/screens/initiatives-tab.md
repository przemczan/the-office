# Initiatives tab

Covers: the Work page's Initiatives tab: its board of Shaping, Active and Done, its cards, Dropped fold, filters, the archive links and its states.

## Where it is

- Route `/work/initiatives`, the Initiatives tab of [the Work page](work-board.md), reached from the rail's Work item and the Work tab strip.
- The Work tab strip's "Initiatives" tab counts the Initiatives in Shaping that are not archived, in the Projects the Project filter shows.
- A card's title opens the [Initiative page](initiative-page.md) at `/work/initiatives/:id`.
- The board shows the Projects the Project filter shows; archived Initiatives have left it for the [Archived tab](archived.md).

## Layout

- The filter bar: the search box, the "Waiting on you" chip and, while a filter is set, "Clear".
- Under it, while the search matches archived Initiatives, the archived-matches line.
- Under that, the note of Initiatives on the board in other Projects.
- Three columns in the Work board's column and card styles, left to right: Shaping, Active, Done.
- Each column shows its head with a count, a hint line under it and its cards; each is always shown, with its count and why it is empty.
- At the foot of Done: the Dropped fold, then the archive link.

## Filter bar

- The search box has the label "Search Initiatives" and the placeholder "Search Initiatives and their outcomes".
- The search is matched by the service against names and outcomes, and is kept in the address as `?query=`.
- The "Waiting on you" chip (hand icon, with a count) keeps only the Initiatives with a Task waiting on the user; kept in the address as `?waiting=1`.
- The chip's count is of the Initiatives on the board that the Project filter, the search and the waiting rule all match.
- "Clear" removes both filters.
- The search box is the Work board's, shared.

## Columns

- **Shaping**: hint "With <shaper's name>, until you confirm them" (the person who shapes Initiatives; "whoever shapes Initiatives" while nobody does); newest first.
- **Active**: hint "Their Tasks are on the Work board"; newest first.
- **Done**: hint "Done and dropped in the last <N days> , then archived" (the Office's archive period; "day" for 1); holds Done Initiatives only, Dropped ones sit in the fold below; the one that ended last on top, one nothing dates last.
- An Initiative that is paused shows the "Paused" badge on its Active card.

## Shaping card

- The title (one link, stretched over the card).
- The Projects of its Tasks as chips, or "No Project yet".
- The outcome, or "Outcome not written yet."
- The foot: "Shaping with <shaper's name>" ("Shaping" while nobody shapes), then "·", then "No Task yet" or "<n> Tasks so far" ("1 Task so far").

## Active card

- The title, the small "Paused" badge while paused, and the Projects as chips.
- The outcome, or "Outcome not written yet."
- Progress: a progress bar with "<done> of <counted> Tasks done" (and " · <n> ready to start"); a Dropped Task no longer counts.
- With nothing to count, a warning line instead: "No Task yet. Add one on its page.", or, when every Task was dropped, "No Task left: every one was dropped. Add a Task or drop the Initiative on its page."
- The foot, shown only when it has something to say: a "<n> waiting on you" badge, "<n> in progress" (in progress or Paused Tasks), "<n> blocked" (not started, waiting for a Task that is not Done or Dropped) and the working mark with the people working on any of its Tasks, each once.
- The card's edge is amber while a Task of it waits on the user.

## Ended card

- Compact, for Done and Dropped; a Dropped card has the failed edge.
- The title, with a More menu "More for <name>" holding "Open" and "Archive".
- The foot: the Projects as chips, the final count ("<done> of <counted> Tasks done", or "No Task done") and when it ended ("Done 3 Nov", "Dropped 20 Oct", the state alone when nothing dates its end).
- "Archive" archives at once with no confirmation and toasts "<name> is archived.".

## Dropped fold

- Under Done's cards, a fold line "Dropped" with its count, folded at first and as this browser last left it.
- While folded, the line adds "Latest: <name>, <day>" for the one that ended last.
- Unfolded, it lists the Dropped Initiatives as ended cards.
- Left out when none is left to show.

## Archive links

- The foot of Done shows, when the Projects shown hold archived Initiatives, a link of "<n> archived Initiatives" ("1 archived Initiative") with "Open the archive", going to `/work/archived?kind=initiatives`.
- While the search is set and matches archived Initiatives too, a line under the filter bar reads "<n> archived Initiatives match “<query>” too." ("1 archived Initiative matches …") with "Search the archive", which opens the Archived tab's Initiatives with that search.

## States

- Loading: nothing is drawn until the Initiatives, the Tasks and the archive period are read.
- Error: a danger Alert with the error's message.
- No Initiative at all: "No Initiatives yet. Shape an Idea into one from Ideas."
- A column with cards hidden by filters: "None matches the filters."
- A column whose Initiatives are all in other Projects: "None in the Projects shown."
- Shaping, empty: "Nothing being shaped. Shape an Idea into an Initiative from Ideas."
- Active, empty: "Nothing Active. Confirm an Initiative in Shaping to start its Tasks."
- Done, empty: "Nothing done in the last <N days>."
- Other Projects: the shell's note "Initiative on the board" / "Initiatives on the board" counts those the filters match in Projects the Project filter hides.

## Related

- [Initiative page](initiative-page.md), [Work board](work-board.md), [Ideas](ideas.md), [Archived](archived.md), [shell](shell.md).
- [2.1 Work](../2.1-work.md): Initiative states, Pause, archiving.
