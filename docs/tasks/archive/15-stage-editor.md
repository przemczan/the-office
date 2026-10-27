# Progress log: 15 · Edit for this Task: the Stage editor

Moved from [15-stage-editor.md](../15-stage-editor.md) when the task was done. One line per commit, newest last.

- 2026-10-27 · step 1: Stage model and effort, the Task's copy made at Start or first edit (madeAt, editedForTask), lock on started Stages, edit flags incl. staffing; next step 2, use cases, events and API.
- 2026-10-27 · step 2: PUT /tasks/:id/stages with refusals, swap sets edited Stages aside, walk re-reads Stages under a per-Task lock shared with edits, Stage model and effort reach the session, label edited for this Task; next step 3, the editor.
- 2026-10-27 · step 3: the Stage editor in the shell, fed by POST /stages/check; Edit for this Task dialog with the Pipeline swap, from the Stages block and the Task menu; Playwright edits every field and reloads; next step 4, the Test Project check.
- 2026-10-27 · step 3: a running Task's editor locks its started Stages (DoD 2 check in the Gate test), the board menu opens it, it scrolls inside its dialog, the header says edited for this Task; next step 4.
- 2026-10-27 · step 4: Test Project check passed: a Ready Task's Quick fix edited through the API with a Gate before Publish and Implement on Haiku over the Developer's Sonnet; Implement ran on Haiku, the walk waited at the Gate, library unchanged, dropped there; next close-out.
- 2026-10-27 · close: `npm run verify:linux` passed; log archived, task done. Seen in step 4's check and left for the user: a Stage's `tokens` (5,425) leave out cache reads while its run's tokens (95,968) count them, though the contract says "all four kinds".
- 2026-10-27 · follow-up (the user's answer): a Stage's and the Task's tokens now count all four kinds, cache reads too; budgets still leave cache reads out.
