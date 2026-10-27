# 17 · Settings, and the tier 1 acceptance run

Status: in progress

## Goal

Settings gains the rest of its tier 1 sections, Office limits and Appearance, next to Skills from task 07. Then tier 1 is proven as a whole: one real piece of work on the Test Project, from Idea to published change, run by the user the way they would run it instead of a regular Claude Code session.

## Definition of Done

- [x] Settings → Office limits edits the Office-wide limit on running Tasks (default 3) and the Context policy's size threshold (default 30k of what a session's conversation added, [spec 2.5 Defaults](../spec/2.5-context-policy.md#defaults)); a change applies to the next Start or continuation. Check: lower the limit to 1 and see Start refused with the reason. (Run in `tasks.controller.test.ts`: "refuses with the reason once Settings lowers the Office-wide limit to 1"; the threshold in `thread-runner.test.ts`.)
- [x] Settings → Appearance switches Light, Dark and "Follow the system", kept across reloads. Check: Playwright in each. (`settings.e2e.ts`: "switches Light, Dark and Follow the system, each kept across reloads".)
- [ ] The tier 1 test passes on the Test Project: a real Task is planned in a Thread with the Planner, runs a built-in Pipeline with a Gate added for this Task, passes the Gate on the Changes tab and publishes, and every Thread shows its Context policy label and token counts. Check: the run, logged below with its Task, tokens per Thread and the PR or merge.
- [ ] The Office runs on Linux: the service starts there, adds the Test Project, and runs a Quick fix Task through to a Gate. Check: on the Linux system the user names (a WSL distribution or another machine), logged below.
- [ ] The user has said whether they would pick The Office over a regular Claude Code session for that piece of work, and every problem the run surfaced is written down for them with a proposed fix. Check: the Progress log.

## Read first

Each step names what it needs.

Leave out: the Pipeline library, the Notifications grid, the Graphite and Paper palettes and the densities, LAN access and the PIN.

## Steps

- [x] 1. Office settings use cases and API for the two limits, read by Start and the Context policy; the Office limits section. Commit.
  Read: [spec 2.2 Defaults](../spec/2.2-people.md#defaults) (the Office-wide limit), [spec 2.5 Defaults](../spec/2.5-context-policy.md#defaults) (the size threshold); the [Work map](../../apps/service/src/modules/work/MAP.md) (`work_settings` already holds the limit), the [Conversations map](../../apps/service/src/modules/conversations/MAP.md) (`domain/context-policy.ts`, `application/thread-contexts.ts`), the [Settings surface map](../../apps/web/src/surfaces/settings/MAP.md); the Office limits section of [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js), by range.
- [x] 2. The Appearance section on the theme layers from task 03. Commit.
  Read: the Appearance section of [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js), by range; `packages/ui/src/appearance/` and `shell/palette-menu.tsx` in the [web app map](../../apps/web/src/MAP.md).
- [ ] 3. The acceptance run with the user on the Test Project, from capturing the Idea to the published change; log every step, its tokens and anything that got in the way. Commit.
  Read: [spec 3, tier 1](../spec/3-capabilities-by-tier.md#tier-1-the-base) (the test), [test-project.md](test-project.md).
- [ ] 4. The Linux run on the system the user names; log what differed from Windows. Commit.
  Read: [build-defaults.md](build-defaults.md) (Windows and Linux).
- [ ] 5. Write the problems found, each with a proposed fix, and the user's verdict into Progress, mark tier 1 done in [README.md](README.md) and tell the user that tier 2 is sliced next. Commit.
  Read: [coverage.md](coverage.md).

## State

- Settings › Office limits (step 1, `apps/web/src/surfaces/settings/office-limits/`): Desks and Context policy cards, each a stepper that saves on click. Work owns the Office-wide limit (`work_settings`, `PUT /api/settings/office-wide-limit`), Conversations the size threshold (`conversations_settings`, `PUT /api/settings/size-threshold`); both are read at each Start or continuation.
- Settings › Appearance (step 2, `apps/web/src/surfaces/settings/appearance/`): Light, Dark and "Follow the system" as cards with a `PalettePreview` (`packages/ui`); "Follow the system" is the new `followSystem()` of the appearance store, which forgets the kept palette. It stays in the browser, as the rail's Theme menu does; the rail menu still offers only the palettes.
- Left out, as the Definition of Done names neither: the prototype's per-person Task limits, the 5-hour window card, Graphite, Paper and the densities.
- Trap: every test file shares both settings rows. Tests bind `WorkSettingsForTests` / `ConversationsSettingsForTests`; the e2e raises each limit and puts it back.
- Step 3, first run (2026-10-27): "Test task" (`7b8dd556…`, rename the Sync buttons to "Synchronise") planned with the Planner, Quick fix, Implement → Tests → Publish, PR #2 on `office/7b8dd556…`, left open. Threads: Planning 315k shown (input 22, output 2.9k, cache writes 38k, cache reads 274k); Implement 428k shown (input 24, output 3.1k, cache writes 41k, cache reads 384k). No Gate was added, so the Definition of Done's run is still owed: a second Task with a Gate added before Start.
- Found by the user, for step 5: a Task card opens only from its title, not from anywhere on the card; the card's "…" menu is clipped when the board is short; a Stage session that starts opens its chat tab and switches to it, where it should add the tab after the current one without switching; the chat input should send on Enter and break the line on Shift+Enter; "+ Task" asks for a title only, with no hint that the Task is described in planning; a Thread's token count adds cache reads, about 90% of it, so it reads far higher than what the Stage budget counts (which leaves cache reads out).
- Next: the second run with a Gate, then the user's verdict.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next. The detail goes in the commit body. -->

- 2026-10-27 · step 1: Settings › Office limits edits the Office-wide limit (Work) and the Context policy's size threshold (Conversations), each read at the next Start or continuation; next, step 2, Appearance.
- 2026-10-27 · step 2: Settings › Appearance switches Light, Dark and Follow the system, kept in the browser; next, step 3, the acceptance run on the Test Project with the user.
