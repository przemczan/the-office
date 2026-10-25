# 04 · Projects: the record, commands and the Projects page

Status: in progress

## Goal

The Projects module and its surface: the user adds a Project by hand (its path, base branch, mark, commands, publishing mode and default Pipeline), sees it in a list and on its own page, and edits its commands directly. The Pipelines module starts here with the three built-in Pipelines as data, since a Project names its default. This is the first business module, so it also sets the pattern later modules copy.

## Definition of Done

- [ ] The user adds the Test Project from the Projects page, and it survives a service restart. Check: add it, restart, reload.
- [ ] A path that isn't a git repository, or a base branch that doesn't exist, is refused with a reason before saving. Check: try both.
- [ ] The Project page shows commands, default Pipeline and publishing; editing a command saves it, and the toast says running Tasks keep the command they started with. Check: edit the test command.
- [ ] Full, Quick fix and Document exist as Pipeline data (Stages, Roles or commands, on-failure loops, optional flags), readable through the API; the default Pipeline picker lists them. Check: API test and the picker.
- [ ] Every state change emits a domain event, and the open page updates from it. Check: change a command in one tab, see it in another.
- [ ] The Test Project is named in [README.md](README.md). Check: read it.

## Read first

- [Spec §2.1](../spec.md#21-work) (Project), [§2.3](../spec.md#23-pipelines), [§9](../spec.md#9-defaults-chosen-in-this-spec) (commands edited directly in tier 1).
- `apps/service/README.md` (the module template from task 02).
- Click-through: [app/projects.js](../../.scratch/the-office/prototypes/app/projects.js), the `projects` and `pipelines` entries of [app/data.js](../../.scratch/the-office/prototypes/app/data.js), and the Stage shape in [app/pipelines.js](../../.scratch/the-office/prototypes/app/pipelines.js).

Build from the Projects surface: the list of Project cards, "Add a Project" as a form, the page with Commands, Default Pipeline and Publishing. The Onboarding block becomes the environment check in task 05; the Skills block comes in task 07; the Work block in task 10. Leave out: asking Devops to onboard or to propose a command change, and the Project filter.

## Steps

- [x] 1. Ask the user which real Project is the Test Project, and record it in [README.md](README.md). Commit.
- [x] 2. Pipelines module, domain only: Pipeline and Stage as data (kind Agent, Script or Gate; Role or command key; brief; limits; session; on failure "go back to Stage X at most N times"; optional), the three built-ins as seed data with tests that each is valid, and a read use case with its API. Commit.
- [x] 3. Projects module, domain and persistence: Project (name, path, base branch, mark label and colour, commands install, build, lint and test, publishing mode push + PR or merge (Publish is run by The Office's own git code, task 14, so it is a mode rather than a free command), default Pipeline, skills switch), its rules (path is a git repository, base branch exists, the default Pipeline exists), the Drizzle tables and repository, and domain events. Commit.
- [x] 4. Use cases and API: add, list, read, edit commands, change publishing and default Pipeline; contracts in `packages/contracts`. Commit.
- [x] 5. The Projects surface in `apps/web`: the list, the add form, the Project page with its blocks, live updates from events. Commit.
- [ ] 6. Check on the Test Project: add it, edit a command, change the default Pipeline, restart the service; log what was seen. Commit.

## Progress

<!-- One line per commit, newest last: - YYYY-MM-DD · step N: what changed; what is next; anything surprising. -->
- 2026-10-25 · step 1: the user chose notnullsoft-admin (`D:\Projects\notnullsoft-admin`, base `main`) as the Test Project, recorded in README.md; next is step 2, the Pipelines domain. Surprising: a push to its `main` deploys production, so task 14's Publish check must use push + PR on a throwaway branch.
- 2026-10-25 · step 2: `modules/pipelines` with Stage and Pipeline as data, `stageProblems` (every problem with its Stage), Full, Quick fix and Document as built-ins, `PipelineLibrary` (list, find; exported for Projects) and `GET /api/pipelines[/:id]` with its contract; no tables or events, since nothing changes state yet; next is step 3, the Projects domain and persistence. Decided: the user answered that a Stage's rounds are its on-failure N (task 15 reworded to match); Document is Produce → Review & fix with no Publish, per the spec rather than the click-through; Agent Stages name the Role key `developer`, which task 08 must give the Developer preset; on-failure points at a Stage key, not its name, so renaming keeps it.
- 2026-10-25 · step 3: `modules/projects` with the Project record (id from the name, mark label and colour, the four commands, publishing mode `push-and-pull-request` or `merge`, default Pipeline, `useProjectSkills` on by default), its rules and changes returning `{ project, event }`, four domain events, the `projects` table (migration `0000_projects`) with `update(id, change)` under a row lock, the `Git` port with `CommandLineGit` (`inspect`, `hasBranch`) and `ProjectChecks` for the rules that need git or the Pipelines; the pattern is written up in apps/service/README.md (A business module); next is step 4, the use cases, API and contracts. Decided: Projects never imports Pipelines (the Stage interpreter of task 12 will call Projects), so it asks its own `KnownPipelines` port, bound to `PipelineLibrary.has` in `AppModule`; the repository root is decided by `rev-parse --show-prefix`, never by comparing paths; no path-uniqueness rule (not asked for, and it needs case rules from the platform layer); the skills switch's use case and event wait for task 07.
- 2026-10-25 · step 4: `ProjectService` (add, list, read, change a command, the publishing mode or the default Pipeline; saves, then publishes), `POST/GET /api/projects`, `GET /api/projects/:id`, `PUT /api/projects/:id/commands/:key`, `/publishing-mode` and `/default-pipeline`, with the contracts in `packages/contracts/src/projects.ts`; refusals answer 422 with `reasons` (`ProjectRefusalsFilter`), contract mismatches 400 (`ContractPipe` in the platform's HTTP); the four events reach the web as `project.added`, `project.command-changed`, `project.publishing-mode-changed` and `project.default-pipeline-changed`, each with the `projectId`; next is step 5, the Projects surface. The repository's `update` now returns the stored Project when nothing changes, so a no-op edit answers the Project without an event.
- 2026-10-25 · step 5: the Projects surface: the cards with "Add a Project" (a dialog form; the service's reasons listed in it), `/projects/$projectId` with Commands (edited in place, Enter saves, Escape cancels, the toast) and Default Pipeline with Publishing (both selects), live from the four events; the shell gained a page heading with crumb (`usePageHeading`), toasts (`useToast`, the design system's Toast) and `ProjectMark`; refused queries (4xx) are no longer retried; `apps/web/e2e/projects.e2e.ts` covers adding, both refusals, the command edit and toast, the picker's three Pipelines, two tabs and a missing Project; next is step 6, the check on the Test Project. Surprising: the design system's Alert and Toast are `role="status"`, not `alert`, and its RadioGroup's radios have no accessible name.
