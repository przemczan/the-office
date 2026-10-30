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
- [x] 2. Pipelines: one Pipeline library edit, one Project command changed by a Devops Proposal and applied. Commit.
  Read: the [Pipelines map](../../apps/service/src/modules/pipelines/MAP.md).
- [x] 3. The CTO and parallel work: an Initiative shaped with the CTO into 2–3 tiny Tasks, one depending on another (Start refused while blocked); two Tasks changing the same file in progress together, the queue for Start, the overlap warning, a conflict at Publish through the Resolve Stage, the Project's Test and a Gate; one Task on the Proof of concept Pipeline (its publish target); "Initiative done". Tags, search, a saved view and the Project filter on those Tasks. Commit.
  Read: the [Work map](../../apps/service/src/modules/work/MAP.md); spec [2.1](../spec/2.1-work.md) where a state is unclear.
- [x] 4. People and the Office Manager: hire from scratch, edit a permission profile, one Consultation and one mention, shared memory written, read and deleted, a Role on Claude Code `-p` running a Stage, letting someone go and the staffing hold; the Office Manager capturing an Idea, a Role or settings Proposal, the Office status. Commit.
  Read: the [People](../../apps/service/src/modules/people/MAP.md) and [Conversations](../../apps/service/src/modules/conversations/MAP.md) maps.
- [x] 5. Skills: install one skill from github.com/anthropics/skills, an update Proposal, a skill drafted from a chat as a Proposal. Commit.
  Read: the [Skills map](../../apps/service/src/modules/skills/MAP.md).
- [ ] 6. Notifications and safety: the kinds × channels grid, quiet hours around now, batching, the at-desk hold; the fire alarm and the all clear. Commit.
  Read: the [Notifications map](../../apps/service/src/modules/notifications/MAP.md); `work/application/fire-alarm-service.ts`.
- [ ] 7. Write each problem with a proposed fix into Progress; ask the user for the verdict; stop the LXC service if the user says so; mark tier 2 done in the README and close the task. Commit.

## State

- Running on the LXC: `/root/the-office-30` (HEAD 7f55d53 plus step 1's fix, built there), Postgres `office30` on 5452, service on 4330 (`/root/office30.log`), data `/root/office-data-30`, the Test Project cloned to `/root/notnullsoft-admin-30` (origin `/root/notnullsoft-admin-17`, local only). Task 17's service and its compose project are down.
- The driver is `o.mjs` in the session's scratchpad, copied to `/root/o.mjs`: `get|post|put|del PATH`, `chat ROLE TEXT`, `say THREAD TEXT`, `log THREAD N`, `run TASK [nostart]`, `threads TASK`, `staff`. Six presets hired (Jan, Ada, Ola, Bob, Nina, Marta), all on Haiku at low effort.
- Onboarded through Devops: Proposal `3157bdb7…` applied, Project `notnullsoft-admin` (merge, Quick fix), Onboard Task `ef2e8d55…` done in 50 s, nothing to fix; Devops chat 1.9k out, 150k cache reads; Onboard 2.1k out, 36k writes, 200k reads.
- Found, for step 7: (A) on a fresh Office the first chat failed, `bases/` not made with no Project, fixed here (`BaseCheckouts.refresh`); (B) Devops can't read the repository it is asked to onboard (a chat reads only `bases/`), so the user has to type the commands; (C) a refused `/tmp` redirect reads "no approval surface", which says nothing to the Agent about why.
- Pipelines: "Quick fix (copy)" made from Quick fix and edited by hand into "Quick fix with lint" (`7d8b3ce5…`: Implement > Lint > Tests > Publish); Devops then drafted, in one chat (1.3k out, 116k reads), a `pipeline` Proposal adding the Gate "Look before publish" before Publish and a `project-commands` Proposal making Test `npm test --silent`; both applied and read back.
- Decided with the user: as in How the run works; task 17's LXC service stopped.
- CTO and parallel work: Idea → Initiative "Tidy the README" (`94d3157e…`); the CTO asked two questions, then drafted 3 Tasks with one dependency (2.3k out, 162k reads); confirmed, active. Task 1 planned with the Planner (2.5k out, 158k reads), Tasks 2–6 planned by hand after the Planner's turn that Planning always starts. Task 3 refused at Start while blocked; Task 2's Start showed the overlap with Task 1. Task 4 queued at place 1 with the Office-wide limit at 1, started once it was 3 again. Tasks 2 and 4 edited different lines of README.md and merged cleanly; Tasks 5 and 6 rewrote the same line: Task 6, held at its Gate while 5 published, met the conflict, the Developer's Resolve kept both changes (1.4k out, 125k reads), the Test passed, a Gate came again, then Publish. Task 3 on Proof of concept pushed its branch only. The Initiative went done. Each Implement 0.7–1.6k out, 80–125k reads.
- Tags (kept lower-case, once), search by word start, the Project filter (a second Project, `scratch`, added by hand; `inOtherProjects` counts the other's), a Saved view "Conflict checks" (tags + priority).
- The Test Project's origin is now a bare clone, `/root/notnullsoft-admin-30-origin.git` (the non-bare one refused the merge push; the CTO was asked first and passed it on). Its `main` holds Tasks 1, 2, 4, 5, 6.
- More found, for step 7: (D) Backlog moves on only through Planning, which always starts the Planner, even when the user writes the Plan; (E) a Stage commit's subject is the Agent's summary cut at 72 with "…", where the Task's title would read better.
- People and the Office Manager: Marta (one chat, 2.1k out, 199k reads) captured an Idea (CHANGELOG.md), showed the Office status, read a mentioned Task, drafted a `hire` Proposal (applied with the name edited to Iris: she had put the title "Docs Writer" as the name) and an `office-wide-limit` Proposal 3 → 4 (applied). Iris, hired from scratch as a Consultant with no Tasks, read a mentioned Idea in her chat. The Planner saved a Project note to shared memory; a new Planner chat didn't recall it (see G); the note deleted. The Developer moved to Claude Code `-p` with Run installs on "consult the CTO": Task 7 added markdownlint-cli without a hold, right by spec 6 (the Project's own dependencies are a code change). Letting the Developer go while Task 8 ran paused it behind a Decision; hired back, "Resume" finished it. The Consultation itself was seen in step 3 (the CTO on the failed Publish).
- More found, for step 7: (F) the Office Manager's hire card used the title as the person's name; (G) a chat's Brief carries only Office-wide memory notes (`SessionMemory.forBrief(role, undefined)`), so a Project note saved in a chat is not read in the next chat; (H) letting someone go pauses their Task only at the end of their turn, so the let-go Developer finished all of Implement (9.9k out, 620k reads) before the hold.
- The Developer stays on `-p` with Run installs on consult the CTO; the Office-wide limit is 4.
- Skills: Devops listed github.com/anthropics/skills (20 skills at `ca45fc4`) and drafted installing `internal-comms` (0.9k out, 98k reads); applied, reviewed, on, given to Marta, whose next chat named `office:internal-comms` as its one skill. The update path on a local Source (`/root/skill-source-30.git`, tags v1 and v2, `/root/source.sh`): installed at v1 by Devops' Proposal, v2 pushed, the check at the service's start marked the update, Devops drafted the `skill-update` Proposal with notes, applied (stays waiting for review, as before). Iris drafted `changelog-entries` from her chat as a `skill` Proposal (0.8k out), applied, waiting for review.
- Next: step 6, Notifications and safety.

## Progress

- 2026-10-30 · step 0: how the run works settled with the user; this file written; next, step 1, the LXC set-up and onboarding the Test Project through Devops.
- 2026-10-30 · step 1: the service on the LXC, six presets on Haiku, the Test Project onboarded through Devops; a fresh Office now makes `bases/` before its first chat; next, step 2, Pipelines.
- 2026-10-30 · step 2: a library Pipeline copied and edited, and Devops' Pipeline and Project-commands Proposals applied on the LXC; next, step 3, the CTO and parallel work.
- 2026-10-30 · step 3: an Initiative shaped with the CTO and done; dependency, overlap, the queue, a conflict resolved at Publish, Proof of concept, tags, search, the Project filter and a Saved view, all on the LXC; next, step 4, People and the Office Manager.
- 2026-10-30 · step 4: the Office Manager's Idea, status, mention and Proposals; a hire from scratch; shared memory; the Developer on `-p`; letting go and hiring back with the staffing hold; next, step 5, Skills.
- 2026-10-30 · step 5: a skill installed from github.com/anthropics/skills and reaching a session, an update Proposal from a local Source, a skill drafted in a chat; next, step 6, Notifications and the fire alarm.
