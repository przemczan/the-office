# 50 · Office instructions

Status: in progress

## Goal

The user writes one text in Settings, for general guidelines, and every person's session gets it with their Role's instructions, on every engine. A Skill can't do this: on the user's Office only 23 of the 60 sessions that mentioned the `global-instructions` Skill opened it. The Office Manager can draft a change to the text as a Proposal the user applies.

## Definition of Done

- [x] Every session gets the Office instructions after who the person is and before their Role's instructions: a chat, the Caretaker's chat, a Task or Initiative Thread, a Consultation and an Agent Stage. Check: `session-instructions.test.ts`, and a service test of each of the two session starts (`thread-runner.ts`, `stage-threads.ts`).
- [x] Left empty, they add nothing, not even the heading. Check: `session-instructions.test.ts`.
- [x] The session is told that its Role's instructions and the Project's `CLAUDE.md` win where they disagree. Check: `session-instructions.test.ts`.
- [x] A change reaches new sessions only: a session records the version it started with and a resume runs with that version. A session from before this task resumes with none. Check: a service test of each session start, resuming across a change.
- [x] Settings › Office instructions shows the text, saves a change and says who gets it and when. Saving the same text makes no new version. Check: a service test of the route; a web test; an e2e test that saves a text and reads it after a reload.
- [ ] The Office Manager drafts a change with `propose_office_setting`; the card shows the whole new text, and applying it saves a version. A text changed since the draft is refused with the reason, so an edit in Settings is never overwritten. Check: service tests of the Proposal; a web test of the card.
- [ ] Each engine gets the text. Check: a test on the scripted engine adapter and one on the OpenAI-compatible API engine's fake server; the Test Project check of the last step for Claude Code.
- [ ] A live session follows the text. Check: on [the Test Project](test-project.md), with the cheapest model, a chat and an Agent Stage each obey a line that only the Office instructions hold.
- [ ] The `global-instructions` Skill's text, without its LSP lines (sessions have no LSP tool), is in the Office instructions of the running Office, and the Skill is gone. Check: the user's go-ahead, then Settings and the skill library there.

## Read first

- [Spec 2.2](../spec/2.2-people.md), the Office instructions line.
- `apps/service/src/modules/conversations/MAP.md`.

## Leave out

- A page of past versions. The versions exist for resumes only.
- Per-Project or per-Role variants of the text; a Role's instructions and `CLAUDE.md` already are those.
- Reaching a running or resumed session.
- Any change to Skills, the Brief or how `CLAUDE.md` is loaded.

## What was settled

With the user, 2026-11-06:

- **The name** is Office instructions.
- **Most specific wins:** they are the general default; a Role's instructions and a Project's `CLAUDE.md` win, and the session is told so. The Office rules stand above all three.
- **New sessions only,** as a Role card: versioned, each session recording its version, so a resume keeps its cached prompt.
- **A Proposal:** they join the Office settings the Office Manager can draft.

Chosen while writing this file, for the user to review (spec 2.2 and 4 already name the page):

- Conversations owns them, beside the size threshold and `session-instructions.ts`: both session starts are there, so no other module changes.
- At most 20,000 characters (about 5k tokens, in every session), checked in the contract.
- A page of its own in Settings, after Office limits, at `/settings/office-instructions`. The click-through has no screen for it, so the wording and layout are new.

## Steps

- [x] 1a. Service, the store alone: a versioned table and a port in Conversations, and an application service answering the current version and a version by its number, as `RoleCards` does. Nothing uses it yet. Commit.
  Read: `people/application/role-cards.ts`, `people/adapters/postgres/roles.schema.ts`, `application/context-policy-settings.ts`, `adapters/postgres/postgres-conversations-settings.ts`.
- [x] 1b. Service, the sessions: the version recorded on the session beside `cardVersion` (a field of the Thread's stored session, `threads.schema.ts` l. 32, and of `ThreadSession`), sessions already stored holding none. `personInstructions` and its callers take the text; `thread-runner.ts` (resume about l. 398, `place.instructions(card)` l. 502) and `stage-threads.ts` (l. 264, 372, 528) pass it. A session with no Project, such as a chat, is told what wins in words that still hold. Commit.
  Read: `conversations/domain/session-instructions.ts`, `application/session-places.ts`, `domain/thread.ts`, `domain/thread-changes.ts`.
- [x] 2. Service and contract, the route: `GET`/`PUT /api/settings/office-instructions` and its contract with the 20,000-character limit; the same text makes no new version. Commit.
  Read: `adapters/http/size-threshold.controller.ts`, `packages/contracts/src/MAP.md`.
- [x] 3. Web, the page: Settings › Office instructions, its nav entry and route, and the e2e test. Commit.
  Read: `apps/web/src/surfaces/settings/MAP.md`, `office-limits/office-limits-section.tsx`, [UI rules](../spec/4.1-ui-rules.md), `apps/web/e2e/MAP.md`.
- [x] 4. Contract and web, the Proposal's card: an `office-instructions` member of the change union (`packages/contracts/src/conversations.ts` l. 321-323) with string `from` and `to`, the number members untouched; `proposal-card.tsx` shows the whole new text. The service never sends it yet, so this stays green alone. Commit.
  Read: `apps/web/src/shell/conversation/proposal-card.tsx` from l. 72, the part on `shell/conversation/` in `apps/web/src/MAP.md`.
- [ ] 5. Service, the Proposal: `"office-instructions"` joins `OFFICE_SETTINGS`; `ProposedSettingChange` takes each setting's own value type in the domain, `proposal-appliers.ts` and `propose_office_setting`. Registered as `size-threshold-proposals.ts` is, refusing a text that no longer matches `from`. Commit.
  Read: `domain/proposal.ts`, `adapters/proposals/size-threshold-proposals.ts`, `application/proposal-appliers.ts`, `adapters/office-tools/proposal-office-tools.ts`.
- [ ] 6. The check on the Test Project, then the user's go-ahead for the running Office: the Skill's text moves in and the Skill goes. Commit.
  Read: [the Test Project](test-project.md), `apps/service/docs/testing.md` on live checks.

## State

The Office instructions reach every session, and `GET`/`PUT /api/settings/office-instructions` (`OfficeInstructionsController`) reads and saves them, from Settings › Office instructions (`surfaces/settings/office-instructions/office-instructions-section.tsx`, `/settings/office-instructions`, over `officeInstructionsQuery` and `changeOfficeInstructions` in `api/conversations.ts`). The contract is `officeInstructionsSchema` (`{ officeInstructions }`, trimmed, then at most `OFFICE_INSTRUCTIONS_MAX_CHARACTERS`). `OfficeInstructions` (`application/office-instructions.ts`, a provider of the module, not exported) answers `current()`, `forResumedSession(version)` and `save(text)`, over `OfficeInstructionsRepository` and the table `office_instructions_versions`; `save` publishes `OfficeInstructionsChanged` when a new version was made, which reaches the web as `office-instructions.changed`. `personInstructions` (`domain/session-instructions.ts`) puts them after who the person is, under `## Office instructions` with a fixed lead-in, and closes them with `## Your Role's instructions`; left empty it adds neither, so a session's prompt stays as it was. Every kind of session takes a `SessionPerson` (`card`, `officeInstructions`). `ThreadRunner.moveFor` and `StageThreads.startIn`/`continueIn` read the text and record `ThreadSession.officeInstructionsVersion`. Spec 2.2, 3 and 4, the Glossary and coverage carry the user's answers of 2026-11-06.

For the user to review: the `## Your Role's instructions` heading was not in the step; without it the Role's words read as part of the section they overrule. The Proposal's card shows the text whole and scrolling in place, as a command does, not "first lines and Read it in full" as the UI rules' Long text says: a draft has nowhere else to read whole, and the user must read it before applying it.

Each engine: `session.options.instructions` on the scripted engine shows the text in both runners' tests, and `openai-compatible-api-engine.test.ts` already proves `instructions` reach the system message, so that box waits only on the Claude Code check of the last step.

Traps:

- Version 0 means none and is never stored (a check holds it): `forResumedSession(0)` answers `NO_OFFICE_INSTRUCTIONS`, any other unknown number throws `OfficeInstructionsVersionNotFound`.
- Every test file shares the table, so a test that saves a text binds `OfficeInstructionsRepositoryForTests`; the Postgres repository's test rolls back all it saves, so the table stays empty for the others. A test assembling the runners by hand provides `OfficeInstructions`.
- Only an exact `""` counts as empty, and only the contract trims: step 5's Proposal must parse its text with `officeInstructionsSchema`, or a text of spaces gives an empty section.
- The page holds only what the user typed, so its Save overwrites a text changed elsewhere meanwhile; only step 5's Proposal refuses a stale text.
- The contract's `proposedChangeSchema` has `office-instructions` (`from`, `to`, plain strings) and `ProposalCard` its own case (`ProposedOfficeInstructions`, `.proposal-text`); the domain has no such member, so nothing sends it yet. The card's number names became `OfficeLimit`, `OFFICE_LIMITS`, `ProposedLimit`, `LimitFoot`; the service's `OFFICE_SETTINGS` keeps its name.
- The card's open note already promises the refusal of a stale text, so step 5 must refuse one. `conversation-responses.ts` l. 153 maps the domain's change to the contract and needs the new case. The card is tested in `proposal-card.test.tsx`, as `message-list-kinds.test.tsx` mocks it; no e2e covers it yet (`people.e2e.ts` l. 3213 seeds the size threshold's).
- The contract's type `OfficeInstructions` shares its name with the service class; the controller imports it as `OfficeInstructionsText`.
- The repository's `update` takes a change of the current version, inside its lock; step 5's refusal of a stale `from` can go there, and must still publish `OfficeInstructionsChanged`.
- `global-instructions` is a Skill in the running Office's library, not in this repository.

## Progress

- 2026-11-06 · The file written with the user's four answers; the spec, the Glossary and coverage changed; step 1 is next.
- 2026-11-06 · step 1a: the versioned store in Conversations (`OfficeInstructions`, its repository and table), used by nothing yet; step 1b is next.
- 2026-11-06 · step 1b: every session gets the Office instructions before its Role's, a session records the version and a resume runs with it, both session starts; step 2 is next.
- 2026-11-06 · step 2: `GET`/`PUT /api/settings/office-instructions`, its contract with the 20,000-character limit, and the `office-instructions.changed` event for a new version; step 3 is next.
- 2026-11-06 · step 3: Settings › Office instructions, its nav entry, route, web test and e2e test; step 4 is next.
- 2026-11-06 · step 4: the `office-instructions` change in the contract and its Proposal's card, showing the whole new text or that they would be emptied; step 5 is next.
