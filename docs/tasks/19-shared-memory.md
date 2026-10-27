# 19 · Shared memory and the Memory tab

Status: in progress

## Goal

A person with the Shared memory capability keeps one append-only memory: small notes, written by the person's Agents with an Office tool and by the user on the Memory tab, read into each new session's Brief. The Planner has Memory on. Spec [2.2](../spec/2.2-people.md), [2.5](../spec/2.5-context-policy.md); the open question it settles is in [spec 8](../spec/8-open-questions-and-risks.md).

## Definition of Done

- [ ] Writing: an Agent whose Role has Shared memory on can call an Office tool `remember` with a note and an optional Project; The Office appends it with its date and where it came from (Thread, Task). With the capability off the tool is not offered and nothing is written. Check: a service test through the scripted engine that a note lands, carries its source, and that nothing lands with the capability off.
- [ ] Append-only: notes are never edited; two sessions writing at once both keep their notes. Check: a test of concurrent appends; no update path exists in the repository.
- [ ] Reading: a new session's Brief holds the person's notes with no Project plus those of the Task's Project (or the chat's Project), newest kept within a size cap of about 2k tokens; when older notes are left out the Brief says how many. A note reaches sessions started afterwards, not running ones. Check: `brief.test.ts` for the selection, the cap and the "N older notes left out" line.
- [ ] Capability off: the memory is kept, not read and not written; the Memory tab shows it as not in use; switching back on restores it. Check: a service test and a Playwright check on the tab.
- [ ] Memory tab on a person's page: notes newest first, grouped by Project, each with its date and source; the user adds a note and deletes a single note (confirmed); "Delete memory" removes all of them (confirmed, with the warning that it can't be undone). Check: Playwright through add, delete one, delete all.
- [ ] The Planner is hired with Memory on. Check: the preset test.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at the Memory tab and a note written in a real chat. Check: the commands; the user's word, logged.

## Read first

- [People module map](../../apps/service/src/modules/people/MAP.md) and the [People surface map](../../apps/web/src/surfaces/people/MAP.md) (`role-card-labels.ts`: `SHARED_MEMORY_OFF`, `CAPABILITIES`).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md): `briefs.ts`, `brief.ts`, `decision-office-tools.ts` as the pattern for a module's Office tools.
- [Engine module map](../../apps/service/src/modules/engine/MAP.md): `OfficeToolRegistry`.

Leave out: Consultants and mentions (task 20); the Office Manager's use of memory (task 21); searching memory (task 23); compacting or summarising notes with a model (no model call builds a Brief).

## Steps

- [x] 1. The memory in the People module: a `memory_notes` table (person, Project or none, text, date, source), a domain type with an append and no update, the application service (append, list for a Brief, delete one, delete all), events, routes and contracts. Commit.
  Read: People module map; how Role cards are stored and how the capability reaches the service (`apps/service/src/modules/people/`, by symbol); [module template](../../apps/service/docs/module-template.md) for a new kind of file.
- [x] 2. The `remember` Office tool, offered only while Shared memory is on, with the session's Thread and Task as the source. Commit.
  Read: `decision-office-tools.ts`, `people-office-tools.ts` and `OfficeToolRegistry`, by range; `CHAT_OFFICE_TOOLS` in `session-instructions.ts`.
- [x] 3. Reading into the Brief: the selection by Project, the cap, the "N older notes left out" line; the Planner's Memory on. Commit.
  Read: `briefs.ts` and `brief.ts` (`newChatThreadBrief`, `freshChatThreadBrief`, `taskThreadBrief`), by range; the Planner preset.
- [x] 4. The Memory tab: notes by Project, add a note, delete one, delete all, the not-in-use state. Commit.
  Read: the People surface map; the person's page tabs by grep; the click-through's Memory tab in `.scratch/the-office/prototypes/app/` by grep.
- [ ] 5. The user looks at the tab and a note written in a real chat; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check; [test-project.md](test-project.md).

## State

- Settled with the user (2026-10-27), the open question "the form of shared memory": notes are written by Agents through an Office tool `remember` (not extracted from handover notes); the user reads, adds and deletes single notes on the Memory tab but never edits one, which keeps the memory append-only; a Brief takes the notes with no Project plus those of the session's Project, newest first within a size cap, and says how many were left out.
- Memory is per person, organised per Project inside ([roles](../../.scratch/the-office/issues/05-roles.md)); a Crew Role with Shared memory on is allowed too, the capability is the same.
- Trap: tier 1's Brief rule says no model call builds a Brief, so the cap drops the oldest notes; it never summarises.
- Built (step 1): `memory_notes` (migration 0032), `domain/memory-note.ts` (`writeMemoryNote`, 600-character limit), `MemoryRepository` port with `PostgresMemoryRepository`, `MemoryService` (`read`, `write`, `remove`, `clear`; `write` is refused while Shared memory is off, deletes are not), `MemoryController` at `/roles/:key/memory` (GET, POST, DELETE one, DELETE all), one `RoleMemoryChanged` event → web event `role.memory-changed`. Glossary: Memory, Memory note. A note's `projectId` is plain text (no foreign key across modules).
- Built (step 2): `remember` (`REMEMBER_TOOL`) is registered by `conversations/adapters/office-tools/memory-office-tools.ts`, which looks the Thread up by session and writes through `MemoryService` (exported from People); `sessionOfficeTools` (`session-instructions.ts`) adds it to a chat's, a Task Thread's and a Stage's tools only when the session's card has Shared memory on. The Agent names the Project (as `list_projects` does) or none.
- Built (step 3): `selectMemory` (`brief.ts`: notes with no Project plus the session's Project, newest kept within `MEMORY_TOKENS`, `leftOut` counted) and a "Your Memory" section in the chat, fresh-chat and Task Briefs; `SessionMemory.forBrief` reads it (none while Shared memory is off). A Task's Project reaches it as `TaskThreadSetup.projectId` and `StageThreadRequest.projectId`; a chat reads the notes for all Projects only. Notes name a Project by its id (`list_projects`). The Planner preset has Shared memory on; the Role card refusal and the web's "off" text are gone.
- Built (step 4): the Memory tab (`memory-tab.tsx`, `memory-groups.ts`) at `/people/$roleKey/memory`, always shown: notes grouped by Project (name from the Projects list, the id for a gone one), add with a Project choice, delete one and delete all through confirm dialogs; while Shared memory is off it says "Not in use", keeps deletes and hides adding. The prototype only has a stub, so the layout follows the Conversations tab.
- Trap: `worktrees.test.ts` (Projects) times out now and then under the full run's load; it passes alone and on a re-run.

## Progress

- 2026-10-27 · step 0: the form of shared memory settled with the user; task file written; next is step 1.
- 2026-10-27 · step 1: the Memory in People (table, domain, service, routes, contracts, web event); next is the `remember` tool (step 2).
- 2026-10-27 · step 2: the `remember` Office tool, offered only with Shared memory on; next is reading notes into the Brief (step 3), which also lifts the card refusal.
- 2026-10-27 · step 3: notes read into chat and Task Briefs with the cap and the left-out line; the Planner hired with Memory on; the card refusal lifted; next is the Memory tab (step 4).
- 2026-10-27 · step 4: the Memory tab with add, delete one, delete all and the not-in-use state, and its Playwright check; next is the user's look, `verify:linux` and closing (step 5).
