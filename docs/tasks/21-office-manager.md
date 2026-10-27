# 21 · The Office Manager and Proposals

Status: in progress

## Goal

The user can hire the Office Manager, the person they go to by default. In a chat the Office Manager drafts Roles and Office settings as Proposals that take effect only on the user's click, points the user to whoever is responsible with a Link card, captures Ideas and answers with the Office status; it never works a Stage and never acts alone on Roles, settings, work, publishing or for someone else. With one hired, Office kinds of Notifications come from them. Spec [2.2](../spec/2.2-people.md), [2.7](../spec/2.7-notifications.md), [6](../spec/6-permissions-and-safety.md); ticket [06](../../.scratch/the-office/issues/06-office-manager.md); coverage row §2.2, task 21, in [coverage.md](coverage.md).

## Definition of Done

- [ ] The Office Manager preset: hired from its preset with Memory and Chat on, Consultant off, Task limit none and Hard switches Never / Never / Ask me; no Pipeline may name them; their Office tools leave out starting, stopping or moving work and publishing. Check: a service test of the preset and of the tools offered; Playwright hiring one.
- [ ] Proposals for Roles: the Office Manager drafts a new Role card or a change to one as a Proposal in the chat; the user hires it, edits it before hiring, applies or declines it; nothing changes until they do, and the Role's changes say who proposed it. Check: a service test through the scripted engine; Playwright hiring and declining one.
- [ ] Proposals for Office settings: the Office-wide limit and the size threshold, applied by the module that owns each. Check: a service test per setting.
- [ ] Link card: the Office Manager points the user to a person or a Task with a Handover note; opening the thread prefills the note, editable or dropped; a person let go shows as such. Check: a service test; Playwright opening a thread from one.
- [ ] Capturing an Idea and the Office status: a thought becomes an Idea in Work with a card in the chat; the Office status shows, Office-wide, who is on what and what waits on the user. Check: a service test of each; Playwright seeing both.
- [ ] Office kinds of Notifications: with an Office Manager hired they carry the Office Manager's name and a first-person line and open their chat; without one they stay in the UI's own voice. Check: a service test of both.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at hiring the Office Manager, a Proposal, a Link card and the Office status in the running app. Check: the commands; the user's word, logged.

## Read first

- [People module map](../../apps/service/src/modules/people/MAP.md) (`presets.ts`, `role-changes.ts`, `hard-switches.ts`, `PeopleOfficeTools`) and the [People surface map](../../apps/web/src/surfaces/people/MAP.md).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md) (Threads, messages, `ThreadRunner`) and the Engine map's `OfficeToolRegistry`.
- The click-through's `chat.js` (Link card, Idea, Office status) and `people.js` (proposals, from line 236), by grep.

Leave out: the CTO, Devops and Initiatives (tasks 22, 24); Proposals drafted by anyone but the Office Manager (task 24 widens them for Devops, task 25 for skill updates); the kinds × channels grid and the fire alarm line in the Office status (task 27); messages a person sends unprompted (`needs-you.message`).

## Steps

- [x] 1. The Office Manager preset: the preset, lifting the "hire from its preset" refusal, no Pipeline naming them (Task limit none), and their Office tools scoped. Commit.
  Read: `presets.ts`, `known-roles.ts`, `hireFromScratch` in `role-changes.ts`; `staffingProblems`; `OfficeToolRegistry` and how tools are offered per Role; spec 6's Hard switch table.
- [x] 2a. Proposals for Roles, the service side: the Proposal record in Conversations (generic over what it changes, who drafted it), its events, table, routes and WebSocket events, the card message in the chat, the Office Manager's tool, applied through `RoleService` behind a registry each owning module fills, and "proposed by" in the Role's changes. Commit.
  Read: `RoleService.hireFromScratch`/`changeCard`, `role-history.ts`; Decisions in Conversations (`decision.ts`, `openDecision`, `DecisionService`, `threads.schema.ts`); `role-office-tools.ts`; `consultations.test.ts` for a scripted-engine service test.
- [x] 2b. Proposals for Roles, the web side: the card in the chat (Hire, Edit before hiring, Apply change, Not now), the hire dialog prefilled from the Proposal, "proposed by" in the Role's changes, and Playwright hiring and declining one. Commit.
  Read: the State's file map; the chat's message rendering in `shell/conversation/`; the People surface's hire dialog and changes list; click-through `people.js` from line 236.
- [x] 3. Proposals for Office settings: the Office-wide limit (Work) and the size threshold (Conversations), each applied by its owner through the Proposal registry; and the preset kind of Proposal, hiring into a preset's Role (user, 2026-10-27), service and card. Commit.
  Read: `office-limits.controller.ts`, `size-threshold.controller.ts` and their services, by symbol; `RoleService.hire` (from a preset); `shell/conversation/proposal-card.tsx`.
- [ ] 4. The Link card: the tool, the card with the person's status (or let go), opening a thread with the Handover note prefilled in the composer. Commit.
  Read: click-through `chat.js` (`redirect`) and `conversation.js` (the composer note); `shell/conversation/composer.tsx`.
- [ ] 5. Capturing an Idea and the Office status: the tools, the Idea card ("Plan as a Task with …" through the existing route) and the Office status card built from Now's data, Office-wide. Commit.
  Read: click-through `chat.js` (`idea`, `status`); Work's Idea creation and `IdeasController.plan`; Notifications' Now service.
- [ ] 6. Office kinds of Notifications from the Office Manager when one is hired. Commit.
  Read: `notification-kinds.ts`, `notification.ts`; spec 2.7.
- [ ] 7. The user looks at hiring the Office Manager, a Proposal, a Link card and the Office status; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- Steps 1 to 3 built (2026-10-27); step 4 (the Link card) is next.
- The preset (`presets.ts`, key `office-manager`, "Marta"). Their chat tools are `chatOfficeTools(roleKey)` in Conversations' `session-instructions.ts`: every chat tool but `create_task`, plus `propose_role` and `propose_office_setting`; steps 4 and 5 add theirs there, with the name in the contracts too and in `TOOLS_SHOWN_AS_CARDS` (`message-list.tsx`) when a card shows the call.
- Proposals live in Conversations: `domain/proposal.ts` (`ProposedChanges`: `hire`, `hire-from-preset`, `change`, `office-wide-limit`, `size-threshold`), `ProposalService`, and `ProposalAppliers`, a registry each owner fills: `RoleProposals` (People's `RoleService`: `hireFromScratch`, `hire`, `changeCard`, each with `proposedBy`, and their dry runs), `SizeThresholdProposals` (Conversations' adapter) and Work's `OfficeLimitProposals` (`work/adapters/conversations/`). A setting registers with `registerSetting` and its value now; the owner judges the value by the contracts' rule the Settings page saves by, at drafting and again at applying.
- Tools answer the Agent with the owner's reasons (`refusedToTheAgent` in `proposal-office-tools.ts`); `ScriptedSession.reportedEvents` lets a test read what the Agent read (`toolResultRead` in `proposal-service.test.ts`).
- The web: `shell/conversation/proposal-card.tsx` renders each kind in a `ProposalFrame`; `useAnswering(proposal, changedQueries, onApplied)` refreshes what an applied Proposal changed. A preset's Role is edited before hiring in place (the name only: the key and card are the preset's); an Office setting shows old → new with "Apply change" / "Not now". The click-through has no settings card, so it follows the Role change card.
- Decided in 3: one `propose_role` for every kind of Role (`preset` beside `role`, keys listed in its description) and one `propose_office_setting` (`setting`, `value`); the apply body takes `card` or `name`, never both.
- Decided earlier: only a new Role is edited before hiring; a change is merged onto the card as it is when applied. The Office Manager may propose hiring from a preset (user, 2026-10-27). Office kinds from the Office Manager are built here (minimal), the grid stays in 27; glossary terms **Link card** and **Office status**.
- A Proposal is its own record, not task 20's held call, nor Work's Pipeline "proposal" at planning (`planning-changes.ts`).
- Only an Agent's session posts the Office Manager's cards, so the e2e seeds them in the database (`seedProposal` near the end of `people.e2e.ts`, in the service's own shape). Every preset's Role is filled there, and a preset's fixed key is hired only in `roles.controller.test.ts` (the service test spies on People's preset hiring).

## Progress

- 2026-10-27 · slicing: task file written, one task of 7 steps; Office kinds from the Office Manager kept here; Link card and Office status added to the glossary; next, step 1 (the preset).
- 2026-10-27 · step 1: the Office Manager preset (Ask me on Change Roles, talks only) and their chat tools without `create_task`, with preset, controller and Playwright checks; next, step 2 (Proposals for Roles).
- 2026-10-27 · step 2a: Proposals for Roles, service side: the Proposal record, table, routes and events in Conversations, the Office Manager's `propose_role`, applied through `RoleService` behind `ProposalAppliers`, and "proposed by" in the Role's changes; next, step 2b (the card, the hire dialog from a Proposal, "proposed by" on People, Playwright).
- 2026-10-27 · step 2b: Proposals for Roles, web side: the Proposal card in the chat (Hire, Edit before hiring on `/hire?proposal=…`, Apply change, Not now), "proposed by" in a Role's changes, the Role card's words moved to the shell, Playwright; next, step 3 (Office settings and the preset kind of Proposal).
- 2026-10-27 · step 3: Proposals for the Office-wide limit (applied by Work) and the size threshold (by Conversations), judged by Settings' rule at drafting and applying, and the preset kind of Proposal through `propose_role`, with their cards; next, step 4 (the Link card).
