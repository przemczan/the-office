# Progress log: 30 · The tier 2 acceptance run

Moved from [30-tier-2-acceptance.md](../30-tier-2-acceptance.md) when the task was done. One line per commit, newest last.

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
- 2026-10-30 · step 7: the user's verdict, yes after the fixes; B–K added to the README's after-tier-2 list; the LXC service left up; tier 2 done.
