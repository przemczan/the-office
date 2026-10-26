# 08 · People: Role cards, presets and a person's page

Status: done

## Goal

The People module and surface: the user hires the Planner, a Developer and a Reviewer from presets, names each person, and edits their Role cards. The Role card holds everything a session of that person needs (instructions, model, effort, engine, capabilities, permission profile, Hard switches, Task limit, session default, Skills), and a change applies from the person's next session. People shows a grid of same-size cards and a page per person.

## Definition of Done

- [x] Hiring from a preset creates a named person with the preset's Role card: capabilities, Task limit, Hard switches and profile as in [spec §2.2](../spec/2.2-people.md), [§6](../spec/6-permissions-and-safety.md) and [§9](../spec/README.md#defaults). Check: hire all three, compare each card with the tables.
- [x] The Role card form edits name and title, responsibilities, instructions, model, effort, engine, Chat, Consultant, Task limit (1–6 or none), the session default (Context policy, Always start fresh, Prefer to continue) and Skills; and each Hard switch (Allowed, Consult *person*, Ask me, Never), marked as enforced by The Office or followed by the Agent, with Change Roles kept at Never ([spec §9](../spec/README.md#defaults)); Shared memory shows and stays off until tier 2; the permission profile shows read-only. Check: edit each field, reload.
- [x] A Task limit outside 1–6 is refused with the reason, and a Consult value naming a Role nobody fills (every Consult value in tier 1) shows "Asks you until someone is hired". Check: tests on the rules, and the Developer's card.
- [x] A Role card change reaches only sessions started after it; the person's page lists the change with its time. Check: a test that takes a new session's card, edits the card, and reads both the next new session's card and the first one's on resume (`RoleCards`); building both sessions' options from them is checked in task 09 (agreed with the user).
- [x] Assigning a skill to a Role ("Assign…" in Settings → Skills, and Skills on the Role card) puts it in that person's next session set. Check: the folder builder's input for that person.
- [x] The People grid and a person's page (Overview, Role card) render from live data; the Conversations tab comes with task 09, which checks it (agreed with the user). Check: Playwright on the three people.

## Read first

- [Spec §2.2](../spec/2.2-people.md), [§6](../spec/6-permissions-and-safety.md), [§4](../spec/4-ux-direction.md) (the known gap: the Edit Role form needs a proper design).
- Click-through: [app/people.js](../../.scratch/the-office/prototypes/app/people.js), the people and `roleOptions` entries of [app/data.js](../../.scratch/the-office/prototypes/app/data.js), "Assign…" in [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js).
- [design-system/readme.md](../../design-system/readme.md) "Settings: label-left/controls-right rows" for the form.

Build from People: the grid of person cards, the hire tile with the three presets, a person's page with Overview and Role card (Conversations comes with task 09), the Role card form, the change history. The Work tab comes with task 10. Leave out: hiring from scratch, letting go, the Office Manager and Proposals, the Memory tab, Consultations, and the CTO, Devops and Office Manager presets.

## Steps

- [x] 1. People module domain: Role, person, Role card with its value objects (capabilities, Task limit, Hard switch values and enforcement, permission profile, session default), the presets as data, and their rules with tests. Commit.
- [x] 2. Persistence and use cases: hire from a preset, edit the card (versioned, so each session records the card version it started with), read people, the change history; events and API. Commit.
- [x] 3. Role → Skill assignment, owned by the Skills module and keyed by the Role, used by the session folder builder; "Assign…" in Settings → Skills. Commit.
- [x] 4. The People surface: the grid, hiring with a name, a person's page with Overview and Role card, and the Role card form, designed properly as label-left rows grouped by Identity, Work, Engine, Capabilities, Permissions and Skills. Commit.
- [x] 5. Check: hire the Planner, a Developer and a Reviewer, give the Planner a skill; log the cards. Commit.

## Progress

The log is archived in [archive/08-people.md](archive/08-people.md).
