# 30 · The tier 2 acceptance run

Status: in progress

## Goal

Tier 2 is proven as a whole: a day's work on the Test Project run through The Office on Linux, covering every tier 2 item of [spec 3](../spec/3-capabilities-by-tier.md#tier-2-the-all-day-workspace) but the phone, the way the user would use it all day. Every problem the run surfaces is written down with a proposed fix, and the user gives the verdict. Coverage row for task 30 in [coverage.md](coverage.md).

## Definition of Done

- [x] The service runs from a copy of HEAD on the LXC (10.1.1.66) with its own Postgres and data directory, and the Test Project is onboarded through Devops. Check: the run, logged in State.
- [x] Each scenario below runs end to end through the API, with each Task's tokens and anything that got in the way logged. Check: the driver's one-line-per-step output, summarised in State; the service log free of errors not explained there.
- [x] Every problem found is written down with a proposed fix; a fix is built here only when it blocks the run. Check: the Progress log.
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
- [x] 6. Notifications and safety: the kinds × channels grid, quiet hours around now, batching, the at-desk hold; the fire alarm and the all clear. Commit.
  Read: the [Notifications map](../../apps/service/src/modules/notifications/MAP.md); `work/application/fire-alarm-service.ts`.
- [ ] 7. Write each problem with a proposed fix into Progress; ask the user for the verdict; stop the LXC service if the user says so; mark tier 2 done in the README and close the task. Commit.

## State

- The run is done on the LXC; the service is still up there for the user: `/root/the-office-30` on port 4330 (`ssh -L 4330:127.0.0.1:4330`), Postgres `office30` on 5452, log `/root/office30.log`, data `/root/office-data-30`. Projects: `notnullsoft-admin` (clone `/root/notnullsoft-admin-30`, origin the bare `/root/notnullsoft-admin-30-origin.git`) and `scratch` (`/root/scratch-30`, origin `/root/scratch-30-origin.git`). Task 17's service and compose project are down.
- Driver: `o.mjs` and the step scripts in the session's scratchpad, copied to `/root`. Every Role on Haiku at low effort, none raised; the Developer left on Claude Code `-p` with Run installs on consult the CTO; the Office-wide limit 4.
- Covered (steps 1–6, details in Progress and the commit bodies): onboarding through Devops; the library editor and Devops' Pipeline and Project-commands Proposals; an Initiative shaped with the CTO, its dependency, an overlap, the queue, a conflict resolved at Publish, Proof of concept, "Initiative done"; tags, search, the Project filter, a Saved view; the Office Manager's Idea, status, mention, hire and settings Proposals; a hire from scratch; a Consultation; shared memory; `-p`; letting go and hiring back; a skill from github.com/anthropics/skills, an update Proposal, a drafted skill; the grid, quiet hours and their summary, batching, the at-desk hold; the fire alarm and the all clear.
- Tokens: Now's figure for the day was 4.93M (cache reads included), 11 Tasks touched; a Haiku Implement is 0.4–1.7k out and 50–165k cache reads, a Planning turn 0.6–2.5k out and 78–193k reads.
- The service log holds no ERROR or WARN line since step 1's fix. Two Publish failures came from the run's own set-up (a non-bare origin, then `scratch` with no remote); each Decision named the cause, and "Run Publish once more" published once it was fixed.
- Checked after the first pass: the Reviewer's permission profile edited (web off) and read back, card version up; Marta's Link card to Bob about the Initiative (none to Ada, whose chat is off, as it should be); an Initiative mentioned as the `@` picker writes it (`/work/initiatives/<id>`) read from its record; an Office-wide memory note in a new Planner chat's Brief; Task 6's stage runs show Publish's conflict, then `office:resolve`, `office:resolve-test` and `office:resolve-gate`, then Publish; the user's Pause, like letting go, holds a Stage once its turn ends (`stage-interpreter.ts`), so H is as built.
- Not run live, covered by service tests only: an Agent's own Consultation with escalation up to two steps and a Consultant answering it (`consultations.test.ts`, `consult.test.ts`); an enforced Hard switch's call held for approval (`held-calls.test.ts`, `role-office-tools.test.ts`); the CTO's Proposals on an active Initiative (`initiative-proposals.test.ts`). The user decides whether they are run live.
- Problems A–K, each with a proposed fix, are in Progress (steps 6 and 7). A is fixed (986080c); the rest wait for the user.
- Next: step 7, the user's verdict; then whether to stop the LXC service, mark tier 2 done in the README and close the task.

## Progress

- 2026-10-30 · step 0: how the run works settled with the user; this file written; next, step 1, the LXC set-up and onboarding the Test Project through Devops.
- 2026-10-30 · step 1: the service on the LXC, six presets on Haiku, the Test Project onboarded through Devops; a fresh Office now makes `bases/` before its first chat; next, step 2, Pipelines.
- 2026-10-30 · step 2: a library Pipeline copied and edited, and Devops' Pipeline and Project-commands Proposals applied on the LXC; next, step 3, the CTO and parallel work.
- 2026-10-30 · step 3: an Initiative shaped with the CTO and done; dependency, overlap, the queue, a conflict resolved at Publish, Proof of concept, tags, search, the Project filter and a Saved view, all on the LXC; next, step 4, People and the Office Manager.
- 2026-10-30 · step 4: the Office Manager's Idea, status, mention and Proposals; a hire from scratch; shared memory; the Developer on `-p`; letting go and hiring back with the staffing hold; next, step 5, Skills.
- 2026-10-30 · step 5: a skill installed from github.com/anthropics/skills and reaching a session, an update Proposal from a local Source, a skill drafted in a chat; next, step 6, Notifications and the fire alarm.
- 2026-10-30 · step 6: the grid, quiet hours with their summary, batching and the at-desk hold, the fire alarm pausing two running Tasks and the all clear resuming them; the problems below written for the user; next, step 7, the verdict. Problems, each with a proposed fix:
  - A. On a fresh Office the first chat failed: `bases/` was made only by a Project's checkout. Fixed in 986080c (`BaseCheckouts.refresh` makes it).
  - B. Devops can't read the repository it is asked to onboard (a chat reads only `bases/`), so the user typed the commands. Fix: a read-only Office tool for Devops' onboarding chat that reads a named local path's top level and its manifest files (package.json, README).
  - C. A refused shell redirect to `/tmp` reads "requires approval, and this session has no approval surface", which doesn't tell the Agent the rule. Fix: name the rule in the refusal ("writes outside the worktree are refused; keep output in the shell").
  - D. Backlog moves on only through Planning, which always starts a Planner turn (78–148k cache reads on Haiku) even when the user writes the Plan. Fix: Planning starts the Planner on the user's first message, not at once (amends spec 2.1).
  - E. A Stage commit's subject is the Agent's summary cut at 72 with "…". Fix: "<Stage>: <Task title>" as the subject, the summary in the body.
  - F. The Office Manager's hire card named the person by the title ("Docs Writer"). Fix: the hire tool asks for a first name apart from the title, and refuses a name equal to it.
  - G. A chat's Brief carries only Office-wide memory notes, so a Project note the Planner saved in a chat was not read in the next chat. Fix: a chat's Brief carries every note, each labelled with its Project, since a chat reads every Project.
  - H. Letting someone go pauses their Task at the end of their turn, so the let-go Developer finished all of Implement first (9.9k out, 620k reads). Fix: say so in the let-go confirmation, or end the turn as Stop does; the user's choice.
  - I. Chat Agents (Planner, Iris, Devops) try shell commands first and are refused ("only read-only git"), a wasted call each time. Fix: a chat session's instructions say its shell runs only read-only git, and to read files with Read and Grep.
- 2026-10-30 · step 7, first part: the items the first pass missed were run (a permission profile, a Link card, an Initiative mention, memory in a Brief, Resolve's Test and Gate); three are left to the service tests (see State). Two more problems:
  - J. A Task's record, as `read_task` gives it, has no history: Marta said Task 8 "shows no pause" though letting the Developer go had paused it. Fix: the record lists the Task's state changes with who or what made each.
  - K. In a chat, an Initiative named by its bare id can't be read (no `read_initiative` there; only a mention's link carries its record), while a Task's or Idea's can. Fix: offer `read_initiative` in every chat, as `read_task` and `read_idea` are.
