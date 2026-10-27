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
- [ ] 2b. Proposals for Roles, the web side: the card in the chat (Hire, Edit before hiring, Apply change, Not now), the hire dialog prefilled from the Proposal, "proposed by" in the Role's changes, and Playwright hiring and declining one. Commit.
  Read: the State's file map; the chat's message rendering in `shell/conversation/`; the People surface's hire dialog and changes list; click-through `people.js` from line 236.
- [ ] 3. Proposals for Office settings: the Office-wide limit (Work) and the size threshold (Conversations), each applied by its owner through the Proposal registry. Commit.
  Read: `office-limits.controller.ts`, `size-threshold.controller.ts` and their services, by symbol.
- [ ] 4. The Link card: the tool, the card with the person's status (or let go), opening a thread with the Handover note prefilled in the composer. Commit.
  Read: click-through `chat.js` (`redirect`) and `conversation.js` (the composer note); `shell/conversation/composer.tsx`.
- [ ] 5. Capturing an Idea and the Office status: the tools, the Idea card ("Plan as a Task with …" through the existing route) and the Office status card built from Now's data, Office-wide. Commit.
  Read: click-through `chat.js` (`idea`, `status`); Work's Idea creation and `IdeasController.plan`; Notifications' Now service.
- [ ] 6. Office kinds of Notifications from the Office Manager when one is hired. Commit.
  Read: `notification-kinds.ts`, `notification.ts`; spec 2.7.
- [ ] 7. The user looks at hiring the Office Manager, a Proposal, a Link card and the Office status; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- Steps 1 and 2a built (2026-10-27); step 2b (the web side of Proposals for Roles) is next.
- The preset (`presets.ts`, key `office-manager`, "Marta"): Memory and Chat on, Consultant off, Task limit none, Hard switches Never / Never / Ask me. Their chat tools are `chatOfficeTools(roleKey)` in Conversations' `session-instructions.ts`: every chat tool but `create_task`, plus `propose_role`; steps 4 and 5 add theirs there. They never get `change_role`.
- Proposals live in Conversations: `domain/proposal.ts` (`ProposedChanges`: `hire` with the whole card, skills and the Role key once applied; `change` with the Role key and the top-level card fields it rewrites, `from` as drafted and `to`), `proposal-changes.ts`, `draftProposal` in `thread-changes.ts`, table `proposals`, `ProposalService`, and `ProposalAppliers`, a registry each owning module fills (`RoleProposals` over People's `RoleService`). Step 3 adds its kinds to `ProposedChanges`, a case in `ProposalAppliers`, and the appliers: Work registers its own, since Work calls Conversations.
- For 2b, contracts (`conversations.ts`): `proposalSchema`, `proposedChangeSchema`, `proposalStatusSchema`; message kind `proposal` (`roleKey`, `proposal`); `GET /proposals/:id`, `POST /proposals/:id/apply` (`proposalApplicationSchema`: `card` with skills, for a new Role edited before hiring) and `POST /proposals/:id/decline`, each answering the Proposal, or a 422 `threadRefusalSchema` that leaves it open; events `thread.proposal-drafted`/`-applied`/`-declined` (with `proposalId`), invalidating the Threads in `api/conversations.ts`; `PROPOSE_ROLE_TOOL`, whose activity line the card replaces, as `DECISION_TOOLS`.
- "Proposed by": `roleChangeSchema`'s `hired` and `card-changed` carry `proposedBy` (a Role key, null when the user wrote it); the web names the person. Skill changes a hire records carry none.
- Placeholders 2b replaces: `case "proposal": return null` in `shell/conversation/message-list.tsx`; the People surface's changes list (`role-card-tab.tsx`) and hire dialog, prefilled from `proposal.change.card`.
- Decided in 2a: only a new Role is edited before hiring; a change leaves the skills and is merged onto the card as it is when applied; one applied to a card that already reads so is applied with no new version. The tool checks a Proposal with People's dry runs as it is drafted, so the Agent reads the refusal.
- Open question for the user, not blocking: a Proposal to hire a preset's Role (Planner, Developer…) is refused, as hiring from scratch refuses a preset's title.
- Decided with the user (2026-10-27): Office kinds from the Office Manager are built here (minimal: name, first-person line, opens their chat), the grid stays in 27; new glossary terms **Link card** and **Office status**.
- A Proposal is its own record, not task 20's held call; the Office Manager's change Roles = Ask me is met by the user's click. Work's Pipeline "proposal" at planning (`planning-changes.ts`, `contracts/src/work.ts`) is another thing: keep the names apart.
- Only an Agent's session posts the Office Manager's cards, so the e2e seeds them in the database, as the Consultation e2e does.

## Progress

- 2026-10-27 · slicing: task file written, one task of 7 steps; Office kinds from the Office Manager kept here; Link card and Office status added to the glossary; next, step 1 (the preset).
- 2026-10-27 · step 1: the Office Manager preset (Ask me on Change Roles, talks only) and their chat tools without `create_task`, with preset, controller and Playwright checks; next, step 2 (Proposals for Roles).
- 2026-10-27 · step 2a: Proposals for Roles, service side: the Proposal record, table, routes and events in Conversations, the Office Manager's `propose_role`, applied through `RoleService` behind `ProposalAppliers`, and "proposed by" in the Role's changes; next, step 2b (the card, the hire dialog from a Proposal, "proposed by" on People, Playwright).
