# 12 · The Stage interpreter: Start, Agent and Script Stages, loops

Status: todo

## Goal

The Pipelines module runs a Ready Task: the user starts it (or is told why not), and an interpreter of the Task's Pipeline data walks its Stages. Agent Stages run a session briefed from the record and end with a flat result envelope and a Handover note; Script Stages run a Project command with no model call; The Office commits each Stage's work and checks git after it. On-failure loops, round limits and budgets ask the user, never fail silently. Gates and Publish come in task 14; Stop, Pause and barge-in in task 13.

## Definition of Done

- [ ] Start is refused with the reason when the Project already has a Task in progress, the Role's person is at their Task limit, or the Office-wide limit (default 3) is reached; Waiting on you and Paused Tasks count. Check: domain tests of each refusal, and the reason on the Task page.
- [ ] The interpreter is one generic walk over Stage data: no class or method per Stage, each Stage's run state owned by its own run record. Check: code review against [research §12](../../.scratch/the-office/research/factory-reference.md#12-cross-cutting-costs-to-avoid-repeating), and a test Pipeline of arbitrary Stages run by the scripted adapter.
- [ ] An Agent Stage gets a session as its Stage declares (fresh by default; continue only when the same Role did the previous Stage) with a Brief of Task title, Plan, Definition of Done, the Stage's brief, earlier results, answered Decisions, the diff summary and the Attachment list; it ends done, needs a Decision, or failed, validated against its schema with one resume-based correction. Check: scripted-adapter tests, including an invalid result corrected once.
- [ ] After each Agent Stage The Office commits its work with a message from its result and Handover note, checks HEAD and the branch are where it left them, and ends the session's leftover processes. Check: a test where the Agent moves HEAD, and one that leaves a process running.
- [ ] A Script Stage runs its command in the worktree with the Project's environment, re-runs a failing test command once before failing it, filters its output, records the result, and restores the worktree after test runs. Check: tests with a flaky and a failing command.
- [ ] "On failure go back to Stage X at most N times" loops with the error in the next Brief; a round limit or a failure with no retries left opens a Decision for the user (allow more rounds, continue with the issues recorded, guidance for one more round, drop); a budget limit, checked before every engine call against all of the Task's usage, opens a Decision to raise it. Check: scripted-adapter tests of each.
- [ ] An optional Stage is skipped when every statement of the Definition of Done is already reported met; the Task is Done when the Pipeline completes with the Definition of Done met, and asks the user when it isn't. Check: tests of both.
- [ ] One trace per Task with a span per Stage and per engine call, and the Stage's tokens on the Task page. Check: Grafana and the page after a run.

## Read first

- [Spec §2.3](../spec.md#23-pipelines), [§2.5](../spec.md#25-context-policy) (Stage boundaries, the Brief, the Handover note), [§5.5](../spec.md#55-git-and-isolation), [§9](../spec.md#9-defaults-chosen-in-this-spec) (Start, limits).
- [research/factory-reference.md](../../.scratch/the-office/research/factory-reference.md) §6 (result envelope), §7 (budgets and loop limits), §11.3, §11.5, §11.6 (the prompt must name the allowed commands), §12.
- Reference, behaviour only, in `D:\Projects\software-factory\`: `packages\shared\src\stage\stage-result.ts`, `apps\runner\src\stages\stage-executor.ts`, `apps\runner\src\pipeline\pipeline-gates.ts`, `apps\runner\src\telemetry\usage-ledger.ts`, `apps\runner\src\testing\test-runner.ts`, `apps\runner\src\stages\retry-guidance-injector.ts`. `apps\runner\src\pipeline\task-pipeline.ts` is what the interpreter must not become.
- Click-through: Start and the Stages block in [app/task.js](../../.scratch/the-office/prototypes/app/task.js), [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js).

## Steps

- [ ] 1. Start in Work: the refusals and their reasons, the Office-wide limit as an Office setting (default 3, editable in task 17), Ready → In progress, the Task's Pipeline copy locked as it starts. Commit.
- [ ] 2. The interpreter in Pipelines: Stage run records, the walk, outcomes, on-failure loops with per-loop counters, the events each transition emits, all against the scripted adapter. Commit.
- [ ] 3. Agent Stages: the person for the Role, the Stage's session through the Context policy, the Brief, the result envelope schema (flat, `if status = done then required`), one correction, the Handover note, the Stage Thread on the Task's conversation. The brief names the commands the Agent may run. Commit.
- [ ] 4. After an Agent Stage: commit, HEAD and branch check, process cleanup; a Stage that moved HEAD fails with the reason. Commit.
- [ ] 5. Script Stages: the command runner from task 05, the flake re-run, worktree restore after tests, results on the Stage. Commit.
- [ ] 6. Limits: round limits and budgets checked before each engine call, the Decisions they open and what each answer does, accepted issues recorded for the commit message; optional Stage skipping and the Done check. Commit.
- [ ] 7. The Task page: the Stages block with each Stage's state, person or command, time, tokens, session kind and Handover note; Start with its reason. Commit.
- [ ] 8. Check on the Test Project: start the Task planned in task 11 on a copy of Quick fix without its Publish Stage, set through the API (Publish is task 14, the editor task 15), and discard the branch afterwards; log each Stage's tokens, session and result. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
