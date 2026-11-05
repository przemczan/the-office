# 50 · Office instructions

Status: in progress

## Goal

The user writes one text in Settings, for general guidelines, and every person's session gets it with their Role's instructions, on every engine. A Skill can't do this: on the user's Office only 23 of the 60 sessions that mentioned the `global-instructions` Skill opened it. The Office Manager can draft a change to the text as a Proposal the user applies.

## Definition of Done

- [ ] Every session gets the Office instructions after who the person is and before their Role's instructions: a chat, the Caretaker's chat, a Task or Initiative Thread, a Consultation and an Agent Stage. Check: `session-instructions.test.ts`, and a service test of each of the two session starts (`thread-runner.ts`, `stage-threads.ts`).
- [ ] Left empty, they add nothing, not even the heading. Check: `session-instructions.test.ts`.
- [ ] The session is told that its Role's instructions and the Project's `CLAUDE.md` win where they disagree. Check: `session-instructions.test.ts`.
- [ ] A change reaches new sessions only: a session records the version it started with and a resume runs with that version. A session from before this task resumes with none. Check: a service test of each session start, resuming across a change.
- [ ] Settings › Office instructions shows the text, saves a change and says who gets it and when. Saving the same text makes no new version. Check: a service test of the route; a web test; an e2e test that saves a text and reads it after a reload.
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

Chosen while writing this file, for the user to review:

- Conversations owns them, beside the size threshold and `session-instructions.ts`: both session starts are there, so no other module changes.
- At most 20,000 characters (about 5k tokens, in every session), checked in the contract.
- A page of its own in Settings, after Office limits, at `/settings/office-instructions`. The click-through has no screen for it, so the wording and layout are new.

## Steps

- [ ] 1. Service, the text and the sessions. A versioned table and a port in Conversations, an application service giving a new session the current version and a resumed one its recorded version (as `RoleCards` does), the version recorded on the session beside `cardVersion`, with sessions already stored holding none. `personInstructions` and its callers take the text; `thread-runner.ts` (`place.instructions(card)`, resume at about l. 398) and `stage-threads.ts` (l. 264, 372, 528) pass it. Commit.
  Read: `conversations/domain/session-instructions.ts`, `application/session-places.ts`, `people/application/role-cards.ts`, `adapters/postgres/threads.schema.ts`, `application/context-policy-settings.ts` and `adapters/postgres/postgres-conversations-settings.ts` for the settings pattern.
- [ ] 2. Service and contract, the route: `GET`/`PUT /api/settings/office-instructions` and its contract with the 20,000-character limit; the same text makes no new version. Commit.
  Read: `adapters/http/size-threshold.controller.ts`, `packages/contracts/src/MAP.md`.
- [ ] 3. Web, the page: Settings › Office instructions, its nav entry and route, and the e2e test. Commit.
  Read: `apps/web/src/surfaces/settings/MAP.md`, `office-limits/office-limits-section.tsx`, [UI rules](../spec/4.1-ui-rules.md), `apps/web/e2e/MAP.md`.
- [ ] 4. Service, the Proposal: `"office-instructions"` joins `OFFICE_SETTINGS`, and `ProposedSettingChange` takes each setting's own value type; its `from` and `to` are numbers today, in the domain, the contract and `propose_office_setting`. Registered as `size-threshold-proposals.ts` is, refusing a text that no longer matches `from`. Commit.
  Read: `domain/proposal.ts`, `adapters/proposals/size-threshold-proposals.ts`, `application/proposal-appliers.ts`, `adapters/office-tools/proposal-office-tools.ts`.
- [ ] 5. Web, the Proposal's card: the whole new text, in the card the Office settings use. Commit.
  Read: the Proposal cards in `apps/web/src/MAP.md`, the part on `shell/conversation/`.
- [ ] 6. The check on the Test Project, then the user's go-ahead for the running Office: the Skill's text moves in and the Skill goes. Commit.
  Read: [the Test Project](test-project.md), `apps/service/docs/testing.md` on live checks.

## State

Nothing is built yet. Spec 2.2, 3 and 4, the Glossary and coverage carry the user's answers of 2026-11-06.

Traps:

- An Agent Stage's own `AGENT_STAGE_INSTRUCTIONS` is only what the person does in a Stage: its session is built in `stage-threads.ts` by `workThreadInstructions`, so the text enters there, not in `agent-stage-runner.ts`.
- `global-instructions` is a Skill in the running Office's library, not in this repository.

## Progress

- 2026-11-06 · The file written with the user's four answers; the spec, the Glossary and coverage changed; step 1 is next.
