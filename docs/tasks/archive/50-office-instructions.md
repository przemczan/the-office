# 50 · Office instructions: Progress

- 2026-11-06 · The file written with the user's four answers; the spec, the Glossary and coverage changed; step 1 is next.
- 2026-11-06 · step 1a: the versioned store in Conversations (`OfficeInstructions`, its repository and table), used by nothing yet; step 1b is next.
- 2026-11-06 · step 1b: every session gets the Office instructions before its Role's, a session records the version and a resume runs with it, both session starts; step 2 is next.
- 2026-11-06 · step 2: `GET`/`PUT /api/settings/office-instructions`, its contract with the 20,000-character limit, and the `office-instructions.changed` event for a new version; step 3 is next.
- 2026-11-06 · step 3: Settings › Office instructions, its nav entry, route, web test and e2e test; step 4 is next.
- 2026-11-06 · step 4: the `office-instructions` change in the contract and its Proposal's card, showing the whole new text or that they would be emptied; step 5 is next.
- 2026-11-06 · step 5: the Office Manager drafts the Office instructions with `propose_office_setting`, reads them with `read_office_instructions`, and applying refuses a text changed since the draft; step 6 is next.
- 2026-11-06 · step 6: the Test Project check written, not passed: no session ran, as its new Office data folder has no engine login; next is a `claude setup-token` token from the user, the run, then the running Office.
- 2026-11-07 · step 6: the check ran on the running Office (a chat and a Stage obeyed `beep`, the Skill is gone), the unrun Test Project check is deleted; next is closing the task.
