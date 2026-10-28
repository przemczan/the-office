# 25 · Skills from a source, and update Proposals

Status: in progress

## Goal

With Devops hired, the user asks Devops to install a skill from a source (`owner/repo` or a git URL). Devops lists the skills it holds and drafts one Proposal per skill; applying it fetches the skill at its pinned version into the library, off until reviewed. The Office checks each pinned source daily and marks a skill "Update available"; the user asks Devops, whose update Proposal shows the files' diff, and applying it is the review. Anyone in a chat can also draft a written skill as a Proposal. Spec [2.6](../spec/2.6-skills.md) (Defaults), [6](../spec/6-permissions-and-safety.md) (chats only read); ticket [23](../../.scratch/the-office/issues/23-skills.md); coverage rows §2.6, task 25, in [coverage.md](coverage.md).

## Definition of Done

- [ ] Installing from a source: Devops' tools list a source's skills and draft an install Proposal for one; its card shows the source, the skill, its pinned version and its files; applying it fetches the skill at that version into the library, source `installed`, off until reviewed; a name already in the library, a source that can't be fetched or files the library refuses are refused with a reason. Check: a service test against a local bare git repository (tags, and none) through the scripted engine.
- [ ] Install on the web: Add a skill › "Install from a source" with "Ask Nina to install it" opening her chat with the source drafted; with no Devops hired, the tab says installing needs someone with the Devops Role; the library row and Review show the source and pinned version. Check: Playwright.
- [ ] Updates found: a daily check (`git ls-remote`, no engine) marks an installed skill whose source has a newer pinned version "Update available", and clears it once applied. Check: a service test against a local bare repository with a fixed clock.
- [ ] Update Proposals: Devops drafts one with notes; its card and the row's "Review the update" show the version from and to and the files' diff; applying it saves the next version and leaves the skill on or off as it was; a stale one (pinned version moved) is refused. Check: a service test through the scripted engine; Playwright applying one.
- [ ] A skill drafted as a Proposal: someone in a chat drafts a written skill (name, description, instructions); applying it adds it off, reviewed as any new skill. Check: a service test through the scripted engine; Playwright applying one.
- [ ] `npm run verify` and `npm run verify:linux` pass; with the user's go-ahead, one skill is installed from a real public source; the user has looked at installing, updating and a drafted skill in the running app. Check: the commands; the user's word, logged.

## Read first

- [Skills module map](../../apps/service/src/modules/skills/MAP.md) (`SkillLibrary`, `skill.ts`'s `SKILL_SOURCES`, `skill-changes.ts`, `skill-files.ts`'s `skillFilesProblems`, `skill-upload.ts`'s `UPLOAD_LIMITS`, `adapters/git/`).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md) (Proposals: `proposal.ts`, `ProposalAppliers`, the `ProposalDrafts` port; `session-instructions.ts`'s `roleOfficeTools` and `chatOfficeTools`).
- The click-through's `settings.js` (`skillRow`, `skillsSection`, the `skill-add` and `skill-update` dialogs, `skill-add-confirm`), by grep.

Leave out: "Uses this week" (skill usage counts are tier 3); installing several skills in one Proposal; updates for written and uploaded skills; MCP servers; the after-tier-2 fixes in the README.

## Steps

- [x] 1. The source and the fetch: `installed` in `SKILL_SOURCES`, the skill's source (repository, folder, pinned version: tag and commit) in the database by migration; a `SourceFetcher` port with a git adapter (`git ls-remote` for the pinned version, a shallow fetch of that commit, the skill folders it holds), fetched files checked with `UPLOAD_LIMITS` and `skillFilesProblems`; `SkillLibrary.install`. Tests on local bare repositories, never the network. Commit.
  Read: `skill.ts`, `skill-changes.ts`, `skill-draft.ts`, `skill-upload.ts`, `SkillLibrary`, `skills.schema.ts`; `git-project-skill-files.ts` for how Skills runs git.
- [x] 2. The install Proposal, the service side: the `skill-install` kind of `ProposedChange` (source, folder, name, pinned version, files hash), Devops' `list_source_skills` and `propose_skill_install` tools, the applier in Skills refusing when the name is taken or the source's files no longer match. Commit.
  Read: `proposal.ts`, `ProposalDrafts`, `ProposalAppliers`; Pipelines' `PipelineOfficeTools` and `PipelineProposals` (an applier outside Conversations); `roleOfficeTools`.
- [x] 3. The install, the web: the "Install from a source" tab (Ask Nina, or needs the Devops Role), the `skill-install` card, the source and pinned version in the row and Review; Playwright. Commit.
  Read: click-through `settings.js` (`skill-add`); `surfaces/settings/skills/add-skill-dialog.tsx`, `skill-labels.ts`; `shell/ask-devops.tsx`; `shell/conversation/proposal-card.tsx`, `devops-proposal-changes.tsx`.
- [x] 4. Updates found: the daily check in Skills (a clock port, first run at boot), the skill's available version stored and announced, cleared on apply; the library response carries it. Commit.
  Read: `SkillLibrary` list; `skill-web-events.ts`; the platform map, for a clock, and its `verify:linux` rule if the platform changes.
- [ ] 5. Update Proposals, the service side: the `skill-update` kind (from and to pinned versions, notes, files hash), Devops' `propose_skill_update`, the files' diff served for the card, the applier saving the next version and keeping the state, refused when stale. Commit.
  Read: `skill-changes.ts` `saveVersion`; `skill-review.ts`; step 2's applier.
- [ ] 6. Updates, the web: "→ version" on the row, the banner, "Review the update" (Ask Nina when no Proposal yet, else the Proposal with its diff and Apply), the `skill-update` card; Playwright. Commit.
  Read: click-through `settings.js` (`skillRow`, `skillsSection`, `skill-update`); `skills-section.tsx`, `review-skill-dialog.tsx`.
- [ ] 7. A skill drafted as a Proposal: the `skill` kind (a written skill), `propose_skill` for everyone in a chat, the applier adding it off through `SkillLibrary.write`, its card; the Write tab's "Or ask someone to draft it as a Proposal"; service test and Playwright. Commit.
  Read: `chatOfficeTools`; `SkillLibrary.write`; step 2's tool and card.
- [ ] 8. With the user's go-ahead (it reaches a real public source), install one skill from it on the running app; the user looks at installing, updating and a drafted skill; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

Batches for implementing subagents: A = steps 1–3 (install), B = steps 4–6 (updates), C = step 7 with step 8's checks prepared; step 8's live install and the user's look stay with the orchestrator.

## State

- Built (steps 1–3): Skills' `domain/installed-source.ts` (`InstalledSource`, `PinnedVersion` {tag?, commit}, `pinnedVersionOf`, `compareTags`, `pinnedVersionLabel`), port `SourceFetcher` + `adapters/git/git-source-fetcher.ts`, `application/skill-sources.ts` `SkillSources` (`pinnedVersion`, `skills`, `draft`), `SkillLibrary.install`, migration 0047. Conversations: `ProposedSkillInstall` (`skill-install`) in `domain/proposal.ts`, `application/skill-install-proposals.ts` (applier), `adapters/office-tools/skill-office-tools.ts` (Devops' `list_source_skills`, `propose_skill_install`). Web: Add a skill's "Install from a source" (`add-skill-dialog.tsx`, `shell/ask-devops.tsx`), the card in `devops-proposal-changes.tsx`, the row and Review labels in `skill-labels.ts`. Tests: `source-repository.fixtures.ts` (now with `untag`), `devops-proposals.test.ts`, `people.e2e.ts`, `e2e/skill-source.ts`.
- Built (step 4): the platform's first scheduled job runner, `platform/schedule/` (`Schedule.daily(name, job)`: at once in the background, then a day after each run; `TimerSchedule` waits for a running job in `beforeApplicationShutdown`); `startTestApplication` binds a `ManualSchedule` (`runDaily`) unless a test passes its own, and `e2e.ts` a `TimerSchedule` with a two-second day so Playwright sees a check. Skills' `application/skill-updates.ts` `SkillUpdates.check` (scheduled as `SKILL_UPDATE_CHECK` in `SkillsModule.onApplicationBootstrap`): one `git ls-remote` per repository, in turn, then `noteSourceVersion` (`skill-changes.ts`) through `repository.update`; `Skill.update?: PinnedVersion` (migration 0048: `update_tag`, `update_commit`, only for installed), events `SkillUpdateFound`/`SkillUpdateGone` → web `skill.update-found`/`skill.update-gone`; contracts `skillSchema.update`. Tests: `skill-updates.test.ts`, `timer-schedule.test.ts`, domain tests.
- Decided here (step 4): an update is `isUpdateOf(now, pinned)`: another commit with a newer tag, or any other commit when the skill is pinned untagged; a deleted tag or a tag moved to another commit is no update. The check clears a noted update its Source no longer has (`SkillUpdateGone`); a Source it can't read is logged (`log` level) and keeps what was noted. Events only when what is noted changes.
- Next: step 5. Its update change must set the new pinned version, clear `update` and keep the state in one change (not `saveVersion`, which forces waiting for review); its test asserts "cleared once applied" (DoD 3's other half).
- Decided with the user (2026-10-28): applying an update is its review (the skill stays on or off; spec 2.6's Default amended); The Office finds updates daily with `git ls-remote` and only flags them, Devops drafts the update Proposal when asked; a stale update Proposal is refused; the pinned version is the newest tag, or the newest commit with no tags; a skill drafted as a Proposal is in this task.
- Decided before: one Proposal per skill; with no Devops hired, Install says installing needs someone with the Devops Role; fetching is The Office's own `git`; fetched files pass the upload rules; written and uploaded skills get no updates; the appliers and tools live in Conversations calling Skills, so Skills talks to no module; drafting checks only the name, applying re-fetches and checks the hash.
- Traps: the update check reads every installed skill in the shared test database, other files' too (it can mark another test's skill whose Source moved on); git-heavy service tests get a 30 s budget; chats only read (spec 6), so Devops never writes to the library; a skill on and for everyone reaches every session on the shared test database. Glossary terms: Source, Pinned version, Update.

## Progress

- 2026-10-28 · step 0: task file written with the user's answers on update review, finding updates, the pinned version and drafted skills; spec 2.6 Defaults, glossary and coverage updated; step 1 is next.
- 2026-10-28 · step 1: an installed skill's Source and pinned version (migration 0047), the `SourceFetcher` port with its git adapter, `SkillLibrary.install`; tests on local bare repositories; step 2 is next.
- 2026-10-28 · step 2: the `skill-install` Proposal, Devops' `list_source_skills` and `propose_skill_install`, its applier in Conversations calling Skills' `SkillSources` and `SkillLibrary.install`, and its card; step 3 is next.
- 2026-10-28 · step 3: Add a skill's "Install from a source" (Ask Nina, or needs the Devops Role), the source and pinned version in the row and Review, Playwright on a local bare repository; the no-tags and refused-files cases through the scripted engine; step 4 is next.
- 2026-10-28 · step 4: the platform's `Schedule` (timer, manual in tests, a short day in e2e) and Skills' daily update check marking `Skill.update` (migration 0048, `skill.update-found`/`-gone`); step 5 is next.
