# Progress log: 25 · Skills from a source, and update Proposals

Moved from [25-skills-from-a-source.md](../25-skills-from-a-source.md) when the task was done. One line per commit, newest last.

- 2026-10-28 · step 0: task file written with the user's answers on update review, finding updates, the pinned version and drafted skills; spec 2.6 Defaults, glossary and coverage updated; step 1 is next.
- 2026-10-28 · step 1: an installed skill's Source and pinned version (migration 0047), the `SourceFetcher` port with its git adapter, `SkillLibrary.install`; tests on local bare repositories; step 2 is next.
- 2026-10-28 · step 2: the `skill-install` Proposal, Devops' `list_source_skills` and `propose_skill_install`, its applier in Conversations calling Skills' `SkillSources` and `SkillLibrary.install`, and its card; step 3 is next.
- 2026-10-28 · step 3: Add a skill's "Install from a source" (Ask Nina, or needs the Devops Role), the source and pinned version in the row and Review, Playwright on a local bare repository; the no-tags and refused-files cases through the scripted engine; step 4 is next.
- 2026-10-28 · step 4: the platform's `Schedule` (timer, manual in tests, a short day in e2e) and Skills' daily update check marking `Skill.update` (migration 0048, `skill.update-found`/`-gone`); step 5 is next.
- 2026-10-28 · step 5: the `skill-update` Proposal (Devops' `read_skill_update` and `propose_skill_update`), `SkillUpdates.apply` keeping the state and refusing stale ones, `GET /skills/:name/update-diff` from git; a minimal card; step 6 is next.
- 2026-10-28 · step 6: the row's "→ version", the banner's updates, "Review the update" (Ask Nina, or the open Proposal with its diff and Apply), the card's diff, `GET /proposals/open`, a shared unified-diff view; Playwright applies one; step 7 is next.
- 2026-10-28 · step 6 fix: "Review the update" offers only an open update Proposal from the skill's pinned version, so a stale one never hides Ask Nina; step 7 is next.
- 2026-10-28 · step 7: the `skill` Proposal, a written skill anyone drafts in their chat with `propose_skill`, applied through `SkillLibrary.write` (off until reviewed); its card and the Write tab's line; service test and Playwright; step 8 is next.
- 2026-10-29 · step 7 fix: tests no longer fail through other files: Devops' chats in `devops-proposals.test.ts` refresh no Project bases and its onboarding refusal checks only its own Project; real-git Projects tests share a 30 s budget; a skill event test reads one clock; step 8 is next.
- 2026-10-29 · step 8 fix: a skill's description may run to the engine's 1,536 characters over several lines (the user's answer), Review flags one over 500; all 20 anthropics/skills folders pass the install checks; step 8 is next.
- 2026-10-29 · step 8: `npm run verify` and `npm run verify:linux` pass; DoD boxes 1 and 2's checks confirmed; the live install from github.com/anthropics/skills and the user's look at installing, updating and a drafted skill move to task 30 (the user's word); task 25 done.
