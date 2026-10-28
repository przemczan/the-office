# Progress log: 23 · Tags, search, saved views and the Project filter

Moved from [23-tags-search-views.md](../23-tags-search-views.md) when the task was done. One line per commit, newest last.

- 2026-10-28 · step 0: wrote the task file, the glossary's three terms and spec 2.1's Defaults with the user's answers; next is step 1, Tags on the service side.
- 2026-10-28 · step 1: Tags on the service side: the column and rules, `PUT /tasks/:id/tags`, Tags on new Tasks, the event, the record words and the Planner's `write_tags`; next is step 2, Tags in the web.
- 2026-10-28 · step 2: Tags in the web: the Task page's Tags, Tags in "+ Task", the board card's Tags, and an e2e through them; next is step 3, the search on the service side.
- 2026-10-28 · step 3: the search on the service side: `GET /tasks?query=`, `GET /search` by kind with Projects, documents' text kept in `attachment_texts` and filled at start; next is step 4, the board's filters.
- 2026-10-28 · step 4: the board's filter bar (search by the service, priority, Tags, Initiative, Blocked, Clear), kept in the address; next, Saved views.
- 2026-10-28 · step 5: Saved views: the table, routes and events in Work, the filters' schema in contracts, the "Views" row with "Save view…" and remove, a route test and an e2e; next is step 6a, the Project filter in the shell and Work.
- 2026-10-28 · step 6a: the Project filter: its rule in contracts, the top bar's picker kept per browser, Work's board, bar, Ideas and Initiatives narrowed with the "more in other Projects" note, unit tests and an e2e; next is step 6b, the filter in Now, the strip, People and Projects.
- 2026-10-28 · step 6b: the Project filter narrows Now's three feeds, the Needs you panel and the strip's "need you", People's Work tab and the Projects list, each with its note; needs-you items carry their Project; next is step 7, the ⌘K search.
- 2026-10-28 · step 7: the ⌘K search: `GET /search` narrowed by the Project filter before the best 50, with counts in other Projects; the top bar's combobox with people matched in the web, Project marks, keyboard choice and documents opened over the page; next, step 8, the user's look and closing the task.
- 2026-10-28 · step 8: `npm run verify` and `npm run verify:linux` passed; the user looked at the running app and said to continue; the log archived and the task done. Task 24 is next.
