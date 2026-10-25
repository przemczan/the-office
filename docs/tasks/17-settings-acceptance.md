# 17 · Settings, and the tier 1 acceptance run

Status: todo

## Goal

Settings gains the rest of its tier 1 sections, Office limits and Appearance, next to Skills from task 07. Then tier 1 is proven as a whole: one real piece of work on the Test Project, from Idea to published change, run by the user the way they would run it instead of a regular Claude Code session.

## Definition of Done

- [ ] Settings → Office limits edits the Office-wide limit on running Tasks (default 3) and the Context policy's size threshold (default 30k of what a session's conversation added, spec §9); a change applies to the next Start or continuation. Check: lower the limit to 1 and see Start refused with the reason.
- [ ] Settings → Appearance switches Light, Dark and "Follow the system", kept across reloads. Check: Playwright in each.
- [ ] The tier 1 test passes on the Test Project: a real Task is planned in a Thread with the Planner, runs a built-in Pipeline with a Gate added for this Task, passes the Gate on the Changes tab and publishes, and every Thread shows its Context policy label and token counts. Check: the run, logged below with its Task, tokens per Thread and the PR or merge.
- [ ] The Office runs on Linux: the service starts there, adds the Test Project, and runs a Quick fix Task through to a Gate. Check: on the Linux system the user names (a WSL distribution or another machine), logged below.
- [ ] The user has said whether they would pick The Office over a regular Claude Code session for that piece of work, and every problem the run surfaced is written down for them with a proposed fix. Check: the Progress log.

## Read first

- [Spec §3 tier 1](../spec.md#tier-1-the-base) (the test), [§9](../spec.md#9-defaults-chosen-in-this-spec).
- Click-through: the Office limits and Appearance sections in [app/settings.js](../../.scratch/the-office/prototypes/app/settings.js).

Leave out: the Pipeline library, the Notifications grid, the Graphite and Paper palettes and the densities, LAN access and the PIN.

## Steps

- [ ] 1. Office settings use cases and API for the two limits, read by Start and the Context policy; the Office limits section. Commit.
- [ ] 2. The Appearance section on the theme layers from task 03. Commit.
- [ ] 3. The acceptance run with the user on the Test Project, from capturing the Idea to the published change; log every step, its tokens and anything that got in the way. Commit.
- [ ] 4. The Linux run on the system the user names; log what differed from Windows. Commit.
- [ ] 5. Write the problems found, each with a proposed fix, and the user's verdict into Progress, mark tier 1 done in [README.md](README.md) and tell the user that tier 2 is sliced next. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
