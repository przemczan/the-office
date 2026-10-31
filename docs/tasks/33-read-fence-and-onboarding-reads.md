# 33 · The read fence in the hook, and what onboarding reads

Status: in progress

## Goal

The two problems task 32's live run found are fixed before tier 3 starts: a shell command the Office rules allow runs, instead of being refused by the engine's own read fence, and Devops reads what onboarding needs through `read_local_repository` instead of reaching for tools that are refused outside its folders.

## Definition of Done

- [ ] The engine check shows that with `permissions.blockReadsOutsideWorkingDirectories` off and the Office's hook on, the shell commands the engine refused in task 32's run (`${PIPESTATUS[0]}`, a bare `node -v`, `git -C <another folder>`) run, and Read, Grep and Glob outside the session's folders are refused by the hook, each way a path can be given. Check: the check's entry in [engine-check.md](../engine-check.md), on Windows and on the LXC.
- [ ] Sessions run with the setting off, and the hook alone fences the file tools. Spec §6 says so. Check: a service test of the session settings and of every fenced path shape; §6 and the code agree.
- [ ] `read_local_repository` lists the repository's local branches with the current one marked, and takes an optional folder inside the repository that it reads as it reads the top level. Check: a service test.
- [ ] Each fix seen once on the LXC with Devops on Haiku, with tokens logged: an onboarding chat reads a sub-folder through the tool and no Glob, Read or git outside its folders is refused; a compound command with `${PIPESTATUS[0]}` runs in a Task. Check: the driver's output, summarised in State; `npm run verify` and `npm run verify:linux` pass.

## Read first

- Task 32's State in [its file](32-after-task-31-fixes.md): what the run showed and the LXC set-up.
- [Spec §6](../spec/6-permissions-and-safety.md): the build rules this task amends.

Leave out: tier 3 (the engine's sandbox, stronger containment); the phone (task 28, postponed); problems not listed here. A new problem found here goes to Progress and is fixed here only if it is small and in a file the step already changes; otherwise it waits for the user.

Decided with the user on 2026-10-31: the engine's read fence is turned off and the hook does all the fencing, proven first by the engine check; `read_local_repository` gains the branches and a folder argument, staying agnostic of each Project's stack.

## Steps

- [x] 0. Write this file and link it from the README. Commit.
- [ ] 1. The engine check: a `permissions` check that runs task 32's refused commands and Read, Grep and Glob outside (absolute paths, `..`, an absolute Glob pattern, Grep's `glob`, the engine's task-output folder) with the setting off under a hook that fences as the Office's does; record it in engine-check.md, retire or re-word `permissions.file-tool-fence` and `skills.plugin-folder-reads` as the result says; amend §6's build rules. Run on Windows and the LXC. Commit.
  Read: [engine-check.md](../engine-check.md) "How a check runs" and "Permissions"; `tools/engine-check/src/office-options.ts`; `checks/permissions/file-tool-fence.ts`, `hook-sees-every-call.ts`.
- [ ] 2. The service: `sessionSettings` drops the setting (and `additionalDirectories` if only the fence needed it); `agentAction` and `OfficeRules`' read fence close any path shape step 1 found open; the engine check's own options match. Commit.
  Read: the [Engine map](../../apps/service/src/modules/engine/MAP.md); `engine/adapters/claude-code/session-settings.ts`, `tool-actions.ts`; `engine/domain/office-rules.ts` (the read fence, around `outside this session's folders`).
- [ ] 3. `read_local_repository`: the local branches, the current one marked, and an optional `folder` read like the top level, refused outside the repository; the tool's and the onboarding Proposal's descriptions say so. Commit.
  Read: the [Projects map](../../apps/service/src/modules/projects/MAP.md); `projects/application/local-repositories.ts`; `projects/adapters/office-tools/project-office-tools.ts`; `work/adapters/office-tools/onboarding-office-tools.ts`.
- [ ] 4. On the LXC, from a copy of HEAD on its own data: each fix seen once; stop the service and its compose project after; close the task. Commit.
  Read: the memory note on the LXC; task 32's State.

## State

- Step 0 done. Found in task 32's transcripts on the LXC (`/root/.claude/projects/-root-office-data-31-*`): every engine refusal there names `permissions.blockReadsOutsideWorkingDirectories` at the end of its message ("What required approval: …"): a variable in braces, code on stdin (`node -v`), `git -C` naming another folder, reads outside. The engine asks on these even after the hook's `allow` ("an ask rule, a safety check … requires the full permission pipeline"), and with no approval surface it refuses.
- Next: step 1, the engine check.

## Progress

- 2026-10-31 · step 0: the task file, from task 32's two findings and the user's answers; next, step 1, the engine check with the read fence off.
