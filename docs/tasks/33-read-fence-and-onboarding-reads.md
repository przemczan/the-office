# 33 · The read fence in the hook, and what onboarding reads

Status: in progress

## Goal

The two problems task 32's live run found are fixed before tier 3 starts: a shell command the Office rules allow runs, instead of being refused by the engine's own read fence, and Devops reads what onboarding needs through `read_local_repository` instead of reaching for tools that are refused outside its folders.

## Definition of Done

- [x] The engine check shows that with `permissions.blockReadsOutsideWorkingDirectories` off, the shell commands the engine refused in task 32's run (`${PIPESTATUS[0]}`, `git -C <another folder>`, a read outside) run once the hook allows them, and that only the hook fences Read, Grep and Glob then. Check: `permissions.read-fence-off` in [engine-check.md](../engine-check.md), recorded on Windows and on the LXC.
- [x] Sessions run with the setting off, and the hook alone fences the file tools, each way a path can be given. Spec §6 says so. Check: a service test of the session settings and of every fenced path shape; §6 and the code agree.
- [ ] `read_local_repository` lists the repository's local branches with the current one marked, and takes an optional folder inside the repository that it reads as it reads the top level. Check: a service test.
- [ ] Each fix seen once on the LXC with Devops on Haiku, with tokens logged: an onboarding chat reads a sub-folder through the tool and no Glob, Read or git outside its folders is refused; a compound command with `${PIPESTATUS[0]}` runs in a Task. Check: the driver's output, summarised in State; `npm run verify` and `npm run verify:linux` pass.

## Read first

- Task 32's State in [its file](32-after-task-31-fixes.md): what the run showed and the LXC set-up.
- [Spec §6](../spec/6-permissions-and-safety.md): the build rules this task amends.

Leave out: tier 3 (the engine's sandbox, stronger containment); the phone (task 28, postponed); problems not listed here. A new problem found here goes to Progress and is fixed here only if it is small and in a file the step already changes; otherwise it waits for the user.

Decided with the user on 2026-10-31: the engine's read fence is turned off and the hook does all the fencing, proven first by the engine check; `read_local_repository` gains the branches and a folder argument, staying agnostic of each Project's stack.

## Steps

- [x] 0. Write this file and link it from the README. Commit.
- [x] 1. The engine check: `permissions.read-fence-off` runs task 32's refused commands with the setting on and off under a hook that allows them, and the file tools outside with it off; recorded on Windows and the LXC; §6 and §5.6 amended. Commit.
  Read: [engine-check.md](../engine-check.md) "How a check runs" and "Permissions"; `tools/engine-check/src/office-options.ts`; `checks/permissions/file-tool-fence.ts`, `hook-sees-every-call.ts`.
- [x] 2. The service: `sessionSettings` drops the setting and `additionalDirectories`; the hook's read fence is tested, and closed where open, for each path shape (absolute and relative paths, `..`, an absolute Glob pattern, Grep's `glob`, the skills folder, the engine's task-output folder); the engine check's own options match, `permissions.file-tool-fence` retired and `skills.plugin-folder-reads` re-run and re-recorded on both platforms. Commit.
  Read: the [Engine map](../../apps/service/src/modules/engine/MAP.md); `engine/adapters/claude-code/session-settings.ts`, `tool-actions.ts`; `engine/domain/office-rules.ts` (the read fence, around `outside this session's folders`); `tools/engine-check/src/office-options.ts`, `checks/skills/plugin-folder-reads.ts`.
- [ ] 3. `read_local_repository`: the local branches, the current one marked, and an optional `folder` read like the top level, refused outside the repository; the tool's and the onboarding Proposal's descriptions say so. Commit.
  Read: the [Projects map](../../apps/service/src/modules/projects/MAP.md); `projects/application/local-repositories.ts`; `projects/adapters/office-tools/project-office-tools.ts`; `work/adapters/office-tools/onboarding-office-tools.ts`.
- [ ] 4. On the LXC, from a copy of HEAD on its own data: each fix seen once; stop the service and its compose project after; close the task. Commit.
  Read: the memory note on the LXC; task 32's State.

## State

- Found in task 32's transcripts on the LXC (`/root/.claude/projects/-root-office-data-31-*`): every engine refusal there names `permissions.blockReadsOutsideWorkingDirectories` at the end of its message ("What required approval: …"). The engine asks on these even after the hook's `allow`, and with no approval surface it refuses; after one it refuses every later call that would ask (`circuitBreaker: outsideReadsBlocked`).
- Step 1: `tools/engine-check/src/checks/permissions/read-fence-off.ts`, recorded in `expectations.json` for both platforms (the same): fence on, a braced variable, `git -C` elsewhere and `cat` outside are refused past the hook (`node -v` alone runs); fence off, all run and Read, Grep and Glob read outside. Spec §6's build rule and §5.6's grant sentence amended; engine-check.md has the entry, a Runs row and a Spec amendments row.
- Step 2: `sessionSettings` (`engine/adapters/claude-code/session-settings.ts`, both engines) sets the fence `false` explicitly (a Project's `.claude/settings.json` can't turn it on), drops `additionalDirectories`, and sets `claudeMdExcludes` to the instruction files of every folder above the session's (`instructionFilesAbove`). Found here, fixed as a direct cost of the fence going: without it the engine loaded `~/.claude/CLAUDE.md` above the sandbox as Project instructions (`fallback.start` saw it). `agentAction` judges each brace alternative of a Glob pattern and climbs for `..` after a wildcard. The engine check's options match; `permissions.file-tool-fence` and `skills.plugin-folder-reads` retired (their entries kept as history); full run 36/36 on Windows, 35/35 on the LXC after re-recording `read-fence-off` and `hook-sees-every-call`.
- The LXC copy for this task: `/root/the-office-33` (from 31's, `npm ci` done, synced with step 2's working tree, no `.env` yet).
- Next: step 3, `read_local_repository`.

## Progress

- 2026-10-31 · step 0: the task file, from task 32's two findings and the user's answers; next, step 1, the engine check with the read fence off.
- 2026-10-31 · step 1: `permissions.read-fence-off` shows the engine's read fence refuses commands the hook allows and that with it off only the hook fences the file tools, the same on Windows and Linux; §6 and §5.6 amended; next, step 2, the service without the fence.
- 2026-10-31 · step 2: sessions run without the engine's read fence and with `claudeMdExcludes` over the instruction files above their folder (found: without the fence `~/.claude/CLAUDE.md` loaded); Glob braces judged one by one; two fence checks retired, the engine check green on both platforms; next, step 3, `read_local_repository`.
