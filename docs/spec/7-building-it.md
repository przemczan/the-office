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
- **Build tasks** are files in the new repo, `docs/tasks/NN-slug.md`: Goal and Definition of Done (with how to check it), Read first, Steps (each small, ending in a commit), Progress (the log a session updates as it goes, which replaces a handover). Each fits a few sessions. The repo's CLAUDE.md tells every session to resume from the task's Progress and first unchecked step, and to tick and log before each commit. Tier 1 is sliced by [24](../../.scratch/the-office/issues/24-slice-tier-1.md) into [docs/tasks/](../tasks/README.md), with the build defaults it chose and a coverage table; later tiers when they are reached.
