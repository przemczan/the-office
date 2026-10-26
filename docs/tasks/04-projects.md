# 04 · Projects: the record, commands and the Projects page

Status: done

## Goal

The Projects module and its surface: the user adds a Project by hand (its path, base branch, mark, commands, publishing mode and default Pipeline), sees it in a list and on its own page, and edits its commands directly. The Pipelines module starts here with the three built-in Pipelines as data, since a Project names its default. This is the first business module, so it also sets the pattern later modules copy.

## Definition of Done

- [x] The user adds the Test Project from the Projects page, and it survives a service restart. Check: add it, restart, reload.
- [x] A path that isn't a git repository, or a base branch that doesn't exist, is refused with a reason before saving. Check: try both.
- [x] The Project page shows commands, default Pipeline and publishing; editing a command saves it, and the toast says running Tasks keep the command they started with. Check: edit the test command.
- [x] Full, Quick fix and Document exist as Pipeline data (Stages, Roles or commands, on-failure loops, optional flags), readable through the API; the default Pipeline picker lists them. Check: API test and the picker.
- [x] Every state change emits a domain event, and the open page updates from it. Check: change a command in one tab, see it in another.
- [x] The Test Project is named in [README.md](README.md). Check: read it.

## Read first

- [Spec §2.1](../spec/2.1-work.md) (Project), [§2.3](../spec/2.3-pipelines.md), [§9](../spec/README.md#defaults) (commands edited directly in tier 1).
- `apps/service/README.md` (the module template from task 02).
- Click-through: [app/projects.js](../../.scratch/the-office/prototypes/app/projects.js), the `projects` and `pipelines` entries of [app/data.js](../../.scratch/the-office/prototypes/app/data.js), and the Stage shape in [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js).

Build from the Projects surface: the list of Project cards, "Add a Project" as a form, the page with Commands, Default Pipeline and Publishing. The Onboarding block becomes the environment check in task 05; the Skills block comes in task 07; the Work block in task 10. Leave out: asking Devops to onboard or to propose a command change, and the Project filter.

## Steps

- [x] 1. Ask the user which real Project is the Test Project, and record it in [README.md](README.md). Commit.
- [x] 2. Pipelines module, domain only: Pipeline and Stage as data (kind Agent, Script or Gate; Role or command key; brief; limits; session; on failure "go back to Stage X at most N times"; optional), the three built-ins as seed data with tests that each is valid, and a read use case with its API. Commit.
- [x] 3. Projects module, domain and persistence: Project (name, path, base branch, mark label and colour, commands install, build, lint and test, publishing mode push + PR or merge (Publish is run by The Office's own git code, task 14, so it is a mode rather than a free command), default Pipeline, skills switch), its rules (path is a git repository, base branch exists, the default Pipeline exists), the Drizzle tables and repository, and domain events. Commit.
- [x] 4. Use cases and API: add, list, read, edit commands, change publishing and default Pipeline; contracts in `packages/contracts`. Commit.
- [x] 5. The Projects surface in `apps/web`: the list, the add form, the Project page with its blocks, live updates from events. Commit.
- [x] 6. Check on the Test Project: add it, edit a command, change the default Pipeline, restart the service; log what was seen. Commit.

## Progress

The log is archived in [archive/04-projects.md](archive/04-projects.md).
