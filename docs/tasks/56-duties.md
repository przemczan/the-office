# 56 · Duties: built-in jobs any hired Role can hold

Status: done

Run in The Office itself as the Initiative `b62c4d5e-a0f3-45e0-8ee5-fc748fee214c`: each step below is one of its Tasks, which carries the step's plan.

## Goal

Every built-in job that today belongs to a fixed Role key becomes a duty, held by whichever hired Role the user sets in Settings › Duties, each held by today's Role by default ([spec 2.2](../spec/2.2-people.md#defaults), "Duties"). Renaming a Role or hiring different Roles under other keys keeps every duty and built-in Pipeline working; a duty nobody holds falls back to the user, except Default person to talk to, which falls back to the Caretaker. The Role card and People show the duties each person holds, and on an Office with nobody hired the Caretaker guides setting up, drafting the hires and duty assignments as Proposals.

## Definition of Done

- [x] Spec 2.1–2.4, 2.6, 2.7, 3, 4, 5.4, 6 and 8 and the glossary describe duties. Check: the Gate of the Initiative's first Task.
- [x] The duty model and its Office setting, each duty held by its default Role key until set, with the rules of "Who holds a duty". Check: service tests.
- [x] Built-in behaviour (the chat tools, calls, Consultations on failures, MCP tool hard switches, notifications, planning, shaping, onboarding, Skill installs) follows duties instead of Role keys. Check: service tests on the scripted engine adapter.
- [x] The built-in Pipelines and Stage templates name duties, each Stage resolved to the duty's holder when it starts; a duty nobody holds flags its Pipelines and refuses Start. Check: service tests.
- [x] Settings › Duties, and the duties held on the Role card and People; buttons and tabs name the holder or the fallback. Check: web tests and an e2e test.
- [x] On an Office with nobody hired, People's empty state and the preset list show each preset's duties and capabilities, and the Caretaker drafts the hires and duty assignments as Proposals. Check: service and e2e tests.
- [x] `npm run verify` passes. Check: the closing Task's run.

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
- [x] 4. Built-in Pipelines name duties, resolved to the Role holding them at Stage start (Task 030470d2).
      Read: `apps/service/src/modules/pipelines/MAP.md`, [spec 2.3](../spec/2.3-pipelines.md#defaults) "A Stage names a Role or a duty", [spec 5.4](../spec/5.4-the-engine.md#defaults).
- [x] 5. Settings › Duties, and the duties on the Role card and People (Task a3b96a29).
      Read: `apps/web/src/surfaces/settings/MAP.md`, `apps/web/src/surfaces/people/MAP.md`, [UI rules](../spec/4.1-ui-rules.md), [spec 4](../spec/4-ux-direction.md) "Settings › Duties" and "Duties on screen".
- [x] 6. The Caretaker guides setting up an Office with nobody hired, and the close: `npm run verify`, the Progress log to the archive, the task set to done here and in the README (Task 4507fb56).
      Read: `apps/web/src/surfaces/people/MAP.md`, [spec 2.2](../spec/2.2-people.md#defaults) "Setting up an Office with nobody hired".

## State

Done: the spec describes duties, People keeps them, built-in behaviour outside People follows them, Pipelines' Stages may name them, the user sees and sets them, and the Caretaker sets up an Office with nobody hired.

- People: `domain/duties.ts` (`DUTIES`, `dutyHolding`, `dutiesHeldBy`, `dutyChangeProblems`, `mcpToolDefault`), table `duty_assignments` (migration `0148_duties.sql`, a row only for a duty set), `Duties` (list, `holderOf`, `heldBy`, `changeProblems`, `change`, `changeAll` with `from`, `weighedWithHires`), the `DutyChangeChecks` registry, `DutyHolderChanged` → web `duty.changed`, `GET`/`PUT /api/settings/duties[/:duty]`. `people/index.ts` exports only `CARETAKER` of the keys. Presets answer `duties` (`dutiesSuitedTo`).
- Set-up (step 6): People's `OfficeSetup` (hires from presets or scratch and duty changes, all or none in one transaction through `OfficeSetupRepository`); Conversations' `office-setup` Proposal, drafted only by the Caretaker's `propose_office_setup` (`caretakerChatOfficeTools`: no `propose_role` or `change_role`; `OFFICE_SETUP_RULE` in its instructions). Web: People's set-up hint while nobody is hired (`office-setup-hint.tsx`), "Suits:" in the Hire dialog, the card in `shell/conversation/office-setup-changes.tsx`.
- Work: shaping opens with the holder of Shapes Initiatives, planning with the holder of Plans (`work/domain/duties.ts`, refusals pointing to Settings › Duties; planning by hand still works); causes record the acting person (`by: Author`); `Initiative.planningThreadIds` (migration `0149_initiative_planning_threads.sql`, backfilled) tells planning from shaping Threads.
- Conversations: chat, Stage and Consultation tools and instructions follow `Duties.heldBy` (`HeldDuties`); a session keeps `heldDuties` and the Context policy starts fresh on `duties-changed`; the Caretaker holds none. A `duties` Proposal of an Office setting (`DutyProposals`, `propose_office_setting` with `duties: { duty, holder }[]`) applies all or none through `Duties.changeAll`.
- Pipelines: `putTo` is the holder of Asked first when a Stage runs out of tries, left out while unheld; `StageDecisions` passes over a holder who can't be consulted. Notifications: Office kinds from the Default person to talk to or the Caretaker; Initiative done from the shaper.
- Pipelines (step 4): an Agent Stage names `role` or `duty`, never both (`stageWorker`, `singleStageProblems`); the built-ins and their templates name Implements and Onboards and repairs Projects (migration `0150_stage_duties.sql`, which also adds `stage_runs.role_key`). `staffedStages` gives a duty Stage its latest run's Role, else the holder, at each move; the run records it; `workedBy` on a Task's Stages; an unheld duty is flagged, holds started Tasks (`StaffingHolds` hears `DutyHolderChanged`) and refuses Start in Work (`withDutiesHeld`). People weighs a duty by its holder (`withDutiesResolved`) and refuses a duty change that puts a named duty on an incapable engine.
- Web: Settings › Duties (`surfaces/settings/duties/`), the Role card's Duties value and People's "N duties" mark, shared words in `shell/duty-words.ts` (also `STAGE_DUTIES` and `dutyHolder` for the Stage form's "Who works it", which offers Plans, Implements, Reviews and Onboards and repairs Projects first); `shell/use-duty-holder.ts`, `shell/duty-unheld-note.tsx` (links to `/settings/duties`), `useShaper`/`usePlanner`, Ask buttons and the Initiative's tabs by holder, `serviceDown` from cached duties.
- Follow-up: the Stage words naming "Settings › Duties" (service refusals and flags, the web Stage form's hint) are still plain text; link them to `/settings/duties`.
- Trap: `DutyHolderChanged` is only for the user's changes (a set-up applied is one); hires and let-gos change holders in effect without it. Service tests use `DutyRepositoryForTests`, `OfficeSetupRepositoryForTests` for a set-up, `DutiesStandIn` (conversations) and `KnownPeopleForTests.hold` (work); People's real `Duties` counts a default key only while that Role is hired. The e2e test restores `duty_assignments` in the records; never leave Implements or Reviews unheld in e2e. Sibling steps add migrations too: check the number and the journal when merging.
- Known, not from steps 3 or 4: three `devops-proposals.full.test.ts` tests applying an onboarding Proposal get 422 ("There is no Task": the Onboard Task's worktree is opened before the Task exists).

## Progress

The log is in [archive/56-duties.md](archive/56-duties.md).
