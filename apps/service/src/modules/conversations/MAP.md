# Conversations: module map

**Owns:** Threads, each one engine session (`threads`, `thread_messages`), and The Office's message log; Decisions as cards in the asking Thread (`decisions`), each on a Task: one open at a time in a Thread on a Task, and one per Task in an Initiative's planning Thread (`Thread.openDecisions`; the index `decisions_open_on_task_in_thread` holds one open per Thread and Task); Proposals as cards in the Thread they were drafted in (`proposals`), generic over what they change (`ProposedChange`: a Role's `hire` from scratch, `hire-from-preset` and `change`; the Office settings `office-wide-limit`, `size-threshold` and `office-instructions`; `initiative`, the CTO's change to an active Initiative; Devops' `project-commands`, `pipeline` and `stage-template` (a Stage template's one Stage, kept unread as a Pipeline's Stages are), each with the values now (`from`) and as proposed (`to`), refused once those changed; Devops' `skill-install`, a skill in a Source's folder at its pinned version with its files hash; Devops' `skill-update`, an installed skill's update from and to with notes and its files hash; `skill`, a written skill anyone drafts in their chat) and applied only by the user; Link cards, a message in the Office Manager's chat pointing the user to a person (about a Task when it names one) with a Handover note the user sends themselves (`LinkCards`), whether that person was let go read as the log is (`letGoIn`); an Idea's card in the chat it was captured in and the Office status's card, each only a pointer the web reads live from Work and Now, logged in chat Threads only (`ThreadService.postIdeaCard`, `postOfficeStatus`); the Context policy (resume, fresh, hand off, the Brief, Handover notes) and its size threshold in one row (`conversations_settings`), which Settings › Office limits changes; the Office instructions, each saved text a version (`office_instructions_versions`, `OfficeInstructions`; version 0, never stored, means none), which Settings › Office instructions changes (`OfficeInstructionsChanged` only when a new version was made) and every session gets after who the person is and before their Role's instructions (`SessionPerson`, `personInstructions`), at both session starts (`ThreadRunner`, `StageThreads`): a new session takes the current text and records its version (`ThreadSession.officeInstructionsVersion`), a resume runs with the version it recorded, and one stored before them reads 0, so it keeps its cached prompt; the sessions behind Stage Threads (`ThreadRunner`); tokens per Thread and per Task (`TaskTokens`; `budgetTokensSoFar` is what a Stage's budget checks, leaving people's Threads out; `stageTokensSoFar` gives a Task's Stage Threads' by engine id, which Work's Daily caps read); what the user has seen in a chat (`thread_seen`, one row per chat Thread holding its last message seen, `ChatActivity`, pure `chatActivityOfPeople`): `PUT /threads/:id/seen` moves it forward only and raises `ThreadSeen`, `GET /chats/activity` gives who is answering and who has answered, and a Thread's response carries `answered` and `lastMovedAt`, null outside a chat; a Task's conversation (`TaskConversations`, pure `conversationTabs`): who has a tab, each with their one Thread, whether their Stage runs and the Consultations waiting on them or answered by them, derived from the Task's Threads alone, the Planner's tab also carrying the Initiative's planning Thread the Task is planned in (`planningThreadElsewhere`, from Work through `TaskThreadSetups`), and the person's Thread opened the first time a tab asks, never the Planner's while the Task is planned in its Initiative's Thread; who is working on each Task now (`TaskConversations.peopleWorking`, pure `peopleWorkingOnTasks`, `GET /people-working`, the marks on the board's cards): a person with a Thread on the Task answering and no open Decision, as a Stage Thread stays answering while it waits on one, read in one go from `ThreadRepository.answering()`; each session's Sub-agents and Processes (spec 2.9, `SubAgentsAndProcesses`, tables `sub_agents_and_processes`, `sub_agent_messages`, `process_output`, keyed by the engine session id and the starting call's `callId`): kept from the session's events by a `SessionFollowing` per session, which both runners feed, with a Sub-agent's messages (its `withinToolCall` text and tool calls, and refusals of its calls, summed up as `sessionLogLines` does) and a Process's output in chunks, each numbered per item; the caps (`OUTPUT_KEPT_BYTES` counted after masking, `MESSAGES_KEPT`, `ENDED_ITEMS_KEPT` per session) held by the repository as it adds; Running ones Stopped with the session as its events finish, Stopped by `restart` at startup (`SubAgentsAndProcesses.recover`, beside `InterruptedAnswers.recover` in office.ts), and removed when a fresh session replaces a Thread's (`ThreadRunner.answer`), never a Stage Thread's, whose run keeps them; read by `GET /threads/:id/sub-agents-and-processes`, `…/sub-agents/:callId/messages?after=` and `…/processes/:callId/output?after=`, and sent as `thread.sub-agent-*` and `thread.process-*` web events, the messages and output only to subscriptions scoped to their Thread.

**Talks to:** calls Engine, People (`RoleCards`; `EngineCascade` for the engine and model of every session, in the Thread's Project (while no engine is listed a message is refused in words before it is logged, `ThreadRefused`): a Stage's and a Task Thread's, the context label's (`ThreadContexts`) as the runner asks, none for a chat or an Initiative; `EngineCascadeModule` comes in through `register`'s `imports`), Skills (session skills, prepared with the session's Project, its id included, so Skills counts each Project skill's uses in that Project) and MCP servers (`SessionMcpServers`: a session's servers, prepared and rebuilt beside its skills; those left out lead its Brief, or the first message it is resumed with, through `withLeftOutServers`, which the Thread's log doesn't keep; one the engine failed to start is an `mcp-server-not-started` line in the log, through `sessionLogLines`). Reads Project bases through its `ProjectBases` port, bound to Projects' `BaseCheckouts` in [app.module.ts](../../app.module.ts), and a Project's short record for an Open page through `ProjectRecordSource`, bound to Projects' `ProjectRecords`; a person's comes from People's `PersonRecords`. Work fills `FireAlarmInThreads` as it starts with the fire alarm it keeps, and tells it when it sounds and which Tasks go on at the all clear; `TaskThreadSetups`, with what a Thread on a Task works with (by `taskThreadRequest`: whose, a person's own or not, a first session or not) and readying a Task for a person's Thread, `InitiativeThreadSetups`, with an Initiative's record, instructions and Office tools by the Thread and its person (the CTO's shaping, the Planner's planning; its session reads every Project's base branch, as a chat's does, and gets no `change_role`; only the Planner's gets `open_decision`, with a `taskId` naming one of the Initiative's Tasks), `ThreadService.startOnInitiative` taking the Thread's id from Work when Plan the Initiative keeps it first, and `initiativeThreadInSession` telling Work's planning tools which Initiative's Thread a session is in, and `WorkRecords`, with the records of Tasks, Initiatives and Ideas a message mentions, a Link card's Task title and the ids of a Task's Attachments (`initiativeTaskAttachmentIds` too, undefined for a Task that isn't the Initiative's, which refuses a planning Thread's Decision on it), since Work calls Conversations. Pipelines and Work reach it through ports bound to `StageThreads`, `StageDecisions`, `ThreadRunner`, `ThreadService` and `DecisionService` (Work's `TaskDecisions`: `openOn` and `openInThread`, the planning Brief's Decisions); Work's `IdeaCards` and Notifications' `OfficeStatusCards` post their cards through `ThreadService`. Each kind of Proposal is applied by the module that owns it through `ProposalAppliers`, a registry filled as modules start: `RoleProposals` applies Roles through People's `RoleService` (`hireFromScratch`/`hire`/`changeCard` with who proposed it, and their dry runs as a Proposal is drafted); `SizeThresholdProposals` and `OfficeInstructionsProposals` (adapters, for the contracts' rule Settings saves by) apply the size threshold and the Office instructions; `ProjectCommandProposals` applies `project-commands` through Projects' `ProjectService` (`changeCommandsAsProposed`), whose rules judge it, and `ProjectCommandOfficeTools` drafts them; `SkillInstallProposals` applies `skill-install` through Skills' `SkillLibrary.install` (The Office fetches it; chats only read), `SkillUpdateProposals` applies `skill-update` through Skills' `SkillUpdates.apply`, `SkillProposals` applies `skill` through Skills' `SkillLibrary.write` (judged as drafted by `writeProblems`), and `SkillOfficeTools` drafts them: `propose_skill` for everyone, and Devops' `list_source_skills` and `propose_skill_install`, which read the Source through Skills' `SkillSources` and draft one Proposal per skill; a module that calls Conversations registers its kinds itself, as Work does the Office-wide limit, `initiative` and `project` (a Project to onboard, with the `propose_project` tool) and Pipelines does `pipeline` (with the `list_pipelines` and `propose_library_pipeline` tools) and `stage-template` (with `list_stage_templates` and `propose_stage_template`), and drafts them through a port bound to `ProposalService`. An Office setting registers with `registerSetting`, giving its value now, which a Proposal of it starts from (`ProposalService.draftSetting`), of the type `OfficeSettingValues` gives it. Every session's Office tools, Work's and Pipelines' lists too, start from `READING_OFFICE_TOOLS` (`domain/session-instructions.ts`, exported for them), so every session, chats and Consultations included, reads every record and Attachment; only the writing tools differ.

**Traps:** a Process's output is masked by whole lines (`WholeLines`): an unfinished last line waits for its newline, the Process's end, the session's end or about a second (`HELD_LINE_MS`), since the mask matches within a text and a secret split across two reads would pass it; a description, prompt, command line, what a Sub-agent reported back and why one failed are masked too. A `SessionFollowing` handles its events one after another (a held line's flush takes its turn among them) and, on a resume, first reads which Sub-agents its session started. `StageThreads` reads a session's events with one reader for its whole life (`read`): Sub-agent and Process events are kept as they come, between turns and after the run's last turn, and every other event waits in a channel for the turn that reads it; `endSession` waits for that reader, so a turn awaited meanwhile fails before it returns. what a session on a Task writes into a Thread (its text, its tool calls' summaries, a refusal's reason) goes through the Project's mask in `sessionLogLines` before it is stored or sent live, from `ProjectOutputMasks`, which app.module.ts binds to Projects' `ProjectService`; a chat's, an Initiative's and the Caretaker's sessions have no Project and mask nothing (`NO_MASK`). A person's Thread on a Task (`isPersonsThread`: not a Stage's, not a Consultation's; the Planner's is the Planning Thread) keeps `stageThread` false, or a message would wait for a safe point; its setup says `asking`, so `SessionPlace.callsCanWait` is false and it gets no `change_role`, and a later session gets `brief` undefined, briefed by `freshPersonsThreadBrief` from the Thread alone. An MCP tool at Consult or Ask me still opens its approval Decision there, in that Thread. A running session can't change its Office tools, so `ThreadRunner.answer` resumes one whose place's tools changed, as the Planner's do once the Task is Ready. A call behind an enforced Hard switch (`HeldCalls`, the `change_role` tool, Task Threads only: a chat has no Decision to wait in) never waits in the tool call: it opens an approval Decision, and the Agent's repeat of the identical call runs once after "Allow once" (`decisions.approval_spent_at`). An MCP tool at Consult or Ask me is held the same way (`HeldCalls.holdMcpToolCall`, its call words with the input's keys sorted, `mcpToolCallWords`), reached from the engine's hook through `SessionOptions.approvalHold`; the runners take it from `ApprovalHolds`, which `HeldCalls` fills on start, since `HeldCalls` reaches the runners through `Consultations`. In a chat it is refused in the Hard switch's chat words; only `application/thread-runner.test.ts` leaves Threads answering, and it alone recovers interrupted answers ([testing](../../../docs/testing.md)). A consult of a hired Consultant (`Consultations`, `Decision.putTo`) is the same Decision the Agent waits on, put to them instead of the user: the Consultation Thread (`Thread.consultation`) opens when the Agent's turn ends (`TurnEnded`), or at once for The Office's Decision a Pipeline puts to the CTO first (`StageDecisions.open` with `putTo`, spec 2.3), which the CTO answers only in their own words (`consultantAnswerProblems`) or passes on to the user; the Consultant answers with `answer_consultation` through `DecisionService.answer`, and the user answering first is the take-over. A Consultant asked to approve may pass it on (`passOn` on `answer_consultation`, `passDecisionOn`): the same Decision is put to the one they name, in a Consultation of its own, or to the user on the second step (`PASS_ON_STEPS`) or for someone not hired or already asked; `Decision.passedOn` keeps who and why, and only the Consultant it waits on now may answer. A Decision with `putTo` is left out of `openDecisions()` and raises no Notification (spec 6), while `unansweredOn(taskId)`, the Task page's read, keeps it; `putDecisionToUser` is the way back when the Consultant can't answer. An Initiative's planning Thread holds several open Decisions, each on its Task (`decisionTaskOf` in `openDecision`), and stays answerable while the Planner works: an answer given then is recorded at once (`keepAnswerForTurnEnd`: the Decision is answered, so its Task is free for Ready, and its `decision-answer` line has `delivery: "waiting"`), and `ThreadRunner` hands every waiting answer over in one message as the turn ends (`deliverWaitingAnswers`), or with the next answer given while the Planner waits, each naming its Task (`decisionAnswersOnTasksMessage`), marking the lines delivered; a hand-over that never reaches a session reopens every Decision it carried (`reopenDecision`). Answers still waiting when The Office stops wait for the next turn's end or the next answer. A Thread on a Task still refuses an answer while the person answers. A Decision's `attachmentIds` name Attachments Work keeps, so no foreign key holds them: `open_decision` refuses any that isn't the Task's as it opens (`attachmentProblems`, through `WorkRecords.taskAttachmentIds`, asked only when it names some), and one removed later stays named, so a reader looks each id up among the Task's Attachments. While the fire alarm is on every tool call of a session `ThreadRunner` runs is refused (`toolHold`, `FireAlarmLifts.heldReason`, in `HELD_BY_THE_FIRE_ALARM`), except in a Thread the user lifted it for (`fire_alarm_lifts`, kept for the sounding it was made in, so it ends at the all clear; `GET /fire-alarm/lifts`, `PUT`/`DELETE /fire-alarm/lifts/:threadId`); a Stage Thread's session takes no hold, since its Stage is held at its safe point. No Consultation opens then, and as it sounds every Consultation answering stops (`ThreadRunner.stopAnswering`), its Decision still put to its Consultant: at the all clear, on each Task that goes on, the Consultant is asked again in the Consultation it stopped (`ThreadRunner.askAgain`, its session continued or replaced under the Context policy) or in one it kept from opening (`Consultations.goOnAfterAllClear`). `StageThreads.sessionAhead` decides a Stage's session as `open` would, opening nothing, for the all clear's plan. A Consultation's session gets only `CONSULTATION_OFFICE_TOOLS`, so it opens no Decision and consults no one. A Brief's Memory is read by its `MemoryReach`: a Task's Project and all Projects on a Task, all Projects on an Initiative, every note in a chat, each labelled with its Project there. A message's mentions are the record links in it (`recordLinksIn` from the contracts, read in `ThreadsController.send`); `ThreadRunner.send` reads each record then (`MentionedRecords`) and puts them in the Brief of a session that starts on the message, or after the message into a running or resumed one: the log keeps the message as written, and a barge-in into a running Stage Thread gets no records. A message from the chat drawer may come with its Open page (`SentWith.openPage`, kept on the user message, which only a chat Thread takes; a Task's or Initiative's Thread drops it): its record (`MentionedRecords.openPage`) ends a new session's Brief, and goes after the message and its Mentions into a running or resumed one unless the message mentions it or the previous user message in the session, read back to the context line of the move that started it, had the same (`openPageToGive`, `domain/open-page.ts`). A test assembling `MentionedRecords` by hand provides `openPageRecordProviders()`. A Proposal is drafted by anyone's `propose_skill` in their chat (`CHAT_OFFICE_TOOLS`, so a test standing in for the chat tools registers it too, unless it boots `SkillOfficeTools`), by the Office Manager's `propose_role` and `propose_office_setting` (`chatOfficeTools`), by Devops' `propose_project_commands`, `propose_library_pipeline`, `propose_stage_template` and `propose_skill_install` (`roleOfficeTools`, given in their chat and their Stage Threads alike, so a Devops session needs Pipelines booted for its tools), or by the CTO's shaping tools on an active Initiative (Work's `ProposalDrafts`), returns at once and waits on nobody; the owner judges it as it is drafted, and the Agent reads its reasons as the tool's error (`ScriptedSession.reportedEvents` shows what the Agent read); applying holds its row (`updateProposal`) while the owner carries it out, so a refusal saves nothing and leaves it open. Applying a number setting overwrites whatever it holds, but `office-instructions` replaces a whole text, so `OfficeInstructions.replace` refuses it under the store's lock once the text is no longer `from`; only `apply` sees that, as `problemsWith` runs at the draft alone. The Office Manager's session keeps the version it started with, so `propose_office_setting` sends them to `read_office_instructions` first: a draft of an old copy still has `from` as the text now, and the card shows only `to`. The tool takes a number as `value` and the text as `text`, since an Office tool's input must stay one object for the Claude Code adapters, and trims the text before it is drafted, so "the same text" is judged as it would be saved. A `change` keeps only the fields it rewrites (`from`/`to`) and is merged onto the card as it is when applied, never a stale whole card. Its test (`application/proposal-service.test.ts`) boots the real People module for the Roles it hires, under titles of its own, with `RoleCards` overridden for the Office Manager's fixed key, People's preset hiring spied on for a preset's fixed key, and a stand-in for Work's Office-wide limit applier; People's `EngineModule` then has a registry of its own, so the chat's stand-in tools are registered through a provider on the scripted one. A Link card is posted only by the Office Manager's `post_link_card`, refused (the Agent reads why) for themself, someone let go, a Role nobody fills, Chat off, a blank note or no such Task; about a Task with no person named it points to whoever has its newest Stage Thread, and its note links the Task (`linkCardNote`) so the user's message mentions it. The message the user sends from it is theirs, saying whose note it was (`handoverNoteFrom`), never a `handover-note` message: that kind is the person's own, which a fresh Brief carries. Every test file shares the `conversations_settings` row each Context policy decision reads: tests bind `ConversationsSettingsForTests`, and only the default is ever saved to the row. They share `office_instructions_versions` too: a test assembling `ThreadRunner` or `StageThreads` by hand provides `OfficeInstructions` over `OfficeInstructionsRepositoryForTests`, which a test that saves a text must bind, and the Postgres repository's own test rolls back all it saves. An Agent Stage's text enters in `StageThreads`, through `workThreadInstructions`, never in Pipelines' `AGENT_STAGE_INSTRUCTIONS`. Allow changes (spec §2.4) is kept per Caretaker chat Thread in `changes_allowed` (`AllowChanges`, `PUT`/`DELETE /threads/:id/allow-changes`, `ChangesAllowedRepository`, read by `SessionPlaces`, which gives that Thread's session the home folder, the whole profile and `workstation`, and else a read-only chat's place with `ALLOW_CHANGES_ADVICE`); each switch ends the Thread's session (`ThreadRunner.stopAnswering`, an answer under way too), logs a `changes-allowed` line, and the session records `changesAllowed`, so the Context policy never resumes it across a switch (`changes-switched`); the fire alarm's `toolHold` still holds every call. A Thread's response carries `changesAllowed` (null but in the Caretaker's chat) through `ThreadContexts.read`. A message counts as answered unless its kind is in `USERS_OWN_MESSAGE_KINDS`, so a new kind the user makes themselves belongs there; only Threads in a chat take part, and a Decision's Thread answers with `answered` null, as a chat has no Decisions. Every session reads records with `READING_OFFICE_TOOLS`; a person's sessions (their chat, `CONSULTATION_OFFICE_TOOLS`, and Work's `ASKING_OFFICE_TOOLS` for their Thread on a Task) start from `PERSON_READING_OFFICE_TOOLS`, which adds Pipelines' `read_stage_history` (`READ_STAGE_HISTORY_TOOL`): never put it in `READING_OFFICE_TOOLS`, which Agent Stages start from, as their Brief carries what they need of earlier runs.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

DecisionService, InitiativeThreadSetups, InitiativeThreadRequest, InitiativeThreadSetup, InitiativeThreadSource, FireAlarmInThreads, ThreadsFireAlarm, InterruptedAnswers, SubAgentsAndProcesses, ProposalAppliers, ProposalApplier, SettingProposalApplier, StageDecisions, StageDecisionRequest, StageThreads, StageSessionSettings, StageThread, StageThreadRequest, StageTurn, TaskTokens, TaskThreadSetups, TaskThreadRequest, TaskThreadSetup, TaskThreadSource, ThreadRunner, ThreadService, InitiativeThreadOpening, TaskThreadStarting, WorkRecords, WorkRecordSource, ConversationsModule, PlanningThreadElsewhere, DecisionAnswered, DecisionOpened, DecisionReopened, TokensCounted, TurnEnded, ProposalService, PipelineStage, ProposedInitiativeChange, ProposedPipelineChange, ProposedProject, ProposedSettingChange, ProposedStageTemplateChange, LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL, PROPOSE_LIBRARY_PIPELINE_TOOL, PROPOSE_PROJECT_TOOL, PROPOSE_STAGE_TEMPLATE_TOOL, PERSON_READING_OFFICE_TOOLS, READ_STAGE_HISTORY_TOOL, READING_OFFICE_TOOLS, ProposalRefused

## Domain events

- `domain/conversation-events.ts`: ThreadStarted, ThreadRenamed, ThreadSeen, MessagesLogged, DeliveryMarked, TurnEnded, TokensCounted, ContextOverrideChosen, DecisionOpened, DecisionAnswered, DecisionReopened, ProposalDrafted, ProposalApplied, ProposalDeclined, SizeThresholdChanged, OfficeInstructionsChanged, SubAgentOrProcessChanged, SubAgentMessagesKept, ProcessOutputKept

## HTTP routes (under `/api`)

- `GET /decisions/open`: DecisionsController.listOpen
- `GET /tasks/:taskId/decisions/unanswered`: DecisionsController.listUnansweredOn
- `POST /decisions/:id/answer`: DecisionsController.answer
- `GET /fire-alarm/lifts`: FireAlarmLiftsController.list
- `PUT /fire-alarm/lifts/:threadId`: FireAlarmLiftsController.lift
- `DELETE /fire-alarm/lifts/:threadId`: FireAlarmLiftsController.takeBack
- `GET /settings/office-instructions`: OfficeInstructionsController.read
- `PUT /settings/office-instructions`: OfficeInstructionsController.change
- `GET /proposals/open`: ProposalsController.listOpen
- `GET /proposals/:id`: ProposalsController.read
- `POST /proposals/:id/apply`: ProposalsController.apply
- `POST /proposals/:id/decline`: ProposalsController.decline
- `GET /settings/size-threshold`: SizeThresholdController.read
- `PUT /settings/size-threshold`: SizeThresholdController.change
- `GET /threads/:id/sub-agents-and-processes`: SubAgentsAndProcessesController.list
- `GET /threads/:id/sub-agents/:callId/messages`: SubAgentsAndProcessesController.messages
- `GET /threads/:id/processes/:callId/output`: SubAgentsAndProcessesController.output
- `GET /chats/activity`: ThreadsController.activityInChats
- `GET /people-working`: ThreadsController.peopleWorking
- `GET /chats/:roleKey/threads`: ThreadsController.listInChat
- `POST /chats/:roleKey/threads`: ThreadsController.startInChat
- `GET /tasks/:taskId/threads`: ThreadsController.listOnTask
- `GET /tasks/:taskId/conversation`: ThreadsController.conversation
- `GET /tasks/:taskId/conversation/:roleKey/brief`: ThreadsController.firstBrief
- `POST /tasks/:taskId/conversation/:roleKey/thread`: ThreadsController.openPersonsThread
- `GET /initiatives/:initiativeId/threads`: ThreadsController.listOnInitiative
- `GET /roles/:roleKey/task-threads`: ThreadsController.listOnTasksWith
- `GET /threads/:id`: ThreadsController.read
- `PUT /threads/:id/title`: ThreadsController.rename
- `PUT /threads/:id/context-override`: ThreadsController.chooseOverride
- `PUT /threads/:id/allow-changes`: ThreadsController.allow
- `DELETE /threads/:id/allow-changes`: ThreadsController.switchOff
- `PUT /threads/:id/seen`: ThreadsController.markSeen
- `GET /threads/:id/messages`: ThreadsController.messages
- `POST /threads/:id/messages`: ThreadsController.send

## Tables

- `adapters/postgres/changes-allowed.schema.ts`: changes_allowed
- `adapters/postgres/conversations-settings.schema.ts`: conversations_settings
- `adapters/postgres/fire-alarm-lifts.schema.ts`: fire_alarm_lifts
- `adapters/postgres/office-instructions.schema.ts`: office_instructions_versions
- `adapters/postgres/sub-agents-and-processes.schema.ts`: sub_agents_and_processes, sub_agent_messages, process_output
- `adapters/postgres/thread-seen.schema.ts`: thread_seen
- `adapters/postgres/threads.schema.ts`: threads, thread_messages, decisions, proposals

## Files

### ./

- `conversations.module.ts`: ConversationsModuleOptions, ConversationsModule
- Tests: conversations.module.test.ts

### adapters/http/

- `conversation-responses.ts`: toThreadResponse, toPeopleWorkingResponse, toChatActivityResponse, CardRecords, toTaskConversationResponse, toMessageResponse, toProposalResponse, toDecisionResponse
- `decisions.controller.ts`: DecisionsController
- `devops-chat.fixtures.ts`: NINA_ROLE_CARDS, noProjectBases, aSkillName, DevopsChat
- `fire-alarm-lifts.controller.ts`: FireAlarmLiftsController
- `office-instructions.controller.ts`: OfficeInstructionsController
- `proposals.controller.ts`: ProposalsController
- `size-threshold.controller.ts`: SizeThresholdController
- `sub-agent-and-process-responses.ts`: toSubAgentOrProcessResponse, toSubAgentResponse, toProcessResponse, toSubAgentMessageResponse, toSubAgentMessagesResponse, toOutputChunkResponse, toProcessOutputResponse
- `sub-agents-and-processes.controller.ts`: SubAgentsAndProcessesController
- `thread-refusals.filter.ts`: ThreadRefusalsFilter
- `threads.controller.ts`: ThreadsController
- Tests: conversation-responses.test.ts, sub-agents-and-processes.controller.test.ts, threads.controller.full.test.ts, threads.controller.test.ts

### adapters/office-tools/

- `decision-office-tools.ts`: DecisionOfficeTools
- `link-card-office-tools.ts`: LinkCardOfficeTools
- `memory-office-tools.fixtures.ts`: Draft, SESSION, toolWith, card
- `memory-office-tools.ts`: MemoryOfficeTools
- `project-command-office-tools.ts`: ProjectCommandOfficeTools
- `proposal-office-tools.ts`: ProposalOfficeTools
- `refused-to-the-agent.ts`: refusedToTheAgent
- `role-office-tools.fixtures.ts`: Words, developer, toolWith, input
- `role-office-tools.ts`: RoleOfficeTools
- `skill-office-tools.ts`: SkillOfficeTools
- Tests: memory-office-tools.full.test.ts, memory-office-tools.test.ts, proposal-office-tools.full.test.ts, role-office-tools.full.test.ts, role-office-tools.test.ts

### adapters/postgres/

- `changes-allowed.schema.ts`: changesAllowed
- `conversations-settings.schema.ts`: conversationsSettings
- `fire-alarm-lifts.schema.ts`: fireAlarmLifts
- `office-instructions.schema.ts`: officeInstructionsVersions
- `postgres-changes-allowed-repository.ts`: PostgresChangesAllowedRepository
- `postgres-chat-activity-repository.fixtures.ts`: app, database, repository, threads, AT, aThreadWithAnswer, setUpEachTest
- `postgres-chat-activity-repository.ts`: PostgresChatActivityRepository
- `postgres-conversations-settings.ts`: PostgresConversationsSettings
- `postgres-fire-alarm-lift-repository.ts`: PostgresFireAlarmLiftRepository
- `postgres-office-instructions-repository.fixtures.ts`: ROLLED_BACK, app, database, rolledBack, save, setUpEachTest
- `postgres-office-instructions-repository.ts`: PostgresOfficeInstructionsRepository
- `postgres-sub-agent-and-process-repository.ts`: PostgresSubAgentAndProcessRepository
- `postgres-thread-repository.fixtures.ts`: app, repository, aThreadOfItsOwn, AT, setUpEachTest
- `postgres-thread-repository.ts`: PostgresThreadRepository
- `sub-agents-and-processes.schema.ts`: subAgentsAndProcesses, subAgentMessages, processOutput
- `thread-seen.schema.ts`: threadSeen
- `threads.schema.ts`: SavedPassedOn, ThreadSessionRow, threads, threadMessages, decisions, proposals
- Tests: postgres-chat-activity-repository.full.test.ts, postgres-chat-activity-repository.test.ts, postgres-conversations-settings.test.ts, postgres-office-instructions-repository.full.test.ts, postgres-office-instructions-repository.test.ts, postgres-sub-agent-and-process-repository.test.ts, postgres-thread-repository.full.test.ts, postgres-thread-repository.test.ts

### adapters/proposals/

- `office-instructions-proposals.ts`: OfficeInstructionsProposals
- `size-threshold-proposals.ts`: SizeThresholdProposals

### adapters/websocket/

- `thread-web-events.ts`: ThreadWebEvents

### application/

- `allow-changes.ts`: AllowChanges
- `approval-holds.ts`: ApprovalHolds
- `barge-ins.ts`: BargeInMessage, BargeInsAfterTurn, BargeIns
- `briefs.ts`: Briefs
- `chat-activity.ts`: ThreadActivity, ChatActivity
- `consultations.ts`: STOPPED_BY_THE_FIRE_ALARM, Consultations
- `context-policy-settings.ts`: ContextPolicySettingsService
- `decision-service.ts`: OpenedDecision, DecisionService
- `fire-alarm-in-threads.ts`: ThreadsFireAlarm, FireAlarmInThreads
- `fire-alarm-lifts.ts`: HELD_BY_THE_FIRE_ALARM, FireAlarmLifts
- `held-calls.fixtures.ts`: SESSION, CALL, request, Setup, heldCallsWith, anApproval, call
- `held-calls.ts`: HeldCallOutcome, HeldCallRequest, HeldCalls
- `initiative-thread-setups.ts`: InitiativeThreadRequest, InitiativeThreadSetup, InitiativeThreadSource, InitiativeThreadSetups
- `interrupted-answers.ts`: InterruptedAnswers
- `link-cards.ts`: LinkCardRequest, LinkCards
- `mentioned-records.ts`: MentionedRecords
- `office-instructions.ts`: OfficeInstructions
- `open-page-records.fixtures.ts`: openPageRecordProviders
- `project-command-proposals.ts`: ProjectCommandProposals
- `proposal-appliers.ts`: ProposalApplier, SettingProposalApplier, ProposalAppliers
- `proposal-service.ts`: ProposalService
- `role-proposals.ts`: RoleProposals
- `session-log.ts`: SessionEvent, SessionLogger, sessionLogLines
- `session-mcp-servers.fixtures.ts`: SessionMcpServersStandIn, sessionMcpServersStandIn
- `session-memory.fixtures.ts`: MemoryAsk, sessionMemoryProvider
- `session-memory.ts`: SessionMemory
- `session-places.ts`: SessionPlace, SessionPlaces
- `session-role.fixtures.ts`: aPlannerCard
- `skill-install-proposals.ts`: SkillInstallProposals
- `skill-proposals.ts`: SkillProposals
- `skill-update-proposals.ts`: SkillUpdateProposals
- `stage-decisions.ts`: StageDecisionRequest, OpenedStageDecision, StageDecisions
- `stage-threads.ts`: StageSessionSettings, StageThreadRequest, StageSessionAhead, StageTurn, AskedDecision, StageThread, StageThreads
- `sub-agents-and-processes.ts`: FollowedSession, SubAgentMessagesRead, ProcessOutputRead, SubAgentsAndProcesses, SessionFollowing
- `task-conversations.ts`: TaskConversations
- `task-thread-setups.ts`: TaskThreadRequest, taskThreadRequest, TaskThreadSetup, TaskThreadSource, TaskThreadSetups
- `task-tokens.ts`: EngineIdTokens, TaskTokens
- `thread-contexts.ts`: ThreadReading, ThreadContexts
- `thread-runner.ts`: SentWith, Answerer, ThreadRunner
- `thread-service.ts`: InitiativeThreadOpening, TaskThreadStarting, ThreadService
- `work-records.ts`: WorkRecordSource, WorkRecords
- Tests: briefs.full.test.ts, consultations.full.test.ts, consultations.test.ts, devops-proposals.full.test.ts, devops-skill-sources.full.test.ts, held-calls.full.test.ts, held-calls.test.ts, link-cards.full.test.ts, office-instructions.full.test.ts, office-instructions.test.ts, openai-compatible-api-test-project-check.test.ts, proposal-service.full.test.ts, proposal-service.test.ts, session-log.test.ts, session-memory.full.test.ts, stage-threads.full.test.ts, stage-threads.test.ts, task-tokens.test.ts, thread-runner.test.ts

### domain/

- `brief.ts`: Brief, BriefProject, CHAT_EXCHANGES_TOKENS, MEMORY_TOKENS, estimatedTokens, BriefMemoryNote, BriefMemory, NO_MEMORY, MemoryReach, selectMemory, newChatThreadBrief, freshChatThreadBrief, freshPersonsThreadBrief, TaskThreadRecord, taskThreadBrief, InitiativeThreadRecord, initiativeThreadBrief
- `chat-activity.ts`: ChatThreadActivity, AnsweredThread, PersonChatActivity, hasAnswered, chatActivityOfPeople
- `chat-not-found.ts`: ChatNotFound
- `consult.ts`: THE_OFFICE, APPROVAL_OPTIONS, approvalQuestion, isApproval, PASS_ON_STEPS, Consult, ConsultedParty, ConsultantPerson, consultantNamed, passedOnTo, consultDecision, consultantAnswerProblems, consultationTitle, consultationOpening
- `context-policy.fixtures.ts`: NOW, MINUTE, aContinuation
- `context-policy.ts`: SessionDefault, ContextMove, ContextReason, ContextPolicySettings, DEFAULT_CONTEXT_POLICY_SETTINGS, Continuation, ContextAlternative, ContextDecision, decideContext
- `conversation-events.ts`: ThreadStarted, ThreadRenamed, ThreadSeen, MessagesLogged, DeliveryMarked, TurnEnded, TokensCounted, ContextOverrideChosen, DecisionOpened, DecisionAnswered, DecisionReopened, ProposalDrafted, ProposalApplied, ProposalDeclined, SizeThresholdChanged, OfficeInstructionsChanged, SubAgentOrProcessChanged, SubAgentMessagesKept, ProcessOutputKept
- `conversation-tabs.ts`: TabConsultation, PlanningThreadElsewhere, ConversationTab, conversationTabs
- `decision-not-found.ts`: DecisionNotFound
- `decision.fixtures.ts`: aDecision, AT, TASK_HOME, SESSION, DRAFT, WARM, refusalOf
- `decision.ts`: Recommendation, DecisionDraft, DecisionAnswer, GivenAnswer, PassedOn, Decision, decisionProblems, attachmentProblems, answerProblems, answerWords
- `held-call.ts`: HeldCallRuling, heldCallRuling
- `link-card.ts`: LinkedTask, linkCardNote
- `mcp-tool-call.ts`: mcpToolCallWords
- `mention.ts`: Mention, MentionedRecord, briefWithMentionedRecords, withMentionedRecords, decisionRecordText
- `message.ts`: Message, MessageDraft, USERS_OWN_MESSAGE_KINDS, StageWorkClosing, HeldBy, MessageDelivery, IdeaCard, OfficeStatusCard
- `office-instructions-version-not-found.ts`: OfficeInstructionsVersionNotFound
- `office-instructions.ts`: OfficeInstructionsVersion, NO_OFFICE_INSTRUCTIONS, versionAfter
- `open-page.ts`: OpenPage, OpenPageRecord, OpenPageGiving, openPageToGive, sameOpenPage, briefWithOpenPageRecord, withOpenPageRecord
- `people-working.ts`: TaskPeopleWorking, peopleWorkingOnTasks
- `proposal-changes.ts`: ProposalChange, applyProposal, declineProposal
- `proposal-not-found.ts`: ProposalNotFound
- `proposal-refused.ts`: ProposalRefused
- `proposal.fixtures.ts`: aProposedCard, aProposal
- `proposal.ts`: ProposedChanges, ProposedChangeKind, ProposedChange, RoleCardFields, ProposedHire, ProposedPresetHire, ProposedRoleChange, OfficeSettingValues, OfficeSetting, OFFICE_SETTINGS, ProposedSettingChange, ProposedSettingValue, ProposedInitiativeChange, InitiativeEdit, ProposedProjectCommands, ProposedPipelineChange, ProposedStageTemplateChange, ProposedProject, ProposedSkillInstall, ProposedSkillUpdate, AppliedSkillDiff, ProposedSkill, PipelineStage, ProposalStatus, Proposal, EditedHire, proposedRoleChange, proposedChangeProblems, changeToApply, refuseUnlessOpen
- `session-instructions.ts`: SessionPerson, chatInstructions, ALLOW_CHANGES_ADVICE, caretakerChatInstructions, workThreadInstructions, PROPOSE_SKILL_TOOL, READ_ROLE_TOOL, READING_OFFICE_TOOLS, READ_STAGE_HISTORY_TOOL, PERSON_READING_OFFICE_TOOLS, CHAT_OFFICE_TOOLS, PROPOSE_ROLE_TOOL, PROPOSE_OFFICE_SETTING_TOOL, READ_OFFICE_INSTRUCTIONS_TOOL, POST_LINK_CARD_TOOL, SHOW_OFFICE_STATUS_TOOL, PROPOSE_PROJECT_COMMANDS_TOOL, PROPOSE_LIBRARY_PIPELINE_TOOL, PROPOSE_PROJECT_TOOL, LIST_PIPELINES_TOOL, LIST_STAGE_TEMPLATES_TOOL, PROPOSE_STAGE_TEMPLATE_TOOL, LIST_SOURCE_SKILLS_TOOL, PROPOSE_SKILL_INSTALL_TOOL, READ_SKILL_UPDATE_TOOL, PROPOSE_SKILL_UPDATE_TOOL, READ_REPOSITORY_TOOL, chatOfficeTools, roleOfficeTools, stageCapabilityOfficeTools, ANSWER_CONSULTATION_TOOL, CONSULTATION_OFFICE_TOOLS, consultationInstructions, REMEMBER_TOOL, CHANGE_ROLE_TOOL, sessionOfficeTools, HANDOVER_REQUEST, briefedMessage, LeftOutServer, withLeftOutServers, openingMessage, decisionAnswerMessage, AnsweredOnTask, decisionAnswersOnTasksMessage
- `sub-agent-or-process-not-found.ts`: SubAgentOrProcessNotFound
- `sub-agents-and-processes.ts`: Ending, ItemState, SubAgent, Process, SubAgentOrProcess, SubAgentMessageDraft, SubAgentMessage, OutputChunk, SessionWhere, OUTPUT_KEPT_BYTES, MESSAGES_KEPT, ENDED_ITEMS_KEPT, RESTART_ENDING, SESSION_END_ENDING, stateOf, endItem, changeSubAgent, OutputTrim, outputTrim, byteLength, WholeLines
- `thread-changes.ts`: ThreadChange, DeliveryMarking, ChatPerson, startChatThread, TaskThreadStart, startTaskThread, startStageThread, startConsultationThread, InitiativeThreadStart, startInitiativeThread, renameThread, logMessages, freshSession, Answering, Opening, beginAnswer, bargeIn, markDelivery, DecisionOpening, openDecision, openDecisionOf, ProposalDrafting, draftProposal, DecisionAnswering, answerDecision, keepAnswerForTurnEnd, deliverWaitingAnswers, DecisionRecording, recordDecisionAnswer, beginOpening, beginAskingAgain, beginStageWork, StageWorkEnding, endStageWork, TurnCount, endTurn, countRunningTurn, UnopenedSession, failAnswer, failDecisionAnswer, reopenDecision, putDecisionToUser, PassingOn, passDecisionOn, chooseOverride
- `thread-not-found.ts`: ThreadNotFound
- `thread-refused.ts`: ThreadRefused
- `thread-title.ts`: TITLE_LENGTH, titleFrom, titleProblems
- `thread.fixtures.ts`: aThread, storedBeforeOfficeInstructions, aUserMessage
- `thread.ts`: Home, ThreadState, TokenTotals, NO_TOKENS, addTokens, isPersonsThread, tokensSoFar, ThreadSession, ContextOverride, Consultation, Thread
- `tool-activity.ts`: toolActivitySummary
- `undelivered-messages.ts`: undeliveredSince, waitingMessageIds, workWithUndelivered
- Tests: brief.full.test.ts, chat-activity.full.test.ts, consult.full.test.ts, context-policy.full.test.ts, context-policy.test.ts, conversation-tabs.full.test.ts, decision.full.test.ts, decision.test.ts, held-call.test.ts, mention.full.test.ts, open-page.full.test.ts, people-working.full.test.ts, proposal.full.test.ts, proposal.test.ts, session-instructions.full.test.ts, session-instructions.test.ts, sub-agents-and-processes.test.ts, thread-changes.full.test.ts, thread-changes.test.ts, tool-activity.full.test.ts

### ports/

- `changes-allowed-repository.ts`: ChangesAllowedRepository
- `chat-activity-repository.ts`: SeenMark, ChatActivityRepository
- `conversations-settings.fixtures.ts`: ConversationsSettingsForTests
- `conversations-settings.ts`: ConversationsSettings
- `fire-alarm-lift-repository.ts`: FireAlarmLiftRepository
- `office-instructions-repository.fixtures.ts`: OfficeInstructionsRepositoryForTests
- `office-instructions-repository.ts`: OfficeInstructionsRepository
- `project-bases.ts`: ProjectBases
- `project-output-masks.fixtures.ts`: ProjectOutputMasksForTests
- `project-output-masks.ts`: TextMask, NO_MASK, ProjectOutputMasks
- `project-record-source.ts`: ProjectRecordSource
- `sub-agent-and-process-repository.ts`: ItemKey, SubAgentAndProcessRepository
- `thread-repository.ts`: ThreadUpdate, ThreadRepository
