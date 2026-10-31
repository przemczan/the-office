# 32 · The fixes task 31's run found

Status: in progress

## Goal

The four problems task 31's live run found are fixed before tier 3 starts, so a Role's history names who changed it, chat and planning Agents stop wasting calls on the shell, an Onboard with nothing to fix ends on its own, and the CTO can add a Task with its dependency in one Proposal.

## Definition of Done

- [ ] A Role change made through `change_role` names the Agent who made it in the Role's history, as a Proposal's does. Check: a service test; `GET /roles/:key/changes` after a held call shows the proposer.
- [ ] A chat's and a planning Thread's shell refusal, and their instructions, say that pipes and other commands than the listed read-only git are refused, and to read with Read and Grep. Check: a service test of the refusal's words.
- [ ] An Onboard Task whose repository needed no fixes reports its Definition of Done met without asking the user to Mark Done. Check: a service test.
- [ ] The CTO's `add-task` on an Initiative takes the Tasks the new one waits for, written straight while shaping and carried by the Proposal once active, applied with the Task. Check: a service test; the Initiative's e2e if its card shows the edit.
- [ ] Each fix seen once on the LXC with the Planner, Devops and the CTO on Haiku, with tokens logged. Check: the driver's output, summarised in State; `npm run verify` and `npm run verify:linux` pass.

## Read first

- Task 31's State in [its file](31-after-tier-2-fixes.md): what the run showed and the LXC set-up.

Leave out: tier 3; the phone (task 28, postponed); problems not listed here. A new problem found here goes to Progress and is fixed here only if it is small and in a file the step already changes; otherwise it waits for the user.

Decided with the user on 2026-10-31: these four are fixed in their own task, before tier 3.

## Steps

- [x] 0. Write this file and link it from the README. Commit.
- [x] 1. The proposer and the dependency: `RoleOfficeTools.change` passes the Agent's Role to `RoleService.reword`, which hands it to `changeCard`'s `proposedBy`; `InitiativeEdit`'s `add-task` gains `blockedBy` (the `add_task` tool, `newTaskOf`, the Proposal's contract and card), checked by the dependency rules when drafted and when applied. Commit.
  Read: the [People](../../apps/service/src/modules/people/MAP.md), [Conversations](../../apps/service/src/modules/conversations/MAP.md) and [Work](../../apps/service/src/modules/work/MAP.md) maps; `conversations/adapters/office-tools/role-office-tools.ts`; `work/domain/initiative-edit.ts`; `work/adapters/office-tools/shaping-office-tools.ts`.
- [x] 2. The shell refusal's words and Onboard's Definition of Done: `OfficeRules`' read-only git refusal names pipes and points to Read and Grep, matched by the chat and planning instructions; the Onboard Definition of Done's publish line holds when nothing needed fixing. Commit.
  Read: the [Engine map](../../apps/service/src/modules/engine/MAP.md); `engine/domain/office-rules.ts`; `conversations/domain/session-instructions.ts`; `work/domain/onboarding.ts`, `planning.ts`.
- [ ] 3. On the LXC, from a copy of HEAD at `/root/the-office-31` on its own data: each fix seen once; stop the service and its compose project after; close the task. Commit.
  Read: the memory note on the LXC; task 31's State.

## State

- Step 1: `change_role` names its caller as proposer (`HeldCalls`' `proceed` carries `roleKey` → `RoleService.reword(key, words, proposedBy)`); the CTO's `add-task` has `blockedBy`, judged drafted by `newTaskBlockerProblems` and applied by `createdWaitingFor`, shown on the Proposal card, migration `0059`, seeded and applied in the Initiative e2e.
- Step 2: the read-only git refusal (`office-rules.ts`) reads "…commands other than read-only git (status, diff, log, show), alone or in a pipe; read files with Read and search them with Grep instead."; `READ_ONLY_SHELL_RULE`, exported by Engine, is quoted in the chat, planning and shaping instructions (shaping too: the CTO's same profile). The Onboard Definition of Done's last statement now holds in the Onboard Stage, before Publish, and with no fixes ("…made in the worktree for Publish to ship…; a repository that needed none meets this as it is."), and the Plan says to report it met then. Devops reports in the Onboard Stage, before Publish, so the old "are published" could never be reported met. Publish with nothing to ship is already done (`publish.test.ts`); whether Haiku now reports it is for step 3.
- Next, step 3, on the LXC: each fix once, Planner, Devops and the CTO on Haiku, tokens logged.
- The LXC: task 31's copy `/root/the-office-31` (port 4331, compose `office31` on 5462, data `/root/office-data-31`) and task 30's (4330, `office30`) are stopped, their data kept; start with `docker compose -p office31 up -d postgres` and `npm start` there with `/root/.local/bin` on PATH. Driver `/root/o31.mjs`.

## Progress

- 2026-10-31 · step 0: this file written from task 31's findings (the user's word: before tier 3); next, step 1, the proposer and the dependency.
- 2026-10-31 · step 1: `change_role` names its caller as the Role change's proposer; the CTO's `add-task` takes `blockedBy`, judged when drafted and applied, shown on the Proposal card (migration 0059); next, step 2, the shell refusal's words and Onboard's Definition of Done.
- 2026-10-31 · step 2: the read-only git refusal names pipes and Read and Grep, quoted by the chat, planning and shaping instructions; the Onboard Definition of Done's publish statement holds before Publish and with no fixes; next, step 3, the live run on the LXC.
