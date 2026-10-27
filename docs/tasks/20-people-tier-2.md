# 20 · People: hiring from scratch, letting go, editable profiles, Consultants, mentions

Status: in progress

## Goal

The user can hire a person from scratch, let a person go, edit permission profiles, and have an enforced Hard switch's call held. Agents consult Consultants in a Consultation sub-thread on the Task, with escalation up to two steps, and any Task, Initiative, Idea or Decision can be mentioned in a chat. Spec [2.2](../spec/2.2-people.md), [2.4](../spec/2.4-conversations.md), [6](../spec/6-permissions-and-safety.md); coverage rows in [coverage.md](coverage.md) (§2.2/§6 and §2.2/§2.4, task 20).

## Definition of Done

- [ ] Hiring from scratch: the user hires a person without a preset, filling the whole Role card; a Role hired this way works like a preset one. Check: a service test of `hire` with no preset; Playwright hiring one.
- [ ] Editable profiles: the permission profile can be edited on the Role card and applies at the next session start. Check: a service test; Playwright editing a profile.
- [ ] Letting go: letting a Role go pauses its running Tasks behind a Decision and flags Pipelines that name it; its Memory and chats are kept, unused and readable. Check: a service test through the scripted engine; Playwright letting a person go.
- [ ] Held calls: a Role that holds "change Roles" (or another enforced Hard switch) has the call held until the Hard switch's value allows it (Allowed, Consult, Ask me, Never); "change Roles" is no longer refused as Never on the Role card. Check: a service test per value.
- [ ] Consultations: an Agent consulting a hired Consultant opens a Consultation sub-thread on the Task, labelled with both; the Consultant answers in a fresh session with its memory and the Task's brief; the user can read it live, join or take it over. Check: a service test through the scripted engine; Playwright reading and joining one.
- [ ] Escalation: a Consultant asked to approve answers Allow once, Deny or Pass on, at most two steps up (e.g. Devops → CTO → the user); a person not hired falls back to the user. Check: a service test of a two-step chain and of the fallback.
- [ ] Mentions: a Task, Initiative, Idea or Decision can be mentioned in a chat by link or `@`, and the Agent there can read its record. Check: a service test that the mentioned record reaches the Brief; Playwright with `@`.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at hiring, letting go, a Consultation and a mention in the running app. Check: the commands; the user's word, logged.

## Read first

- [People module map](../../apps/service/src/modules/people/MAP.md) (`role-changes.ts`, `hard-switches.ts`, `RolesController.hire`) and the [People surface map](../../apps/web/src/surfaces/people/MAP.md).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md) (`consult.ts`: `Consult`, `consultDecision`).

Leave out: the Office Manager and Proposals (task 21); Initiatives and the CTO's shaping (task 22); searching mentions (task 23); a Consultant whose Role is a Crew Role beyond what the capability already allows.

## Steps

- [x] 1. Hire from scratch and edit permission profiles: a hire without a preset, the Role card form for it, and an editable profile. Commit.
  Read: `role-changes.ts` (`hire`), `RolesController.hire`, the Role card form and `role-card-labels.ts` in the People surface, by symbol; [permissions spec 6](../spec/6-permissions-and-safety.md) for the profile.
- [x] 2. Let a person go (People side): `letGoAt` on the Role, the Let go / Hire back actions, no session for them, Memory and chats kept unused. Commit.
- [ ] 2b. Let a person go (Work side): on `RoleLetGo`, pause the started Tasks whose Stages from the first unrun one name the Role, each behind a Decision (Resume once someone fills it, or Drop); refuse a Resume while nobody fills the Role; tell "let go" from "never hired" in the Stage editor's flags; the Let go dialog says so. Commit.
  Read: Pipelines MAP trap on replay (`walk-decisions.ts`, `WalkDecisionKind`); `StartedTasks` and `StageDecisions` ports; `staffingProblems`/`RoleFilling`; `TaskService.pause`.
- [ ] 3. Hold an enforced Hard switch's call, and lift the "change Roles stays Never" refusal. Commit.
  Read: `hard-switches.ts` (`HARD_SWITCH_ENFORCEMENT`, `hardSwitchesProblems`), the Engine's `office-rules-hook`, by range.
- [ ] 4. Consultants and the Consultation sub-thread on the Task: open, label, read live, join or take over. Commit.
  Read: `consult.ts`, the Thread kinds in Conversations, `OfficeToolRegistry`; the click-through's Consultation parts by grep.
- [ ] 5. Escalation up to two steps and the fall back to the user for a missing person. Commit.
  Read: `consult.ts` and the Consultation code from step 4; the Hard switch values.
- [ ] 6. Mentions: link and `@` in a chat, the record reaching the Brief. Commit.
  Read: `briefs.ts`, `brief.ts` by range; the Composer in `shell/conversation/composer.tsx`.
- [ ] 7. The user looks at hiring, letting go, a Consultation and a mention; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check; [test-project.md](test-project.md).

## State

- Sliced with the user (2026-10-27): one task with these 7 steps, not two.
- Built (step 1): `POST /roles` takes `{ roleKey, name }` (preset) or `{ card }` (scratch; `hireFromScratch` in `role-changes.ts`, key from `roleKeyFor(title)`, refused when a preset keeps the key or someone fills it). One `roleCardSchema` now serves hire, `PUT /roles/:key/card` and the form, permission profile included. Web: `/hire` page (`HireFromScratchPage`, same `RoleCardForm` as Edit Role, blank card in `blank-role-card.ts`), "Start from scratch" tile button, editable profile fields.
- Trap for steps 3–5: Consult values and `hardSwitchesProblems` accept only `KNOWN_ROLES` keys, so a scratch Role can't be named as a Consultant yet; `RoleCardOptions.knownRoles` needs the hired scratch Roles when step 4 makes Consultants.
- Decided with the user (2026-10-27, step 2): a person let go keeps the Role's key, card, Memory and chats, unused and readable; **hiring them back** (`POST /roles/:key/hire-back`) restores them as they were. Hiring anyone else into that Role is refused until then. A fresh hire with the old person archived was weighed and left out: it renames the key across People, Skills, Conversations and Notifications. The Decision on a Task paused by a let-go offers "Resume" (after hiring) or "Drop the Task"; resuming while nobody fills the Role is refused with the reason.
- Built (step 2): `Role.letGoAt` (column `roles.let_go_at`), `letGo`/`hireBack` in `role-changes.ts`, events `RoleLetGo`/`RoleHiredBack`, `RoleRepository.changeStanding`. `RoleCards.find` is undefined for them and `forResumedSession` refuses, so no new or resumed session; Memory refuses writes and reads as not in use; card edits are refused. Web: Let go (confirm dialog) and Hire back on the person's page, "Let go" on the grid card, a notice on the page.
- Open: nothing deletes a person let go, so a preset Role can only be filled again by hiring them back. A confirmed delete would go with the Memory and chats; ask when it comes up.
- Tier 1 behaviour to build on: every consult goes to the user; "change Roles" is Never and refused otherwise; the Role card marks it enforced by The Office.

## Progress

- 2026-10-27 · slicing: task file written with the user's choice of one task; next, step 1.
- 2026-10-27 · step 1: hiring from scratch (`/hire`, `hireFromScratch`) and an editable permission profile, with service, controller and Playwright checks; next, step 2 (letting a person go).
- 2026-10-27 · step 2: letting a person go on the People side (`letGoAt`, Let go / Hire back, no sessions, Memory kept unused) after settling re-hiring with the user; next, step 2b (pause their Tasks behind a Decision, flags).
