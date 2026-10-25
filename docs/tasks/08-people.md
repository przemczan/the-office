# 08 · People: Role cards, presets and a person's page

Status: in progress

## Goal

The People module and surface: the user hires the Planner, a Developer and a Reviewer from presets, names each person, and edits their Role cards. The Role card holds everything a session of that person needs (instructions, model, effort, engine, capabilities, permission profile, Hard switches, Task limit, session default, Skills), and a change applies from the person's next session. People shows a grid of same-size cards and a page per person.

## Definition of Done

- [ ] Hiring from a preset creates a named person with the preset's Role card: capabilities, Task limit, Hard switches and profile as in [spec §2.2](../spec.md#22-people), [§6](../spec.md#6-permissions-and-safety) and [§9](../spec.md#9-defaults-chosen-in-this-spec). Check: hire all three, compare each card with the tables.
- [ ] The Role card form edits name and title, description, instructions, model, effort, engine, Chat, Consultant, Task limit (1–6 or none), the session default (Context policy, Always start fresh, Prefer to continue) and Skills; and each Hard switch (Allowed, Consult *person*, Ask me, Never), marked as enforced by The Office or followed by the Agent, with Change Roles kept at Never ([spec §9](../spec.md#9-defaults-chosen-in-this-spec)); Shared memory shows and stays off until tier 2; the permission profile shows read-only. Check: edit each field, reload.
- [ ] A Task limit outside 1–6 is refused with the reason, and a Consult value naming a Role nobody fills (every Consult value in tier 1) shows "Asks you until someone is hired". Check: tests on the rules, and the Developer's card.
- [ ] A Role card change reaches only sessions started after it; the person's page lists the change with its time. Check: a test that starts a session, edits the card, and reads both sessions' options.
- [ ] Assigning a skill to a Role ("Assign…" in Settings → Skills, and Skills on the Role card) puts it in that person's next session set. Check: the folder builder's input for that person.
- [ ] The People grid and a person's page (Overview, Conversations, Role card) render from live data. Check: Playwright on the three people.

## Read first

- [Spec §2.2](../spec.md#22-people), [§6](../spec.md#6-permissions-and-safety), [§4](../spec.md#4-ux-direction) (the known gap: the Edit Role form needs a proper design).
- Click-through: [app/people.js](../../.scratch/the-office/prototypes/app/people.js), the people and `roleOptions` entries of [app/data.js](../../.scratch/the-office/prototypes/app/data.js), "Assign…" in [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js).
- [design-system/readme.md](../../design-system/readme.md) "Settings: label-left/controls-right rows" for the form.

Build from People: the grid of person cards, the hire tile with the three presets, a person's page with Overview, Conversations (filled by task 09) and Role card, the Role card form, the change history. The Work tab comes with task 10. Leave out: hiring from scratch, letting go, the Office Manager and Proposals, the Memory tab, Consultations, and the CTO, Devops and Office Manager presets.

## Steps

- [x] 1. People module domain: Role, person, Role card with its value objects (capabilities, Task limit, Hard switch values and enforcement, permission profile, session default), the presets as data, and their rules with tests. Commit.
- [ ] 2. Persistence and use cases: hire from a preset, edit the card (versioned, so each session records the card version it started with), read people, the change history; events and API. Commit.
- [ ] 3. Role → Skill assignment, owned by the Skills module and keyed by the Role, used by the session folder builder; "Assign…" in Settings → Skills. Commit.
- [ ] 4. The People surface: the grid, hiring with a name, a person's page with Overview and Role card, and the Role card form, designed properly as label-left rows grouped by Identity, Work, Engine, Capabilities, Permissions and Skills. Commit.
- [ ] 5. Check: hire the Planner, a Developer and a Reviewer, give the Planner a skill; log the cards. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->

- 2026-10-25 · step 1: `modules/people/domain/`: a `Role` keyed by its preset's key (`planner`, `developer`, `reviewer`, as `built-in-pipelines.ts` names them), holding its `RoleCard` and a `cardVersion` from 1; `hire` (one person per Role, refused when filled) and `changeRoleCard` (next version, `RoleCardChanged` with the previous card and the changed fields down to each capability and switch, or undefined); rules returning every reason (texts and lengths, the engine's models, shared memory off, Task limit 1–6 or none, Consult naming a known Role other than itself). Presets follow spec §2.2, §6 and §9, not the click-through (its limits 3/4/2 and boolean switches are older). Choices: authority lives as plain rules in each preset's instructions (no field, as the spec says); Skills aren't on the card (step 3 keys them by Role in Skills); the profile holds only the kind of commands, edit and web, and an edit can't change it; model is the engine's id, engine only `agent-sdk`; the Reviewer's session default is Always start fresh (the click-through's), the others Context policy; `KNOWN_ROLES` names tier 2's Roles too, so "Consult Devops" holds before anyone is hired and `hardSwitchInEffect` turns it into Ask me. Asked the user: Change Roles may only be Never in tier 1 (§9 holds no enforced call), now in §9 and the DoD. Next: step 2, persistence with each card version kept, use cases, events and API.
