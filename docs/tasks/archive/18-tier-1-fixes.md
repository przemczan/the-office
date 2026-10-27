# Progress log: 18 · Tier 1 fixes: the acceptance run's problems

Moved from [18-tier-1-fixes.md](../18-tier-1-fixes.md) when the task was done. One line per commit, newest last.

- 2026-10-27 · slicing: tier 2 ordered into tasks 18–30 with the user, this task's file written; next, step 1, Markdown.
- 2026-10-27 · step 1: Markdown in messages, Handover notes, the Brief, Decisions and Stage rows through one sanitised `MarkdownText`; next, step 2, message fields and the working indicator.
- 2026-10-27 · step 2: one message field for the Composer, Decision answers and Gate feedback (Enter sends, Shift+Enter breaks, busy Enter explains); the working line made visible; next, step 3, the board and "+ Task".
- 2026-10-27 · replanned with the user: only the cheap fixes stay here; 2, 5, 8 and 13 move to the fixes after tier 2, and the user's look becomes step 6. Next, step 3.
- 2026-10-27 · replanned with the user: only fixes that get harder after tier 2 stay (5, 6); 1, 2, 3, 7, 8, 9, 10 and 13 wait. Next, step 3, Before Ready.
- 2026-10-27 · step 3: the "Before Ready" checklist from one list of Ready's conditions, Mark Ready disabled until met, the Ready words; next, step 4, the user's look and closing.
- 2026-10-27 · found by the user: a Done Task's Threads are read-only with a plain reason, and the service refuses a session on them; next, step 4, the user's look and closing.
- 2026-10-27 · step 4: the user looked at each fix in the running app and approved; a dropped Task's Threads made read-only as a Done one's, after the user found it could still be talked to; `npm run verify` and `npm run verify:linux` pass; task done. Next, task 19.
