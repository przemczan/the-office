# 21 · The Office Manager and Proposals

Status: done

## Goal

The user can hire the Office Manager, the person they go to by default. In a chat the Office Manager drafts Roles and Office settings as Proposals that take effect only on the user's click, points the user to whoever is responsible with a Link card, captures Ideas and answers with the Office status; it never works a Stage and never acts alone on Roles, settings, work, publishing or for someone else. With one hired, Office kinds of Notifications come from them. Spec [2.2](../spec/2.2-people.md), [2.7](../spec/2.7-notifications.md), [6](../spec/6-permissions-and-safety.md); ticket [06](../../.scratch/the-office/issues/06-office-manager.md); coverage row §2.2, task 21, in [coverage.md](coverage.md).

## Definition of Done

- [ ] The Office Manager preset: hired from its preset with Memory and Chat on, Consultant off, Task limit none and Hard switches Never / Never / Ask me; no Pipeline may name them; their Office tools leave out starting, stopping or moving work and publishing. Check: a service test of the preset and of the tools offered; Playwright hiring one.
- [ ] Proposals for Roles: the Office Manager drafts a new Role card or a change to one as a Proposal in the chat; the user hires it, edits it before hiring, applies or declines it; nothing changes until they do, and the Role's changes say who proposed it. Check: a service test through the scripted engine; Playwright hiring and declining one.
- [ ] Proposals for Office settings: the Office-wide limit and the size threshold, applied by the module that owns each. Check: a service test per setting.
- [ ] Link card: the Office Manager points the user to a person or a Task with a Handover note; opening the thread prefills the note, editable or dropped; a person let go shows as such. Check: a service test; Playwright opening a thread from one.
- [ ] Capturing an Idea and the Office status: a thought becomes an Idea in Work with a card in the chat; the Office status shows, Office-wide, who is on what and what waits on the user. Check: a service test of each; Playwright seeing both.
- [x] Office kinds of Notifications: with an Office Manager hired they carry the Office Manager's name and a first-person line and open their chat; without one they stay in the UI's own voice. Check: a service test of both.
- [x] `npm run verify` and `npm run verify:linux` pass, and the user has looked at hiring the Office Manager, a Proposal, a Link card and the Office status in the running app. Check: the commands; the user's word, logged.

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
- [x] 4. The Link card: the tool, the card with the person's status (or let go), opening a thread with the Handover note prefilled in the composer. Commit.
  Read: click-through `chat.js` (`redirect`) and `conversation.js` (the composer note); `shell/conversation/composer.tsx`.
- [x] 5. Capturing an Idea and the Office status: the tools, the Idea card ("Plan as a Task with …" through the existing route) and the Office status card built from Now's data, Office-wide. Commit.
  Read: click-through `chat.js` (`idea`, `status`); Work's Idea creation and `IdeasController.plan`; Notifications' Now service.
- [x] 6. Office kinds of Notifications from the Office Manager when one is hired. Commit.
  Read: `notification-kinds.ts`, `notification.ts`; spec 2.7.
- [x] 7. The user looks at hiring the Office Manager, a Proposal, a Link card and the Office status; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- Done (2026-10-28): every step built, both verifies passed, and the user approved it in the running app, including Office kinds opening the Office Manager's chat over Now.
- Office kinds of Notifications: `windowNearlyUsed`, `windowReset` and `engineDown` (`notification.ts`) take the Office Manager's key, read at each raise through Notifications' `KnownPeople` port (bound to `RoleCards`), and speak in their first person then. The web's own "service down" (`serviceDown` in `notification-words.ts`) does the same from the Roles list; the status strip puts the person's name before the line. People owns `OFFICE_MANAGER` (`known-roles.ts`, exported); Conversations imports it.
- Opening an Office kind from the Office Manager goes to Now with their chat over it (`targetOf`), so opening it still handles the window's kinds (spec 2.7's "opens the Office Manager's chat" read with its Defaults' "by opening Now"; approved by the user, 2026-10-28).
- The Office Manager's chat tools are `chatOfficeTools(roleKey)` in Conversations' `session-instructions.ts`: every chat tool but `create_task`, plus `propose_role`, `propose_office_setting`, `post_link_card` and `show_office_status`.
- Idea and Office status cards: `idea` and `office-status` messages, pointers only, logged in chat Threads only by `ThreadService.postIdeaCard`/`postOfficeStatus`, reached through Work's `IdeaCards` (after `capture_idea`, any person's chat) and Notifications' `OfficeStatusCards` (from `show_office_status`, `OfficeStatusOfficeTools`, which also gives the Agent Now in words, `officeStatusText`). The web reads both live: `idea-card.tsx` (Plan as a Task with the Planner through `shell/work/use-idea-planning.ts`, moved from Work's surface with `shape-idea-dialog.tsx`) and `office-status-card.tsx` (Now's counts and each person's `personStatus`). Waiting messages and the fire alarm stay out (task 27). A new one is named there and in the contracts (a test keeps the two equal), and goes in `TOOLS_SHOWN_AS_CARDS` (`message-list.tsx`) when a card shows the call. `capture_idea` is already among the chat tools (Work's `registerCaptureIdea`).
- Proposals: `domain/proposal.ts`, `ProposalService`, and `ProposalAppliers`, a registry each owner fills (`RoleProposals`, `SizeThresholdProposals`, Work's `OfficeLimitProposals`). Web: `shell/conversation/proposal-card.tsx` (`ProposalFrame`, `useAnswering`).
- Link cards: a `link-card` message (`to`, `taskId`, `note`) logged by `LinkCards.post` through `LinkCardOfficeTools`. It refuses, and the Agent reads why, for the Office Manager themself, someone let go, a Role nobody fills, Chat off, a blank note or no such Task. Its Task's title comes through `WorkRecords.taskTitle`. Whether the person was let go is read live with the log (`letGoIn`, the response's `to.letGo`). Busy, waiting or available is read live on the web from Now's running Tasks (`personStatus`, `link-card-words.ts`).
- Web: `link-card.tsx` starts a new chat Thread, leaves the note in the shell's `HandoverNotes` (`handover-notes.tsx`, held only in the page), and opens it. The composer prefills the note under "Leave it out". A message sent from it carries `handoverNoteFrom` and shows "You · Handover note from …".
- Decided with the user (2026-10-27): a Link card about a Task points to the person on its latest Stage (its newest Stage Thread), or to the one the Office Manager names, and the note links the Task so the mention puts its record in that person's Brief. No Task Threads are started by the user. The sent note keeps its label in an optional `handoverNoteFrom` field on the user's message, never the `handover-note` kind, which a fresh Brief reads as the person's own.
- Left out: the click-through's "Thread opened · Go to the thread" state on the card, which would need the card to record the Thread it opened.
- Decided earlier: only a new Role is edited before hiring; the Office Manager may propose hiring from a preset (user, 2026-10-27); Office kinds of Notifications from the Office Manager are built here (minimal), and the grid stays in task 27.
- Only an Agent's session posts the Office Manager's cards, so the e2e seeds them in the database (`seedProposal`, `seedLinkCard`, `seedChatCard` at the end of `people.e2e.ts`). A design-system `Dialog` opened from a card renders inside the chat's dialog: find it with `chatWith(…).getByRole("dialog")`. The Memory e2e test timed out once at its second "Add note" in a full run and passed on rerun; watch it. A test that sends a message appends its script to `sessions.jsonl` in file order.

## Progress

The log is archived in [archive/21-office-manager.md](archive/21-office-manager.md).
