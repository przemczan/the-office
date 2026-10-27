# 20 · People: hiring from scratch, letting go, editable profiles, Consultants, mentions

Status: done

## Goal

The user can hire a person from scratch, let a person go, edit permission profiles, and have an enforced Hard switch's call held. Agents consult Consultants in a Consultation sub-thread on the Task, with escalation up to two steps, and any Task, Initiative, Idea or Decision can be mentioned in a chat. Spec [2.2](../spec/2.2-people.md), [2.4](../spec/2.4-conversations.md), [6](../spec/6-permissions-and-safety.md); coverage rows in [coverage.md](coverage.md) (§2.2/§6 and §2.2/§2.4, task 20).

## Definition of Done

- [x] Hiring from scratch: the user hires a person without a preset, filling the whole Role card; a Role hired this way works like a preset one. Check: a service test of `hire` with no preset; Playwright hiring one.
- [x] Editable profiles: the permission profile can be edited on the Role card and applies at the next session start. Check: a service test; Playwright editing a profile.
- [x] Letting go: letting a Role go pauses its running Tasks behind a Decision and flags Pipelines that name it; its Memory and chats are kept, unused and readable. Check: a service test through the scripted engine; Playwright letting a person go.
- [x] Held calls: a Role that holds "change Roles" (or another enforced Hard switch) has the call held until the Hard switch's value allows it (Allowed, Consult, Ask me, Never); "change Roles" is no longer refused as Never on the Role card. Check: a service test per value.
- [x] Consultations: an Agent consulting a hired Consultant opens a Consultation sub-thread on the Task, labelled with both; the Consultant answers in a fresh session with its memory and the Task's brief; the user can read it live, join or take it over. Check: a service test through the scripted engine; Playwright reading and joining one.
- [x] Escalation: a Consultant asked to approve answers Allow once, Deny or Pass on, at most two steps up (e.g. Devops → CTO → the user); a person not hired falls back to the user. Check: a service test of a two-step chain and of the fallback.
- [x] Mentions: a Task, Idea or Decision can be mentioned in a chat by link or `@`, and the Agent there can read its record; Initiatives join with task 22, which builds them (decided with the user, 2026-10-27). Check: a service test that the mentioned record reaches the Brief; Playwright with `@`.
- [x] `npm run verify` and `npm run verify:linux` pass, and the user has looked at hiring, letting go, a Consultation and a mention in the running app. Check: the commands; the user's word, logged.

## Read first

- [People module map](../../apps/service/src/modules/people/MAP.md) (`role-changes.ts`, `hard-switches.ts`, `RolesController.hire`) and the [People surface map](../../apps/web/src/surfaces/people/MAP.md).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md) (`consult.ts`: `Consult`, `consultDecision`).

Leave out: the Office Manager and Proposals (task 21); Initiatives and the CTO's shaping (task 22); searching mentions (task 23); a Consultant whose Role is a Crew Role beyond what the capability already allows.

## Steps

- [x] 1. Hire from scratch and edit permission profiles: a hire without a preset, the Role card form for it, and an editable profile. Commit.
  Read: `role-changes.ts` (`hire`), `RolesController.hire`, the Role card form and `role-card-labels.ts` in the People surface, by symbol; [permissions spec 6](../spec/6-permissions-and-safety.md) for the profile.
- [x] 2. Let a person go (People side): `letGoAt` on the Role, the Let go / Hire back actions, no session for them, Memory and chats kept unused. Commit.
- [x] 2b. Let a person go (Work side): on `RoleLetGo`, pause the started Tasks whose Stages from the first unrun one name the Role, each behind a Decision (Resume once someone fills it, or Drop); refuse a Resume while nobody fills the Role; tell "let go" from "never hired" in the Stage editor's flags; the Let go dialog says so. Commit.
  Read: Pipelines MAP trap on replay (`walk-decisions.ts`, `WalkDecisionKind`); `StartedTasks` and `StageDecisions` ports; `staffingProblems`/`RoleFilling`; `TaskService.pause`.
- [x] 3. Hold an enforced Hard switch's call, and lift the "change Roles stays Never" refusal. Commit.
  Read: `hard-switches.ts` (`HARD_SWITCH_ENFORCEMENT`, `hardSwitchesProblems`), the Engine's `office-rules-hook`, by range.
- [x] 4. Consultants and the Consultation sub-thread on the Task: open, label, read live, join or take over. Commit.
  Read: `consult.ts`, the Thread kinds in Conversations, `OfficeToolRegistry`; the click-through's Consultation parts by grep.
- [x] 5. Escalation up to two steps and the fall back to the user for a missing person. Commit.
  Read: `consult.ts` and the Consultation code from step 4; the Hard switch values.
- [x] 6. Mentions: link and `@` in a chat, the record reaching the Brief. Commit.
  Read: `briefs.ts`, `brief.ts` by range; the Composer in `shell/conversation/composer.tsx`.
- [x] 7. The user looks at hiring, letting go, a Consultation and a mention; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check; [test-project.md](test-project.md).

## State

- Done (2026-10-27): all 7 steps built; `npm run verify:linux` passed; the user looked at most of it in the running app and said it looks good, the rest to be tried on real Tasks in the tier 2 acceptance run (task 30).
- Hiring from scratch: `POST /roles` with `{ card }` (`hireFromScratch`), `/hire` page, one `roleCardSchema` for hire, edit and the form, permission profile included.
- Letting go (decided with the user): the person keeps key, card, Memory and chats, unused; `POST /roles/:key/hire-back` restores them; nobody else is hired into the Role meanwhile. Pipelines' `StaffingHolds` pauses their Tasks behind a "Resume / Drop" Decision, re-checked on each resume.
- Held calls: `HeldCalls` rules by the Hard switch (Allowed, Ask me, Consult, Never); "Allow once" lets the identical repeat run once; the real `change_role` tool, on Task Threads only.
- Consultations: `Consultations` opens a Consultation Thread for a `Decision.putTo`; the Consultant answers with `answer_consultation`; the user answering first takes over. Pass on (decided with the user): to whom their authority names, at most two steps, then the user (`passDecisionOn`).
- Mentions (step 6): a mention is a link to the record's page, `recordPath`/`recordLinksIn` in `packages/contracts/src/record-links.ts` (Task `/tasks/:id`, Decision `/tasks/:task?taskThread=…&decision=:id`, Idea `/work/ideas?idea=:id`; decided with the user: Ideas and Decisions get URLs too). The `@` picker (`mention-picker.tsx`) writes `[@name](path)`; pasted URLs count too. `ThreadsController.send` reads the links, `MentionedRecords` the records (Decisions here, Tasks and Ideas from Work through `WorkRecords`, worded as `read_task`/`read_idea`), and `ThreadRunner` puts them in a new session's Brief (seen in the context line) or after the message into a running one. Chips in Markdown (`record-mention.tsx`); Copy link on a Decision card and an Idea's menu; the linked card is marked and scrolled to.
- Left open: a barge-in into a running Stage Thread gets no records; a mention gives the record only, not the Task's Threads or diff; the Hard switch select offers preset Roles only (`KNOWN_ROLES`); a user take-over doesn't end the Consultant's live session; nothing deletes a person let go. Spec 2.4's "(tier 2 …)" notes are to be reworded when the task closes.
- The e2e seeds a Consultation in the database (only an Agent's session starts one).

## Progress

The log is archived in [archive/20-people-tier-2.md](archive/20-people-tier-2.md).
