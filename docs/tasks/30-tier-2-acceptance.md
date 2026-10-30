# 30 · The tier 2 acceptance run

Status: done

## Goal

Tier 2 is proven as a whole: a day's work on the Test Project run through The Office on Linux, covering every tier 2 item of [spec 3](../spec/3-capabilities-by-tier.md#tier-2-the-all-day-workspace) but the phone, the way the user would use it all day. Every problem the run surfaces is written down with a proposed fix, and the user gives the verdict. Coverage row for task 30 in [coverage.md](coverage.md).

## Definition of Done

- [x] The service runs from a copy of HEAD on the LXC (10.1.1.66) with its own Postgres and data directory, and the Test Project is onboarded through Devops. Check: the run, logged in State.
- [x] Each scenario below runs end to end through the API, with each Task's tokens and anything that got in the way logged. Check: the driver's one-line-per-step output, summarised in State; the service log free of errors not explained there.
- [x] Every problem found is written down with a proposed fix; a fix is built here only when it blocks the run. Check: the Progress log.
- [x] The user has read the problems and said whether they would run all their Projects' work through The Office all day from the desk. Check: their verdict in State.

## Read first

- [Test Project](test-project.md); the memory note on the LXC (copy, Postgres, ports).
- [coverage.md](coverage.md), tier 2 rows: what each scenario must touch.

Leave out: the phone (task 28, postponed); start at login; the after-tier-2 fixes in the README; real Projects other than the Test Project.

How the run works (decided with the user on 2026-10-30): on the LXC for the day, Test Project only; Claude drives through the API with one driver script kept out of the repo (in the scratchpad, as tier 1's `linux-run.mjs`) that prints one line per step, and reviews the results itself; every Role on Haiku at low effort, a Role raised only if Haiku can't do its job, logged; Tasks kept tiny (labels, text). Publish merges into a throwaway base branch made from the clone's local `main` (the clone's bundle origin is gone). Excluded live checks on the LXC: task 06's (no otel-lgtm) and task 09's (doesn't build, README's after-tier-2 list). The user's look at the skills flow (carried from task 25) is replaced by Claude's review; the user gives the verdict only.

## Steps

- [x] 0. Settle how the run works with the user; write this file, link it from the README, update coverage. Commit.
- [x] 1. Set up: stop task 17's service and `docker compose -p office17 down` (the user's word); copy HEAD to `/root/the-office-30`, `npm ci`, build; Postgres `office30` on 5452, service on 4330, `OFFICE_DATA_DIR=/root/office-data-30`, telemetry off; clone the Test Project to `/root/notnullsoft-admin-30`. The driver script; hire Devops, CTO and Office Manager where not hired, on Haiku. Onboard the Test Project through Devops (the `project` Proposal and its Onboard Task). Commit.
  Read: [build-defaults.md](build-defaults.md) (Linux); the Projects and People controllers' routes, by their maps.
- [x] 2. Pipelines: one Pipeline library edit, one Project command changed by a Devops Proposal and applied. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md).
- [x] 3. The CTO and parallel work: an Initiative shaped with the CTO into 2–3 tiny Tasks, one depending on another (Start refused while blocked); two Tasks changing the same file in progress together, the queue for Start, the overlap warning, a conflict at Publish through the Resolve Stage, the Project's Test and a Gate; one Task on the Proof of concept Pipeline (its publish target); "Initiative done". Tags, search, a saved view and the Project filter on those Tasks. Commit.
  Read: the [Work map](../../apps/service/src/modules/work/MAP.md); spec [2.1](../spec/2.1-work.md) where a state is unclear.
- [x] 4. People and the Office Manager: hire from scratch, edit a permission profile, one Consultation and one mention, shared memory written, read and deleted, a Role on Claude Code `-p` running a Stage, letting someone go and the staffing hold; the Office Manager capturing an Idea, a Role or settings Proposal, the Office status. Commit.
  Read: the [People](../../apps/service/src/modules/people/MAP.md) and [Conversations](../../apps/service/src/modules/conversations/MAP.md) maps.
- [x] 5. Skills: install one skill from github.com/anthropics/skills, an update Proposal, a skill drafted from a chat as a Proposal. Commit.
  Read: the [Skills map](../../apps/service/src/modules/skills/MAP.md).
- [x] 6. Notifications and safety: the kinds × channels grid, quiet hours around now, batching, the at-desk hold; the fire alarm and the all clear. Commit.
  Read: the [Notifications map](../../apps/service/src/modules/notifications/MAP.md); `work/application/fire-alarm-service.ts`.
- [x] 7. Write each problem with a proposed fix into Progress; ask the user for the verdict; stop the LXC service if the user says so; mark tier 2 done in the README and close the task. Commit.

## State

- The run is done on the LXC; the service is still up there for the user: `/root/the-office-30` on port 4330 (`ssh -L 4330:127.0.0.1:4330`), Postgres `office30` on 5452, log `/root/office30.log`, data `/root/office-data-30`. Projects: `notnullsoft-admin` (clone `/root/notnullsoft-admin-30`, origin the bare `/root/notnullsoft-admin-30-origin.git`) and `scratch` (`/root/scratch-30`, origin `/root/scratch-30-origin.git`). Task 17's service and compose project are down.
- Driver: `o.mjs` and the step scripts in the session's scratchpad, copied to `/root`. Every Role on Haiku at low effort, none raised; the Developer left on Claude Code `-p` with Run installs on consult the CTO; the Office-wide limit 4.
- Covered (steps 1–6, details in Progress and the commit bodies): onboarding through Devops; the library editor and Devops' Pipeline and Project-commands Proposals; an Initiative shaped with the CTO, its dependency, an overlap, the queue, a conflict resolved at Publish, Proof of concept, "Initiative done"; tags, search, the Project filter, a Saved view; the Office Manager's Idea, status, mention, hire and settings Proposals; a hire from scratch; a Consultation; shared memory; `-p`; letting go and hiring back; a skill from github.com/anthropics/skills, an update Proposal, a drafted skill; the grid, quiet hours and their summary, batching, the at-desk hold; the fire alarm and the all clear.
- Tokens: Now's figure for the day was 4.93M (cache reads included), 11 Tasks touched; a Haiku Implement is 0.4–1.7k out and 50–165k cache reads, a Planning turn 0.6–2.5k out and 78–193k reads.
- The service log holds no ERROR or WARN line since step 1's fix. Two Publish failures came from the run's own set-up (a non-bare origin, then `scratch` with no remote); each Decision named the cause, and "Run Publish once more" published once it was fixed.
- Checked after the first pass: the Reviewer's permission profile edited (web off) and read back, card version up; Marta's Link card to Bob about the Initiative (none to Ada, whose chat is off, as it should be); an Initiative mentioned as the `@` picker writes it (`/work/initiatives/<id>`) read from its record; an Office-wide memory note in a new Planner chat's Brief; Task 6's stage runs show Publish's conflict, then `office:resolve`, `office:resolve-test` and `office:resolve-gate`, then Publish; the user's Pause, like letting go, holds a Stage once its turn ends (`stage-interpreter.ts`), so H is as built.
- Not run live, covered by service tests only: an Agent's own Consultation with escalation up to two steps and a Consultant answering it (`consultations.test.ts`, `consult.test.ts`); an enforced Hard switch's call held for approval (`held-calls.test.ts`, `role-office-tools.test.ts`); the CTO's Proposals on an active Initiative (`initiative-proposals.test.ts`). The user decides whether they are run live.
- Problems A–K, each with a proposed fix, are in Progress (steps 6 and 7). A is fixed (986080c); the rest wait for the user.
- The user's verdict (2026-10-30): yes, they would run all their Projects' work through The Office all day from the desk, after the fixes. B–K went to the README's after-tier-2 list (none is harder later); the three items above stay with the service tests; the LXC service is left up for them.
- Done: tier 2 is closed, the phone left out (task 28, postponed). Next: the after-tier-2 fixes, before tier 3.

## Progress

The log is archived in [archive/30-tier-2-acceptance.md](archive/30-tier-2-acceptance.md), with the problems the run surfaced, each with a proposed fix.
