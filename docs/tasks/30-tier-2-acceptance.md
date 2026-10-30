# 30 · The tier 2 acceptance run

Status: in progress

## Goal

Tier 2 is proven as a whole: a day's work on the Test Project run through The Office on Linux, covering every tier 2 item of [spec 3](../spec/3-capabilities-by-tier.md#tier-2-the-all-day-workspace) but the phone, the way the user would use it all day. Every problem the run surfaces is written down with a proposed fix, and the user gives the verdict. Coverage row for task 30 in [coverage.md](coverage.md).

## Definition of Done

- [x] The service runs from a copy of HEAD on the LXC (10.1.1.66) with its own Postgres and data directory, and the Test Project is onboarded through Devops. Check: the run, logged in State.
- [ ] Each scenario below runs end to end through the API, with each Task's tokens and anything that got in the way logged. Check: the driver's one-line-per-step output, summarised in State; the service log free of errors not explained there.
- [ ] Every problem found is written down with a proposed fix; a fix is built here only when it blocks the run. Check: the Progress log.
- [ ] The user has read the problems and said whether they would run all their Projects' work through The Office all day from the desk. Check: their verdict in State.

## Read first

- [Test Project](test-project.md); the memory note on the LXC (copy, Postgres, ports).
- [coverage.md](coverage.md), tier 2 rows: what each scenario must touch.

Leave out: the phone (task 28, postponed); start at login; the after-tier-2 fixes in the README; real Projects other than the Test Project.

How the run works (decided with the user on 2026-10-30): on the LXC for the day, Test Project only; Claude drives through the API with one driver script kept out of the repo (in the scratchpad, as tier 1's `linux-run.mjs`) that prints one line per step, and reviews the results itself; every Role on Haiku at low effort, a Role raised only if Haiku can't do its job, logged; Tasks kept tiny (labels, text). Publish merges into a throwaway base branch made from the clone's local `main` (the clone's bundle origin is gone). Excluded live checks on the LXC: task 06's (no otel-lgtm) and task 09's (doesn't build, README's after-tier-2 list). The user's look at the skills flow (carried from task 25) is replaced by Claude's review; the user gives the verdict only.

## Steps

- [x] 0. Settle how the run works with the user; write this file, link it from the README, update coverage. Commit.
- [x] 1. Set up: stop task 17's service and `docker compose -p office17 down` (the user's word); copy HEAD to `/root/the-office-30`, `npm ci`, build; Postgres `office30` on 5452, service on 4330, `OFFICE_DATA_DIR=/root/office-data-30`, telemetry off; clone the Test Project to `/root/notnullsoft-admin-30`. The driver script; hire Devops, CTO and Office Manager where not hired, on Haiku. Onboard the Test Project through Devops (the `project` Proposal and its Onboard Task). Commit.
  Read: [build-defaults.md](build-defaults.md) (Linux); the Projects and People controllers' routes, by their maps.
- [ ] 2. Pipelines: one Pipeline library edit, one Project command changed by a Devops Proposal and applied. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md).
- [ ] 3. The CTO and parallel work: an Initiative shaped with the CTO into 2–3 tiny Tasks, one depending on another (Start refused while blocked); two Tasks changing the same file in progress together, the queue for Start, the overlap warning, a conflict at Publish through the Resolve Stage, the Project's Test and a Gate; "Initiative done". Tags, search, a saved view and the Project filter on those Tasks. Commit.
  Read: the [Work map](../../apps/service/src/modules/work/MAP.md); spec [2.1](../spec/2.1-work.md) where a state is unclear.
- [ ] 4. People and the Office Manager: hire from scratch, edit a permission profile, one Consultation and one mention, shared memory written, read and deleted, a Role on Claude Code `-p` running a Stage, letting someone go and the staffing hold; the Office Manager capturing an Idea, a Role or settings Proposal, the Office status. Commit.
  Read: the [People](../../apps/service/src/modules/people/MAP.md) and [Conversations](../../apps/service/src/modules/conversations/MAP.md) maps.
- [ ] 5. Skills: install one skill from github.com/anthropics/skills, an update Proposal, a skill drafted from a chat as a Proposal. Commit.
  Read: the [Skills map](../../apps/service/src/modules/skills/MAP.md).
- [ ] 6. Notifications and safety: the kinds × channels grid, quiet hours around now, batching, the at-desk hold; the fire alarm and the all clear. Commit.
  Read: the [Notifications map](../../apps/service/src/modules/notifications/MAP.md); `work/application/fire-alarm-service.ts`.
- [ ] 7. Write each problem with a proposed fix into Progress; ask the user for the verdict; stop the LXC service if the user says so; mark tier 2 done in the README and close the task. Commit.

## State

- Running on the LXC: `/root/the-office-30` (HEAD 7f55d53 plus step 1's fix, built there), Postgres `office30` on 5452, service on 4330 (`/root/office30.log`), data `/root/office-data-30`, the Test Project cloned to `/root/notnullsoft-admin-30` (origin `/root/notnullsoft-admin-17`, local only). Task 17's service and its compose project are down.
- The driver is `o.mjs` in the session's scratchpad, copied to `/root/o.mjs`: `get|post|put|del PATH`, `chat ROLE TEXT`, `say THREAD TEXT`, `log THREAD N`, `run TASK [nostart]`, `threads TASK`, `staff`. Six presets hired (Jan, Ada, Ola, Bob, Nina, Marta), all on Haiku at low effort.
- Onboarded through Devops: Proposal `3157bdb7…` applied, Project `notnullsoft-admin` (merge, Quick fix), Onboard Task `ef2e8d55…` done in 50 s, nothing to fix; Devops chat 1.9k out, 150k cache reads; Onboard 2.1k out, 36k writes, 200k reads.
- Found, for step 7: (A) on a fresh Office the first chat failed, `bases/` not made with no Project, fixed here (`BaseCheckouts.refresh`); (B) Devops can't read the repository it is asked to onboard (a chat reads only `bases/`), so the user has to type the commands; (C) a refused `/tmp` redirect reads "no approval surface", which says nothing to the Agent about why.
- Decided with the user: as in How the run works; task 17's LXC service stopped.
- Next: step 2, Pipelines.

## Progress

- 2026-10-30 · step 0: how the run works settled with the user; this file written; next, step 1, the LXC set-up and onboarding the Test Project through Devops.
- 2026-10-30 · step 1: the service on the LXC, six presets on Haiku, the Test Project onboarded through Devops; a fresh Office now makes `bases/` before its first chat; next, step 2, Pipelines.
