# 17 · Settings, and the tier 1 acceptance run

Status: in progress

## Goal

Settings gains the rest of its tier 1 sections, Office limits and Appearance, next to Skills from task 07. Then tier 1 is proven as a whole: one real piece of work on the Test Project, from Idea to published change, run by the user the way they would run it instead of a regular Claude Code session.

## Definition of Done

- [x] Settings → Office limits edits the Office-wide limit on running Tasks (default 3) and the Context policy's size threshold (default 30k of what a session's conversation added, [spec 2.5 Defaults](../spec/2.5-context-policy.md#defaults)); a change applies to the next Start or continuation. Check: lower the limit to 1 and see Start refused with the reason. (Run in `tasks.controller.test.ts`: "refuses with the reason once Settings lowers the Office-wide limit to 1"; the threshold in `thread-runner.test.ts`.)
- [x] Settings → Appearance switches Light, Dark and "Follow the system", kept across reloads. Check: Playwright in each. (`settings.e2e.ts`: "switches Light, Dark and Follow the system, each kept across reloads".)
- [x] The tier 1 test passes on the Test Project: a real Task is planned in a Thread with the Planner, runs a built-in Pipeline with a Gate added for this Task, passes the Gate on the Changes tab and publishes, and every Thread shows its Context policy label and token counts. Check: the run, logged below with its Task, tokens per Thread and the PR or merge. ("Test task #2", 2026-10-27, PR #3; see State.)
- [x] The Office runs on Linux: the service starts there, adds the Test Project, and runs a Quick fix Task through to a Gate. Check: on the Linux system the user names (a WSL distribution or another machine), logged below. (The LXC at 10.1.1.66, 2026-10-27; see State.)
- [ ] The user has said whether they would pick The Office over a regular Claude Code session for that piece of work, and every problem the run surfaced is written down for them with a proposed fix. Check: the Progress log.

## Read first

Each step names what it needs.

Leave out: the Pipeline library, the Notifications grid, the Graphite and Paper palettes and the densities, LAN access and the PIN.

## Steps

- [x] 1. Office settings use cases and API for the two limits, read by Start and the Context policy; the Office limits section. Commit.
  Read: [spec 2.2 Defaults](../spec/2.2-people.md#defaults) (the Office-wide limit), [spec 2.5 Defaults](../spec/2.5-context-policy.md#defaults) (the size threshold); the [Work map](../../apps/service/src/modules/work/MAP.md) (`work_settings` already holds the limit), the [Conversations map](../../apps/service/src/modules/conversations/MAP.md) (`domain/context-policy.ts`, `application/thread-contexts.ts`), the [Settings surface map](../../apps/web/src/surfaces/settings/MAP.md); the Office limits section of [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js), by range.
- [x] 2. The Appearance section on the theme layers from task 03. Commit.
  Read: the Appearance section of [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js), by range; `packages/ui/src/appearance/` and `shell/palette-menu.tsx` in the [web app map](../../apps/web/src/MAP.md).
- [x] 3. The acceptance run with the user on the Test Project, from capturing the Idea to the published change; log every step, its tokens and anything that got in the way. Commit.
  Read: [spec 3, tier 1](../spec/3-capabilities-by-tier.md#tier-1-the-base) (the test), [test-project.md](test-project.md).
- [x] 4. The Linux run on the system the user names; log what differed from Windows. Commit.
  Read: [build-defaults.md](build-defaults.md) (Windows and Linux).
- [ ] 5. Write the problems found, each with a proposed fix, and the user's verdict into Progress, mark tier 1 done in [README.md](README.md) and tell the user that tier 2 is sliced next. Commit.
  Read: [coverage.md](coverage.md).

## State

- Steps 1–2: Settings › Office limits (`settings/office-limits/`; Work owns the Office-wide limit, Conversations the size threshold) and Settings › Appearance (`settings/appearance/`, `followSystem()` in the `packages/ui` appearance store).
- Run 1, "Test task" (`7b8dd556…`): Planner, Quick fix, no Gate, PR #2, left open. Planning 315k shown (output 2.9k, cache writes 38k, cache reads 274k); Implement 428k (output 3.1k, writes 41k, reads 384k).
- Run 2, the tier 1 test, "Test task #2" (`efd9b82e…`): planned with the Planner, Full with a Gate "I need one screenshot" added after Tests. At the Gate the user sent the work back to Tests with feedback (a Script Stage can't read it; Tests reran and the Gate came back), then continued; Review & fix, Publish, PR #3. Planning 273k shown (output 2.7k, writes 11k, reads 260k); Implement 368k (output 2.8k, writes 8.7k, reads 356k); Review & fix 244k (output 2.1k, writes 13k, reads 229k).
- Found by the user, for step 5 (fixes to propose there):
  - Work: a Task card should open from anywhere on it but its buttons; its "…" menu is clipped on a short board; "+ Task" asks for a title only with no hint that planning describes it, and doesn't open the new Task.
  - Planning: "Plan with …" shows nothing until the Planner's first words; Mark Ready should be disabled while it can't succeed, with a checklist of what is missing; marking Ready should be confirmed, as the Task can then be started.
  - Task page: a Stage session that starts switches the chat to its new tab (it should add the tab after the current one, unswitched); the Changes tab opens a file's diff by default and diffs can't be folded.
  - Gate: what the user does at it isn't said; its name read as a requirement for the agents; choosing a Script Stage to send the work back to should say it is a script that can't read the feedback, it only runs again. (Devops isn't hired in tier 1, as spec 2.2 has it.)
  - Chat: Enter should send, Shift+Enter break the line; messages and handover notes need Markdown.
  - Tokens: a Thread's count includes cache reads (~90%); show it without them, with the breakdown and what it means behind an info icon.
- The user's verdict (2026-10-27): they would pick The Office over a regular Claude Code session for this piece of work. PRs #2 and #3 closed and their branches deleted.
- Step 4, Linux (the user named the LXC, 10.1.1.66; Ubuntu 24.04, Node 22.23.3): `git archive HEAD` of 3769f60 to `/root/the-office-17`, `npm ci`, `npm run build`, `npm start` on port 4320 with its own Postgres (`docker compose -p office17 up -d postgres`, port 5442), `OFFICE_DATA_DIR=/root/office-data-17`, telemetry off. Driven through the API (`linux-run.mjs`, kept out of the repo): the Test Project (a clone at `/root/notnullsoft-admin-17`) added, Planner and Developer hired on Haiku at low effort, the Idea shaped and planned, Quick fix with a Gate added before Publish. Implement changed both labels in one commit, Tests passed, the Task waits at the Gate. Planning 59k shown (output 1.3k, writes 31k, reads 27k); Implement 89k (output 1.2k, writes 34k, reads 55k). Nothing differed from Windows: no error in the service's log, paths and the worktree under the data directory as on Windows. The service is left running there for the user to look at through `ssh -L 4320:127.0.0.1:4320`.
- Next: step 5, the problems above each with a proposed fix, tier 1 marked done, then tell the user tier 2 is sliced next.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->

- 2026-10-27 · step 1: Settings › Office limits edits the Office-wide limit (Work) and the Context policy's size threshold (Conversations), each read at the next Start or continuation; next, step 2, Appearance.
- 2026-10-27 · step 2: Settings › Appearance switches Light, Dark and Follow the system, kept in the browser; next, step 3, the acceptance run on the Test Project with the user.
- 2026-10-27 · step 3: two runs on the Test Project; the second, Full with a Gate added, passed the Gate and published PR #3; the user's findings logged in State. Next, the user's verdict and step 4 on Linux.
- 2026-10-27 · step 4: on the LXC the service starts, adds the Test Project and walks a Quick fix Task with an added Gate to that Gate; nothing differed from Windows. Next, step 5, the problems with their fixes.
