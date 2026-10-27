# Progress log: 20 · People: hiring from scratch, letting go, editable profiles, Consultants, mentions

Moved from [20-people-tier-2.md](../20-people-tier-2.md) when the task was done. One line per commit, newest last.

- 2026-10-27 · slicing: task file written with the user's choice of one task; next, step 1.
- 2026-10-27 · step 1: hiring from scratch (`/hire`, `hireFromScratch`) and an editable permission profile, with service, controller and Playwright checks; next, step 2 (letting a person go).
- 2026-10-27 · step 2: letting a person go on the People side (`letGoAt`, Let go / Hire back, no sessions, Memory kept unused) after settling re-hiring with the user; next, step 2b (pause their Tasks behind a Decision, flags).
- 2026-10-27 · step 2b: Tasks needing a Role let go are paused behind a Decision (`StaffingHolds`); resume re-checks; flags and dialog say "let go"; next, step 3 (hold an enforced Hard switch's call).
- 2026-10-27 · step 3: Change Roles takes all four values; `HeldCalls` and the `change_role` tool hold its call behind an approval Decision, run once after "Allow once"; next, step 4 (Consultants and the Consultation sub-thread).
- 2026-10-27 · step 4: Consultants and the Consultation sub-thread (`Consultations`, `Decision.putTo`, `answer_consultation`, Consultation tab); next, step 5 (Pass on and the two-step escalation).
- 2026-10-27 · step 5: a Consultant passes an approval on to whom they name, at most two steps, then the user (`passDecisionOn`, `Decision.passedOn`, `passOn` on `answer_consultation`); next, step 6 (mentions).
- 2026-10-27 · step 6: mentions by link or `@` (record links in the contracts, `MentionedRecords`/`WorkRecords`, the composer's picker, chips, Copy link); the records brief a new session or follow the message; Initiatives move to task 22; next, step 7 (the user's look, verify:linux, close).
- 2026-10-27 · step 7: `npm run verify:linux` passed; the user looked at most of it in the running app and said it looks good, the rest to be tried on real Tasks (the tier 2 acceptance run, task 30); task closed.
