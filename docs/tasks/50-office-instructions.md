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
- [x] The Office Manager drafts a change with `propose_office_setting`; the card shows the whole new text, and applying it saves a version. A text changed since the draft is refused with the reason, so an edit in Settings is never overwritten. Check: service tests of the Proposal; a web test of the card.
- [x] Each engine gets the text. Check: a test on the scripted engine adapter and one on the OpenAI-compatible API engine's fake server; for Claude Code, the chat and the Stage of the next box.
- [x] A live session follows the text. Check: on the running Office, with the Skill gone, a new chat and the Implement Stage of the Task closing this file each answered `beep` as the Office instructions say, a line they alone hold; the user confirmed the chat.
- [x] The `global-instructions` Skill's text is in the Office instructions of the running Office, and the Skill is gone. Check: the user's go-ahead, then Settings and the skill library there (`GET /api/skills` answered an empty list on 2026-11-07).

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
- [x] 5. Service, the Proposal: `"office-instructions"` joins `OFFICE_SETTINGS`; `ProposedSettingChange` takes each setting's own value type in the domain, `proposal-appliers.ts` and `propose_office_setting`. Registered as `size-threshold-proposals.ts` is, refusing a text that no longer matches `from`. Commit.
  Read: `domain/proposal.ts`, `adapters/proposals/size-threshold-proposals.ts`, `application/proposal-appliers.ts`, `adapters/office-tools/proposal-office-tools.ts`.
- [x] 6. The check on the running Office, with the user's go-ahead: the Skill's text moves in, the Skill goes, and a chat and a Stage obey a line only the text holds. Commit.

## State

Everything but the last step is built. The Office instructions reach every session; Settings › Office instructions reads and saves them (`OfficeInstructionsController`, `surfaces/settings/office-instructions/`); a session records `ThreadSession.officeInstructionsVersion` and a resume runs with it. `OfficeInstructions` (`application/office-instructions.ts`) answers `current()`, `forResumedSession(version)`, `save(text)` and `replace(from, text)`.

The Proposal: `office-instructions` is an Office setting (`OFFICE_SETTINGS`, `OfficeSettingValues`, `ProposedSettingChange<Setting>`, `ProposedSettingValue`). `OfficeInstructionsProposals` (`adapters/proposals/`) judges it and applies it through `replace`, which refuses a text no longer `from` under the store's lock, and tells the user to ask for a new draft. `propose_office_setting` takes `value` for the numbers and `text` for this setting, trimmed in the tool. The Office Manager's preset names no setting, so its words did not change.

Settled with the user, 2026-11-06: `read_office_instructions` stays, for the Office Manager alone, and spec 2.2 names it; the card shows the whole text, and the UI rules name that exception. origin/main's 2 commits are merged; their migration kept 0091, so ours is `0092_office_instructions`.

Each engine: `session.options.instructions` on the scripted engine shows the text in both runners' tests, and `openai-compatible-api-engine.test.ts` proves `instructions` reach the system message, and Claude Code is proved by the running Office's check.

The check ran on the running Office, not the Test Project: a check there needs a `claude setup-token` token, and a Stage has no safe way to get one. The user removed the Skill and confirmed the chat; a Stage answered from its brief alone. The unrun `office-instructions-test-project-check.test.ts` is deleted. The LSP lines stay in the text: the user confirmed on 2026-11-07 that every session gets an LSP tool (Task b855d8cb). The user accepted a passing `npm run verify` on the Office's Linux host in place of `verify:linux` on 2026-11-07: in a worktree, `verify:linux` would attach to the running Office's Postgres.

Traps:

- Version 0 means none and is never stored; every test file shares the table, so a test that saves a text binds `OfficeInstructionsRepositoryForTests`.
- The page's Save overwrites a text changed elsewhere meanwhile; only a Proposal refuses a stale one.
- No e2e covers the card or this Proposal (`people.e2e.ts` l. 3213 seeds the size threshold's); service and web tests do.
- `global-instructions` is a Skill in the running Office's library, not in this repository.
- The other live checks start on a new Office data folder too, so they are signed out the same way. The logins on the workstation (`~/.claude`, the local Office's engine folder) are not to be copied: both are secret paths, and a copy's refresh can sign the original out.

## Progress

The log is in [archive/50-office-instructions.md](archive/50-office-instructions.md).
