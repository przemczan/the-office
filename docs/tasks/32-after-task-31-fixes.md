# 32 · The fixes task 31's run found

Status: done

## Goal

The four problems task 31's live run found are fixed before tier 3 starts, so a Role's history names who changed it, chat and planning Agents stop wasting calls on the shell, an Onboard with nothing to fix ends on its own, and the CTO can add a Task with its dependency in one Proposal.

## Definition of Done

- [x] A Role change made through `change_role` names the Agent who made it in the Role's history, as a Proposal's does. Check: a service test; `GET /roles/:key/changes` after a held call shows the proposer.
- [x] A chat's and a planning Thread's shell refusal, and their instructions, say that pipes and other commands than the listed read-only git are refused, and to read with Read and Grep. Check: a service test of the refusal's words.
- [x] An Onboard Task whose repository needed no fixes reports its Definition of Done met without asking the user to Mark Done. Check: a service test.
- [x] The CTO's `add-task` on an Initiative takes the Tasks the new one waits for, written straight while shaping and carried by the Proposal once active, applied with the Task. Check: a service test; the Initiative's e2e if its card shows the edit.
- [x] Each fix seen once on the LXC with the Planner, Devops and the CTO on Haiku, with tokens logged. Check: the driver's output, summarised in State; `npm run verify` and `npm run verify:linux` pass.

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
- [x] 3. On the LXC, from a copy of HEAD at `/root/the-office-31` on its own data: each fix seen once; stop the service and its compose project after; close the task. Commit.
  Read: the memory note on the LXC; task 31's State.

## State

- Done. Step 1: `change_role` names its caller as proposer (`HeldCalls`' `proceed` carries `roleKey` → `RoleService.reword(key, words, proposedBy)`); the CTO's `add-task` has `blockedBy`, judged drafted by `newTaskBlockerProblems`, applied by `createdWaitingFor`, on the Proposal card, migration `0059`. Step 2: the read-only git refusal names pipes and Read and Grep, and `READ_ONLY_SHELL_RULE` puts the same words in the chat, planning and shaping instructions; the Onboard Definition of Done's last statement holds in the Onboard Stage and with no fixes.
- The LXC run (2026-10-31, `/root/the-office-31` at HEAD, its own data, every Role on Haiku at low effort), tokens as in, out, cache written, cache read:
  - The Planner's chat read a file with Read alone (4, 988, 27,026, 25,127). Its planning Thread used Grep and Read, no shell; its `change_role` was held, allowed once, and the Developer's version 3 shows `proposedBy: planner` (20, 3,618, 36,388, 285,793).
  - The CTO, in a fresh Initiative's Thread: while shaping, two `add_task` calls, the second waiting for the first, written straight; once active, one Proposal carrying `blockedBy`, applied, the new Task waiting (16, 1,324, 28,224, 189,365). The old Initiative's resumed Thread still drafted the dependency apart, as its own history from task 31 did; declined.
  - Devops onboarded `/root/notnullsoft-admin-32` (task 31's fixed base, branch `office-32-base`, bare origin, merge): the chat's Proposal (10, 2,391, 36,457, 133,306), then the Onboard Task Done in 50 s with no Decision and nothing published (18, 2,336, 37,514, 275,520).
- Found, waiting for the user (Progress): the engine's own wordless refusal ("requires approval… no approval surface") of Devops' compound commands with `;` or `${PIPESTATUS}`; Devops' onboarding chat reaching for `git branch --list`, Glob and Read outside its folders after `read_local_repository`.
- The LXC: the 4331 service and compose `office31` are stopped, data kept in `/root/office-data-31`.

## Progress

The log is archived in [archive/32-after-task-31-fixes.md](archive/32-after-task-31-fixes.md).
