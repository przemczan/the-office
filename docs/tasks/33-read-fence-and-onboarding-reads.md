# 33 · The read fence in the hook, and what onboarding reads

Status: done

## Goal

The two problems task 32's live run found are fixed before tier 3 starts: a shell command the Office rules allow runs, instead of being refused by the engine's own read fence, and Devops reads what onboarding needs through `read_local_repository` instead of reaching for tools that are refused outside its folders.

## Definition of Done

- [x] The engine check shows that with `permissions.blockReadsOutsideWorkingDirectories` off, the shell commands the engine refused in task 32's run (`${PIPESTATUS[0]}`, `git -C <another folder>`, a read outside) run once the hook allows them, and that only the hook fences Read, Grep and Glob then. Check: `permissions.read-fence-off` in [engine-check.md](../engine-check.md), recorded on Windows and on the LXC.
- [x] Sessions run with the setting off, and the hook alone fences the file tools, each way a path can be given. Spec §6 says so. Check: a service test of the session settings and of every fenced path shape; §6 and the code agree.
- [x] `read_local_repository` lists the repository's local branches with the current one marked, and takes an optional folder inside the repository that it reads as it reads the top level. Check: a service test.
- [x] Each fix seen once on the LXC with Devops on Haiku, with tokens logged: an onboarding chat reads a sub-folder through the tool and no Glob, Read or git outside its folders is refused; a compound command of the shape the engine refused in task 32 runs in a Task (`${PIPESTATUS[0]}` itself is shown by the engine check, since the model may not choose it). Check: the driver's output, summarised in State; `npm run verify` and `npm run verify:linux` pass.

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
- [x] 3. `read_local_repository`: the local branches, the current one marked, and an optional `folder` read like the top level, refused outside the repository; the tool's and the onboarding Proposal's descriptions say so. Commit.
  Read: the [Projects map](../../apps/service/src/modules/projects/MAP.md); `projects/application/local-repositories.ts`; `projects/adapters/office-tools/project-office-tools.ts`; `work/adapters/office-tools/onboarding-office-tools.ts`.
- [x] 4. On the LXC, from a copy of HEAD on its own data: each fix seen once; stop the service and its compose project after; close the task. Commit.
  Read: the memory note on the LXC; task 32's State.

## State

- Done. Step 1: the engine check `permissions.read-fence-off` (both platforms) shows the engine's read fence refused, past the hook's `allow`, commands it couldn't prove read only inside (a braced variable, `git -C` elsewhere, a read outside), and stopped every later such call (`circuitBreaker: outsideReadsBlocked`); with it off they run and only the hook fences the file tools. Step 2: `sessionSettings` sets the fence `false`, drops `additionalDirectories`, and sets `claudeMdExcludes` over the instruction files above the session's folder (found: without the fence `~/.claude/CLAUDE.md` loaded as Project instructions); Glob braces judged one by one; `permissions.file-tool-fence` and `skills.plugin-folder-reads` retired. Step 3: `read_local_repository` lists local branches and reads one `folder` inside the repository. Step 4: Devops' chat instructions say a repository not yet a Project is read only with that tool (`chatInstructions(card, roleKey)`).
- The LXC run (2026-10-31, `/root/the-office-33` at HEAD plus step 4's instruction, data `/root/office-data-33`, compose `office33` on 5472, service 4333, every Role on Haiku at low effort), tokens as in, out, cache written, cache read:
  - The first onboarding chat, before step 4's instruction, still tried Grep on `apps` and `CLAUDE.md` twice (refused by the hook) before reading `apps/admin-panel` with `folder` (10, 2,254, 35,984, 132,452); its Proposal declined.
  - With the instruction, a fresh chat read the top level, then `folder: "apps/admin-panel"`, and drafted the Project with nothing refused (8, 2,008, 10,866, 119,621); applied.
  - The Onboard Task on `/root/notnullsoft-admin-33` (branch `office-32-base`, bare origin, merge) ended Done in about a minute with no Decision (8, 1,480, 34,166, 96,917). Its first command was `cat package.json 2>/dev/null; ls -la; ls apps 2>/dev/null; git status --short | head; node -v; npm -v`, the shape the engine refused in task 32; it ran, as did three more `;`-compound runs of the checks. The model used no `${PIPESTATUS}` this time.
- The LXC: the 4333 service and compose `office33` are stopped, data kept in `/root/office-data-33`.

## Progress

The log is in [archive/33-read-fence-and-onboarding-reads.md](archive/33-read-fence-and-onboarding-reads.md).
