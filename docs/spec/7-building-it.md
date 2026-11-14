# 7. Building it

From [13](../../.scratch/the-office/issues/13-first-slice.md).

- **Who and where:** the user builds The Office in Claude Code sessions, in this repository, `D:\Projects\the-office` (`origin` `git@github.com:przemczan/the-office.git`). The spec, the glossary and the design system are committed; the plan (map, tickets, research findings, the click-through) lives in `.scratch/the-office/`, git-ignored. The Software Factory repository (`D:\Projects\software-factory`) stays untouched as reference; code paths cited in the research findings refer to it. Nothing is pushed until the user says so.
- **Surface by surface,** each built complete (real UI from the click-through, its modules, real Agents) and done when it works on a real Project. Order for tier 1:
  1. **Spike:** run the [22](../../.scratch/the-office/issues/22-skills-per-session.md) "Could not confirm" checks and the permission build rules of [6](6-permissions-and-safety.md) against a live session on the pinned versions.
  2. **Projects:** add a Project, commands, the environment check; builds the service foundation, the database, git and worktrees.
  3. **People:** Role cards from presets, skills, chat with the Planner; proves the engine, the per-session skills, permissions and the Context policy.
  4. **Work and the Task page:** Ideas, Tasks, planning in a Thread, the Pipeline run, Gates, publishing.
  5. **Now:** Needs you, Running, Since you left, the status strip, Notifications.
  6. **Settings:** limits and appearance.
- **New work goes through The Office** as Tasks on its own Project (decided with the user on 2026-11-14). The spec and the [glossary](../../GLOSSARY.md) are committed in the repo; the build tasks that built tiers 1 to 3 as files in the repo are retired. The repo's [AGENTS.md](../../AGENTS.md) holds its instructions for every session, with the Project's layout and the defaults the spec leaves open, and its `CLAUDE.md` imports it.
