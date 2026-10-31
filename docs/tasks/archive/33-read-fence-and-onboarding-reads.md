# Progress log: 33 · The read fence in the hook, and what onboarding reads

Moved from [33-read-fence-and-onboarding-reads.md](../33-read-fence-and-onboarding-reads.md) when the task was done. One line per commit, newest last.

- 2026-10-31 · step 0: the task file, from task 32's two findings and the user's answers; next, step 1, the engine check with the read fence off.
- 2026-10-31 · step 1: `permissions.read-fence-off` shows the engine's read fence refuses commands the hook allows and that with it off only the hook fences the file tools, the same on Windows and Linux; §6 and §5.6 amended; next, step 2, the service without the fence.
- 2026-10-31 · step 2: sessions run without the engine's read fence and with `claudeMdExcludes` over the instruction files above their folder (found: without the fence `~/.claude/CLAUDE.md` loaded); Glob braces judged one by one; two fence checks retired, the engine check green on both platforms; next, step 3, `read_local_repository`.
- 2026-10-31 · step 3: `read_local_repository` lists the local branches, the checked-out one marked, and reads one folder inside the repository on request, refusing any that leaves it; next, step 4, the live run on the LXC.
- 2026-10-31 · step 4: on the LXC with Devops on Haiku, an onboarding chat read a sub-folder through `read_local_repository` with nothing refused, once its instructions said the tool is the only way in (the first chat still tried Grep twice); the Onboard Task's `;`-compound commands ran; task done.
