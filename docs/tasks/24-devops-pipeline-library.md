# 24 · Devops: the Pipeline library, Project commands by Proposal, onboarding

Status: in progress

## Goal

The user can hire Devops, who onboards new Projects and looks after the Pipeline library and each Project's commands by Proposal. In Settings › Pipelines the user makes, duplicates, edits and removes Pipelines. A Publish Stage can push the branch only, for a proof of concept. Onboarding starts as a chat with Devops, who drafts the Project; applying it adds the Project and an Onboard Task that makes it build and test in a fresh worktree. Spec [2.1](../spec/2.1-work.md) (Defaults: onboarding), [2.2](../spec/2.2-people.md), [2.3](../spec/2.3-pipelines.md) (Library and its Defaults), [6](../spec/6-permissions-and-safety.md); ticket [08](../../.scratch/the-office/issues/08-pipelines.md); coverage rows §2.3, §2.2 and §2.1, §8, task 24, in [coverage.md](coverage.md).

## Definition of Done

- [x] The Devops preset: hired from its preset with Memory, Chat and Consultant on, Task limit 2, Hard switches Allowed / Consult CTO / Never (no CTO hired: the user). Check: a service test of the preset; Playwright hiring one.
- [ ] The Pipeline library: stored by The Office, the built-ins (Full, Quick fix, Document, Onboard, Proof of concept) seeded once; the user makes a Pipeline from scratch or by duplicating one, edits its name, description and Stages in the shared Stage editor with its flags, and removes one (refused while a Project's default or a not-started Task uses it, and always for Onboard). Saving changes Tasks that haven't started; running ones keep their copy. Check: a service test of the rules and routes; Playwright making, editing and removing one.
- [x] The proof-of-concept target: a Publish Stage publishes by the Project's publishing mode or pushes the branch only; the Proof of concept Pipeline does the latter, and Changes still shows what was pushed. Check: a service test against a real git repository with a bare remote.
- [ ] Devops' Proposals: from a chat or a Stage Thread, Devops proposes a Project's commands and install inputs, or a library Pipeline's Stages; the card shows now and proposed and applies with a click; a stale one is refused. The user still edits commands on the Project page. Check: a service test through the scripted engine; Playwright applying each.
- [ ] Onboarding: "Ask Devops to onboard one" opens a chat; Devops' Project Proposal, applied, adds the Project and its "Onboard" Task, Ready on the Onboard Pipeline; the Project page shows onboarding, onboarded or none. Check: a service test through the scripted engine; Playwright from the chat to the Onboard Task.
- [ ] `npm run verify` and `npm run verify:linux` pass, and the user has looked at hiring Devops, the library editor, a Devops Proposal and onboarding a Project in the running app. Check: the commands; the user's word, logged.

## Read first

- [Pipelines module map](../../apps/service/src/modules/pipelines/MAP.md) (`PipelineLibrary`, `built-in-pipelines.ts`, `pipeline.ts`'s `stageProblems`, Publish) and the [Projects module map](../../apps/service/src/modules/projects/MAP.md) (`ProjectService`, `KnownPipelines`, `TaskPublishing`).
- [Conversations module map](../../apps/service/src/modules/conversations/MAP.md) (Proposals: `proposal.ts`, `ProposalAppliers`, `ProposalOfficeTools`; `session-instructions.ts`'s `chatOfficeTools`).
- The click-through's `settings.js` (`pipelinesSection`), `pipelines.js` (the editor) and `projects.js` (`onboardingBlock`, the Commands block, `project-add`), by grep.

Leave out: Stage templates (tier 3, spec 2.3's Defaults); the click-through's onboarding checklist (the state comes from the Onboard Task); skills from a source and update Proposals (task 25); several Tasks in progress per Project (task 26); the after-tier-2 fixes in the README.

## Steps

- [x] 1. The Devops preset: the preset (responsibilities, instructions, Hard switches, authority), lifting "Devops' comes with its task". Commit.
  Read: `presets.ts` (the CTO's, as the latest), `known-roles.ts`; spec 2.2's capabilities table and spec 6's Hard switch table; the CTO hire e2e in `people.e2e.ts`.
- [x] 2. The library, the service side: a `pipelines` table seeded by its migration with the built-ins (Onboard and Proof of concept added, Proof of concept's Publish as in step 3); `PipelineLibrary` reading it; `POST /pipelines` (new, or a copy of one), `PUT /pipelines/:id` (name, description, Stages, checked as the Stage editor checks), `DELETE /pipelines/:id` with its refusals (a port asking Projects and Work who uses it); events and their WebSocket names. Commit.
  Read: `pipeline-library.ts`, `pipeline.ts`, `stage.ts`, `TaskStagesController.check` (the Role checks); Projects' `KnownPipelines`; Work's not-started Tasks by Pipeline.
- [x] 3. The proof-of-concept target: the Publish Stage's target (the publishing mode, or the branch only), the branch-only push in `TaskPublishing` with the published-from ref, the Stage editor's choice. Commit.
  Read: `domain/publish.ts`, `publish-stage.ts`, Projects' `TaskWorktrees` publish; `shell/pipelines/stage-editor.tsx`.
- [ ] 4. The library editor, the web: Settings › Pipelines (the list with flags, "New Pipeline", "Duplicate", the editor with Save and Discard, Remove with its reason, "Default for … · N not started · N running keep their copy"); Playwright. Commit.
  Read: click-through `settings.js` `pipelinesSection`; the Settings surface map; `edit-task-stages-dialog.tsx` for how the editor is held.
- [ ] 5. Devops' Proposals, the service side: `project-commands` and `pipeline` kinds of `ProposedChange`, their Office tools for Devops in chat and Stage Threads, appliers in Projects and Pipelines refusing a stale Proposal. Commit.
  Read: `proposal.ts`, `ProposalOfficeTools`, `ProposalAppliers`, Work's `InitiativeProposals` (an applier outside Conversations); where a Stage Thread's Office tools are chosen.
- [ ] 6. Devops' Proposals, the web: their cards (now and proposed), "Ask Devops to propose a change" on the Project's Commands, "Ask Devops" on a library Pipeline; Playwright through the scripted engine. Commit.
  Read: `shell/conversation/proposal-card.tsx`; click-through `projects.js` (Commands) and `pipelines.js` (`pipeline-ask-nina`).
- [ ] 7a. Onboarding, the service side: the `project` kind of Proposal and Devops' tool, Work's applier adding the Project through `ProjectService.add` and its "Onboard" Task, Ready on Onboard with its Plan and Definition of Done; the Project's onboarding in its response. Commit.
  Read: `ProjectService.add`, `ProjectChecks`; Work's `TaskService` create and states; `InitiativeProposals`.
- [ ] 7b. Onboarding, the web: "Ask Devops to onboard one" on the Projects page, the Project card, the Project page's Onboarding block and its Task; Playwright from the chat to the Onboard Task. Commit.
  Read: click-through `projects.js` (`onboardingBlock`, `project-add`); the Projects surface map.
- [ ] 8. The user looks at hiring Devops, the library editor, a Devops Proposal and onboarding a Project; `npm run verify:linux`; close the task. Commit.
  Read: [testing](../../apps/service/docs/testing.md) for the live check.

## State

- Built: the Devops preset (`people/domain/presets.ts`, `DEVOPS` in `known-roles.ts`): Nina, Sonnet 5.5 high, edits and runs anything in the worktree; `people.e2e.ts` hires her right after "a Role nobody fills has no page".
- Built: the library, service side. `pipelines` table (`adapters/postgres/pipelines.schema.ts`), seeded by `drizzle/0044_pipelines.sql` from `builtInPipelines` (Onboard: Devops' Onboard, then Verify on the test command back to Onboard twice; Proof of concept: Implement, Tests, Publish). `PipelineLibrary` reads it through `PipelineRepository` in `PipelineLibraryModule`. Writes are `PipelineLibraryEditor` and `PipelineLibraryController` in `PipelinesModule`: `POST /pipelines` (an edit, or `{ copyOf }`), `PUT /pipelines/:id`, `DELETE /pipelines/:id` (422 with reasons, 404), `GET /pipelines/:id/use`. Rules are in `domain/library-pipeline.ts`; the Role checks are shared with the Task's editor through `RoleFillings`; Projects are asked through `ProjectDefaults` (bound to `ProjectService`) and Tasks through `StartedTasks.list`. Events `PipelineAdded`/`Saved`/`Removed`, on the web `pipeline.added`/`saved`/`removed`, which make `["pipelines"]` stale.
- Decided here: new Pipelines get a UUID, never reused; names are unique ignoring case; a copy is "X (copy)", then "(copy 2)", and is never refused. Removal counts every not-started Task on the Pipeline, edited for itself or not, since Start needs it. Save and add refuse what the Task's Stage editor refuses, except a Role nobody fills (never hired or let go), which they only flag: `pipelineEditFlags`, and `POST /pipelines/check` returns `{ problems, flags }` (`pipelineId` names the Pipeline being saved). A Role whose person's Task limit is none is still refused, as spec 2.2 says no Pipeline may name it.
- Built: the proof-of-concept target. `ScriptStage.publishTarget` (`publishing-mode` | `branch-only`, absent = publishing mode; refused on a non-Publish Stage) and the contract's `publishTargetSchema`; `PublishStage` passes it through `TaskPublishing` to Projects' `Publishing.pushBranchOnly` (fetch, nothing-to-publish check, push to the base's remote, published-from ref; no conflict check, no pull request). Publication kind `branch-pushed`. `drizzle/0045_pipeline_publish_stages.sql` sets Proof of concept's target and gives Onboard its Publish (Onboard → Verify → Publish); the Stage editor's "Publishes" choice (`withCommand` drops the target off Publish).
- For step 4: the editor shows `POST /pipelines/check`'s problems (Save refused) and flags (saved anyway). Running or done Tasks may name a removed Pipeline, so the web must show one it can't find.
- Decided with the user (2026-10-28, after step 2): the library accepts an Agent Stage for a Role nobody fills and flags it; the Task's Stage editor still refuses it. Found since: Start refuses when the first Agent Stage's Role is vacant (`task-start.ts`), and a later vacant Stage fails in the runner ("Nobody fills the Role"), as `StaffingHolds` runs only on Resume and RoleLetGo, not on `TaskStarted`; asked the user whether Start should hold instead. Onboard gets a Publish Stage (Onboard → Verify → Publish, by the Project's publishing mode) so Devops' fixes reach the repository.
- Decided with the user (2026-10-28), in spec 2.1's and 2.3's Defaults: onboarding is a chat where Devops drafts the Project, then an Onboard Task; direct edits of commands stay beside Devops' Proposals; the proof-of-concept target pushes the branch only, with no pull request; the library editor makes, duplicates, edits and removes Pipelines, and Devops proposes Pipeline changes; Stage templates wait for tier 3.
- Decided earlier: the built-ins are seeded once and then edited like any; Onboard can't be removed. The Onboard Task is made Ready and waits for the user's Start; its Verify with no Test command fails and goes back to Onboard, where Devops proposes one. The onboarding state comes from the Onboard Task alone. Work applies the Project Proposal, so Projects never imports Work.
- Traps: the service's tests share one database, so tests make their own Pipelines and never change a built-in. `ProjectService.add` doesn't check the environment. A Script Stage reads the Project's commands when it runs. Proposal tools are given per Role in `chatOfficeTools`; Stage Threads choose theirs elsewhere.

## Progress

- 2026-10-28 · task file: sliced into nine steps with the user's answers on onboarding, commands, the proof-of-concept target and the library editor; step 1, the Devops preset, is next.
- 2026-10-28 · step 1: the Devops preset (Nina; Allowed / Consult CTO / Never; Memory, Chat, Consultant on; Task limit 2), its service tests and the Playwright hire; step 2, the library's service side, is next.
- 2026-10-28 · step 2: the `pipelines` table seeded with the five built-ins, `PipelineLibrary` reading it, the editor's add, copy, save, remove and use routes with their refusals and events; step 3, the proof-of-concept target, is next.
- 2026-10-28 · step 3: the library flags a Role nobody fills instead of refusing it (`POST /pipelines/check`, own commit); a Publish Stage's target, the branch-only push keeping Changes, Proof of concept pushing the branch only and Onboard publishing; step 4, the library editor on the web, is next.
