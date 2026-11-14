# 56 · Duties: built-in jobs any hired Role can hold

Status: in progress

Run in The Office itself as the Initiative `b62c4d5e-a0f3-45e0-8ee5-fc748fee214c`: each step below is one of its Tasks, which carries the step's plan.

## Goal

Every built-in job that today belongs to a fixed Role key becomes a duty, held by whichever hired Role the user sets in Settings › Duties, each held by today's Role by default ([spec 2.2](../spec/2.2-people.md#defaults), "Duties"). Renaming a Role or hiring different Roles under other keys keeps every duty and built-in Pipeline working; a duty nobody holds falls back to the user, except Default person to talk to, which falls back to the Caretaker. The Role card and People show the duties each person holds, and on an Office with nobody hired the Caretaker guides setting up, drafting the hires and duty assignments as Proposals.

## Definition of Done

- [x] Spec 2.1–2.4, 2.6, 2.7, 3, 4, 5.4, 6 and 8 and the glossary describe duties. Check: the Gate of the Initiative's first Task.
- [x] The duty model and its Office setting, each duty held by its default Role key until set, with the rules of "Who holds a duty". Check: service tests.
- [ ] Built-in behaviour (the chat tools, calls, Consultations on failures, MCP tool hard switches, notifications, planning, shaping, onboarding, Skill installs) follows duties instead of Role keys. Check: service tests on the scripted engine adapter.
- [ ] The built-in Pipelines and Stage templates name duties, each Stage resolved to the duty's holder when it starts; a duty nobody holds flags its Pipelines and refuses Start. Check: service tests.
- [ ] Settings › Duties, and the duties held on the Role card and People; buttons and tabs name the holder or the fallback. Check: web tests and an e2e test.
- [ ] On an Office with nobody hired, People's empty state and the preset list show each preset's duties and capabilities, and the Caretaker drafts the hires and duty assignments as Proposals. Check: service and e2e tests.
- [ ] `npm run verify` passes. Check: the closing Task's run.

## Read first

- [Spec 2.2](../spec/2.2-people.md#defaults), the Defaults "Duties" and "Who holds a duty"; [spec 2.3](../spec/2.3-pipelines.md#defaults), "A Stage names a Role or a duty".
- The [glossary](../../GLOSSARY.md)'s Duty.
- `apps/service/src/modules/people/MAP.md`.

## Leave out

- Several holders per duty, and per-Project holders.
- Duties the user defines.
- The Caretaker holding a duty.
- Changing the presets' Hard switch values.
- Rewriting Pipelines and Stage templates the user made.

## Steps

- [x] 1. The spec, the glossary and this file (Task 70a243f5).
- [x] 2. Duties in People: the model, the stored Office setting and its API, with today's Roles as defaults (Task 3658c88a).
      Read: `apps/service/src/modules/people/MAP.md`, `apps/service/src/modules/people/domain/known-roles.ts`, [spec 2.2](../spec/2.2-people.md#defaults) "Who holds a duty".
- [ ] 3. Built-in behaviour follows duties instead of Role keys (Task e48c3213).
      Read: `apps/service/src/modules/conversations/MAP.md`, `apps/service/src/modules/notifications/MAP.md`, `apps/service/src/modules/work/MAP.md`.
- [x] 4. Built-in Pipelines name duties, resolved to the Role holding them at Stage start (Task 030470d2).
      Read: `apps/service/src/modules/pipelines/MAP.md`, [spec 2.3](../spec/2.3-pipelines.md#defaults) "A Stage names a Role or a duty", [spec 5.4](../spec/5.4-the-engine.md#defaults).
- [x] 5. Settings › Duties, and the duties on the Role card and People (Task a3b96a29).
      Read: `apps/web/src/surfaces/settings/MAP.md`, `apps/web/src/surfaces/people/MAP.md`, [UI rules](../spec/4.1-ui-rules.md), [spec 4](../spec/4-ux-direction.md) "Settings › Duties" and "Duties on screen".
- [ ] 6. The Caretaker guides setting up an Office with nobody hired, and the close: `npm run verify`, the Progress log to the archive, the task set to done here and in the README (Task 4507fb56).
      Read: `apps/web/src/surfaces/people/MAP.md`, [spec 2.2](../spec/2.2-people.md#defaults) "Setting up an Office with nobody hired".

## State

Steps 1, 2, 4 and 5 are done: the spec describes duties, People has them, Pipelines' Stages may name them, and the user sees and sets them; step 3 (built-in behaviour outside Pipelines) is its own Task.

- People: `domain/duties.ts` (`DUTIES`, `dutyHolding`, `dutiesHeldBy`, `dutyChangeProblems`, `mcpToolDefault`), table `duty_assignments` (migration `0148_duties.sql`, a row only for a duty set), `Duties` (list, `holderOf`, `heldBy`, `changeProblems`, `change`, `changeAll` with `from`), the `DutyChangeChecks` registry, `DutyHolderChanged` → web `duty.changed`, `GET`/`PUT /api/settings/duties[/:duty]`.
- `holderOf(duty)` is on the `KnownPeople` ports of work, pipelines and notifications (bound to `RoleCards`); their test stand-ins keep `holders` by duty key. Register a check with `DutyChangeChecks` (step 4's engine check).
- Web: Settings › Duties (`surfaces/settings/duties/`), the Role card's Duties value and People's "N duties" mark; the shared words in `shell/duty-words.ts` (description and fallback per duty key, `holderOptions`, `dutiesHeldBy`). Steps 3 and 4 link their "Settings › Duties" pointers to `/settings/duties` themselves; none was on this branch.
- Conversations: a `duties` Proposal of an Office setting (`DutyProposals`, `propose_office_setting` with `duties: { duty, holder }[]`), applied all or none through `Duties.changeAll`, refused once a named duty changed since the draft; the contracts' `dutyHoldersSchema`.
- Pipelines (step 4): an Agent Stage names `role` or `duty`, never both (`stageWorker`, `singleStageProblems`); the built-ins and their templates name Implements and Onboards and repairs Projects (migration `0149_stage_duties.sql`, which also adds `stage_runs.role_key`). `staffedStages` gives a duty Stage its latest run's Role, else the holder, at each move; the run records it; `workedBy` on a Task's Stages; an unheld duty is flagged, holds started Tasks (`StaffingHolds` hears `DutyHolderChanged`) and refuses Start in Work (`withDutiesHeld`). People weighs a duty by its holder (`withDutiesResolved`) and refuses a duty change that puts a named duty on an incapable engine. The web's "Who works it" offers Plans, Implements, Reviews and Onboards and repairs Projects first (`shell/duty-words.ts`).
- Still keyed: `CTO`, `DEVOPS`, `OFFICE_MANAGER` stay exported from `people/index.ts` for step 3; `built-in-pipelines.ts` no longer uses `DEVOPS`.
- The Stage words naming "Settings › Duties" (service refusals and flags, the web Stage form's hint) are still plain text; Settings › Duties is at `/settings/duties` now, so link them in a follow-up.
- Trap: `DutyHolderChanged` is only for the user's changes; hires and let-gos change holders in effect without it. Service tests use `DutyRepositoryForTests`; the e2e test restores `duty_assignments` in the records, since no API unsets a duty. Never leave Implements or Reviews unheld in e2e. Sibling steps add migrations too: check the number and the journal when merging.
- Trap: the passing over of a holder whose Consultant is off is built only for the MCP duty; step 3 does it for Asked first when a Stage runs out of tries (Settings › Duties already says so for both).

## Progress

- 2026-11-14 · step 1: spec 2.1–2.4, 2.6, 2.7, 3, 4, 5.4, 6, 8, the README index and the glossary describe duties; this file added; next, step 2: the duty model and setting in People.
- 2026-11-14 · step 2: People owns the eight duties, `duty_assignments` and `Duties` with its API, check registry and `duty.changed`; the MCP default, Hard switch consults and `list_people` follow them; next, step 3: built-in behaviour follows duties.
- 2026-11-14 · step 5: Settings › Duties, the duties on the Role card and People, and the Office Manager's `duties` Proposal applied all or none; next, steps 3 and 4, then step 6.
- 2026-11-14 · step 4: Agent Stages name a Role or a duty; the built-ins name Implements and Onboards and repairs Projects (migration 0149, with `stage_runs.role_key`); a duty Stage runs as its holder at Stage start and keeps its person; unheld duties are flagged, hold Tasks and refuse Start; next, step 3 and step 6.
