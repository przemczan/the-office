# 56 · Duties: built-in jobs any hired Role can hold

Status: in progress

Run in The Office itself as the Initiative `b62c4d5e-a0f3-45e0-8ee5-fc748fee214c`: each step below is one of its Tasks, which carries the step's plan.

## Goal

Every built-in job that today belongs to a fixed Role key becomes a duty, held by whichever hired Role the user sets in Settings › Duties, each held by today's Role by default ([spec 2.2](../spec/2.2-people.md#defaults), "Duties"). Renaming a Role or hiring different Roles under other keys keeps every duty and built-in Pipeline working; a duty nobody holds falls back to the user, except Default person to talk to, which falls back to the Caretaker. The Role card and People show the duties each person holds, and on an Office with nobody hired the Caretaker guides setting up, drafting the hires and duty assignments as Proposals.

## Definition of Done

- [x] Spec 2.1–2.4, 2.6, 2.7, 3, 4, 5.4, 6 and 8 and the glossary describe duties. Check: the Gate of the Initiative's first Task.
- [x] The duty model and its Office setting, each duty held by its default Role key until set, with the rules of "Who holds a duty". Check: service tests.
- [x] Built-in behaviour (the chat tools, calls, Consultations on failures, MCP tool hard switches, notifications, planning, shaping, onboarding, Skill installs) follows duties instead of Role keys. Check: service tests on the scripted engine adapter.
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
- [x] 3. Built-in behaviour follows duties instead of Role keys (Task e48c3213).
      Read: `apps/service/src/modules/conversations/MAP.md`, `apps/service/src/modules/notifications/MAP.md`, `apps/service/src/modules/work/MAP.md`.
- [ ] 4. Built-in Pipelines name duties, resolved to the Role holding them at Stage start (Task 030470d2).
      Read: `apps/service/src/modules/pipelines/MAP.md`, [spec 2.3](../spec/2.3-pipelines.md#defaults) "A Stage names a Role or a duty", [spec 5.4](../spec/5.4-the-engine.md#defaults).
- [ ] 5. Settings › Duties, and the duties on the Role card and People (Task a3b96a29).
      Read: `apps/web/src/surfaces/settings/MAP.md`, `apps/web/src/surfaces/people/MAP.md`, [UI rules](../spec/4.1-ui-rules.md), [spec 4](../spec/4-ux-direction.md) "Settings › Duties" and "Duties on screen".
- [ ] 6. The Caretaker guides setting up an Office with nobody hired, and the close: `npm run verify`, the Progress log to the archive, the task set to done here and in the README (Task 4507fb56).
      Read: `apps/web/src/surfaces/people/MAP.md`, [spec 2.2](../spec/2.2-people.md#defaults) "Setting up an Office with nobody hired".

## State

Steps 1–3 are done: the spec describes duties, People keeps them, and built-in behaviour outside People follows them; the built-in Pipelines, the screens and the Caretaker's set-up don't yet.

- People: `domain/duties.ts` (`DUTIES`, `dutyHolding`, `dutiesHeldBy`, `dutyChangeProblems`, `mcpToolDefault`), table `duty_assignments` (migration 0137), `Duties` (list, `holderOf`, `heldBy`, `change`, `changeAll`), `DutyChangeChecks`, `DutyHolderChanged` → web `duty.changed`, `GET`/`PUT /api/settings/duties[/:duty]`. `people/index.ts` exports only `CARETAKER` of the keys now; `built-in-pipelines.ts` keeps its own `devops` key until step 4.
- Work: shaping opens with the holder of Shapes Initiatives, planning with the holder of Plans (`work/domain/duties.ts`, refusals pointing to Settings › Duties; planning by hand still works); causes record the acting person (`by: Author`); `Initiative.planningThreadIds` (migration 0138, backfilled) tells planning from shaping Threads.
- Conversations: chat, Stage and Consultation tools and instructions follow `Duties.heldBy` (`HeldDuties`); a session keeps `heldDuties` and the Context policy starts fresh on `duties-changed`; the Caretaker holds none. Pipelines: `putTo` is the holder of Asked first when a Stage runs out of tries, left out while unheld. Notifications: Office kinds from the Default person to talk to or the Caretaker; Initiative done from the shaper.
- Web: `shell/use-duty-holder.ts`, `shell/duty-unheld-note.tsx` (plain words "Settings › Duties": no `/settings/duties` page yet; step 5 makes them a link), `useShaper`/`usePlanner`, Ask buttons and the Initiative's tabs by holder, `serviceDown` from cached duties.
- Trap: tests stand in for duties with `DutiesStandIn` (conversations) and `KnownPeopleForTests.hold` (work); People's real `Duties` counts a default key only while that Role is hired.
- Known, not from this step: three `devops-proposals.full.test.ts` tests applying an onboarding Proposal get 422 ("There is no Task": the Onboard Task's worktree is opened before the Task exists).

## Progress

- 2026-11-14 · step 1: spec 2.1–2.4, 2.6, 2.7, 3, 4, 5.4, 6, 8, the README index and the glossary describe duties; this file added; next, step 2: the duty model and setting in People.
- 2026-11-14 · step 2: People owns the eight duties, `duty_assignments` and `Duties` with its API, check registry and `duty.changed`; the MCP default, Hard switch consults and `list_people` follow them; next, step 3: built-in behaviour follows duties.
- 2026-11-14 · step 3: shaping, planning, Stage failures, chat tools and instructions, notifications and the web's Ask buttons and Initiative tabs follow duty holders, with unheld fallbacks; `planningThreadIds` (0138); next, step 4: built-in Pipelines name duties.
