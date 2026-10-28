# 23 · Tags, search, saved views and the Project filter

Status: in progress

## Goal

The user can find and narrow work as The Office fills up: Tags on Tasks, set by the user or the Planner; a search on the Work board and a ⌘K search in the top bar across Tasks, Initiatives, Ideas, people and document Attachments; Saved views of the board's filters; and the Project filter, which narrows every surface to the Projects chosen while Office-wide numbers stay whole. Spec [2.1](../spec/2.1-work.md) (Organisation and its Defaults), [4](../spec/4-ux-direction.md) (the top bar, "Every item shows its Project mark"); ticket [07](../../.scratch/the-office/issues/07-work-model.md); coverage row §2.1, task 23, in [coverage.md](coverage.md).

## Definition of Done

- [ ] Tags: free-form Tags on a Task, which the user adds and removes on the Task page (suggesting Tags in use) and in "+ Task", and the Planner sets while planning; shown on the board card and in the Task's record words. Check: a service test of the rules and the Planner's tool through the scripted engine; Playwright adding and removing one.
- [ ] Search: the board's search narrows Tasks by their title, Plan, Definition of Done and Tags; the top bar's ⌘K search finds Tasks, Initiatives, Ideas, people and document Attachments by their text and opens the one picked. Both match the service's full-text search, by word prefixes. Check: a service test of the search; Playwright through both.
- [ ] The board's filters: search, priority, Tags (every one chosen), Initiative and Blocked, with Clear; the Tags and Initiatives offered are those in the Project filter. Check: Playwright.
- [ ] Saved views: the user saves the board's filters under a name, picks a view to apply it, and removes it; stored by The Office; a view never holds the Project filter. Check: a service test of the routes; Playwright saving, applying and removing one.
- [ ] The Project filter: the top bar's choice of All projects or any Projects (never none), remembered per browser, with Projects added later shown under All projects. It narrows Now (Needs you, Running, Since you left), the status strip's "need you", the Work board, Ideas, Initiatives, People's Work tab, the Projects list and the ⌘K search, each saying how many more are in other Projects with "Show all projects". It never narrows the rail badge, the 5-hour window, desks, tokens, the fire alarm, Settings, the Office Manager's Office status or Notifications. A record with no Project is always shown; one spanning Projects is shown if any of them is. Check: web unit tests of the rules; Playwright narrowing and widening.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at Tags, both searches, a Saved view and the Project filter in the running app. Check: the commands; the user's word, logged.

## Read first

- [Work module map](../../apps/service/src/modules/work/MAP.md) (Tasks, Attachments, the Planner's Office tools in `planning-office-tools.ts`, `record-words.ts`) and the [Work surface map](../../apps/web/src/surfaces/work/MAP.md).
- The [web map](../../apps/web/src/MAP.md) for the shell (`top-bar.tsx`, `status-strip.tsx`, `rail.tsx`).
- The click-through's `work.js` (`filterBar`, `matches`, `savedViews`, the `view-save` dialog) and `core.js` (`projectPicker`, `inScope`, `needsYouCount`), by grep.

Leave out: archive and "Show archived" (tier 3; the board keeps showing Done and Dropped as now); Tags on Ideas and Initiatives (the user chose Tasks only); the click-through's seeded "Bugs" view (demo data, not a default); phone views (task 28); the kinds × channels grid and anything the Project filter would do to Notifications (task 27: it never silences them, `settings.js:161`).

## Steps

- [ ] 1. Tags, the service side: a Task's Tags (trimmed, lower-cased, unique on the Task), `PUT /tasks/:id/tags`, Tags in use for suggestions, Tags in `POST /tasks`, a `TaskTagsChanged` event and its WebSocket event, Tags in the record words, and the Planner's `write_tags` Office tool. Commit.
  Read: `work.schema.ts` (`tasks`), `task-service.ts`, `tasks.controller.ts`, `work-web-events.ts`, `planning-office-tools.ts`; contracts' `work.ts`.
- [ ] 2. Tags, the web: the Task page's Tags (add with suggestions, remove), Tags in "+ Task", Tags on the board card. Commit.
  Read: `task-record.tsx`, `new-task-dialog.tsx`, `board.tsx`; the `ui` package's input and chip components.
- [ ] 3. Search, the service side: full-text over Tasks (title, Plan, Definition of Done, Tags), Ideas (title, notes), Initiatives (name, outcome) and document Attachments (name and text, the text stored when added and kept when it moves; those already added filled once); the `simple` configuration, each word a prefix; the board's Tasks by a query, and `GET /search` grouped by kind with each record's Projects. Commit.
  Read: `attachment-service.ts`, `filesystem-attachment-files.ts`, the repositories in `adapters/postgres/`; [testing](../../apps/service/docs/testing.md) for a migration test.
- [ ] 4. The board's filters: the filter bar (search, priority, Tags, Initiative, Blocked, Clear), kept in the URL. Commit.
  Read: click-through `work.js` `filterBar` and `matches`; `work-page.tsx`, `board.tsx`.
- [ ] 5. Saved views: their table, routes and events in Work; the "Views" row with "Save view…" and remove. Commit.
  Read: click-through `work.js` (`work-view`, `view-save`); the module template on adding a table.
- [ ] 6a. The Project filter, the shell and Work: the top bar's picker (All projects, a Project on or off, "only"), remembered per browser, the shared scope rules, and Work's board, Ideas, Initiatives and filter bar narrowed with the "more in other Projects" note. Commit.
  Read: click-through `core.js` `projectPicker` and `inScope`; `top-bar.tsx`; the Projects query in `api/`.
- [ ] 6b. The Project filter elsewhere: Now (Needs you, Running, Since you left), the status strip's "need you" with "+N in other Projects", People's Work tab and its counts, the Projects list. Commit.
  Read: click-through `now.js` (`elsewhere`), `people.js` (the Work tab), `projects.js`; the Now, People and Projects surface maps.
- [ ] 7. The ⌘K search: the top bar's box, results by kind with Project marks, people matched in the web from those hired, keyboard choice, opening the pick, narrowed by the Project filter with its note. Commit.
  Read: `top-bar.tsx`, `record-mention.tsx` (links to each record), `use-hired.ts`.
- [ ] 8. The user looks at Tags, both searches, a Saved view and the Project filter; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- Not started: no code yet. The step 0 commit wrote this file, the glossary's Tag, Saved view and Project filter, and spec 2.1's Defaults for them.
- Decided with the user (2026-10-28), in spec 2.1's Defaults: both searches (the board's over Tasks, ⌘K over Tasks, Initiatives, Ideas, people and document Attachments); Tags on Tasks only, set by the user and the Planner; Saved views stored by The Office, the Project filter per browser; ⌘K follows the Project filter with a note; the three glossary terms as worded.
- Decided here: one matcher, the service's full-text search, so a Saved view's search means the same everywhere. Work owns the search route (every record searched but people is Work's); people are matched in the web from those hired, so no new port.
- Traps: a document Attachment's text is on disk (`filesystem-attachment-files.ts`), not in `attachments`; the search needs it stored when added. Glossary: "tag" stays avoided for a Mention.

## Progress

- 2026-10-28 · step 0: wrote the task file, the glossary's three terms and spec 2.1's Defaults with the user's answers; next is step 1, Tags on the service side.
