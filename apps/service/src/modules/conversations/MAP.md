# Conversations: module map

**Owns:** Threads, each one engine session (`threads`, `thread_messages`), and The Office's message log; Decisions as cards in the asking Thread (`decisions`); Proposals as cards in the Thread they were drafted in (`proposals`), generic over what they change (`ProposedChange`: a Role's `hire` from scratch, `hire-from-preset` and `change`; the Office settings `office-wide-limit` and `size-threshold`; `initiative`, the CTO's change to an active Initiative; Devops' `project-commands` and `pipeline`, each with the values now (`from`) and as proposed (`to`), refused once those changed) and applied only by the user; Link cards, a message in the Office Manager's chat pointing the user to a person (about a Task when it names one) with a Handover note the user sends themselves (`LinkCards`), whether that person was let go read as the log is (`letGoIn`); an Idea's card in the chat it was captured in and the Office status's card, each only a pointer the web reads live from Work and Now, logged in chat Threads only (`ThreadService.postIdeaCard`, `postOfficeStatus`); the Context policy (resume, fresh, hand off, the Brief, Handover notes) and its size threshold in one row (`conversations_settings`), which Settings › Office limits changes; the sessions behind Stage Threads (`ThreadRunner`); tokens per Thread and per Task (`TaskTokens`).

**Talks to:** calls Engine, People (`RoleCards`) and Skills (session skills). Reads Project bases through its `ProjectBases` port, bound to Projects' `BaseCheckouts` in [app.module.ts](../../app.module.ts). Work fills `TaskThreadSetups` as it starts, with what a Thread on a Task works with, `InitiativeThreadSetups`, with an Initiative's record, instructions and Office tools (its session reads every Project's base branch, as a chat's does, and gets no `change_role` or Decision), and `WorkRecords`, with the records of Tasks, Initiatives and Ideas a message mentions and a Link card's Task title, since Work calls Conversations. Pipelines and Work reach it through ports bound to `StageThreads`, `StageDecisions`, `ThreadRunner`, `ThreadService` and `DecisionService`; Work's `IdeaCards` and Notifications' `OfficeStatusCards` post their cards through `ThreadService`. Each kind of Proposal is applied by the module that owns it through `ProposalAppliers`, a registry filled as modules start: `RoleProposals` applies Roles through People's `RoleService` (`hireFromScratch`/`hire`/`changeCard` with who proposed it, and their dry runs as a Proposal is drafted); `SizeThresholdProposals` (an adapter, for the contracts' rule Settings saves by) applies the size threshold; `ProjectCommandProposals` applies `project-commands` through Projects' `ProjectService` (`changeCommandsAsProposed`), whose rules judge it, and `ProjectCommandOfficeTools` drafts them; a module that calls Conversations registers its kinds itself, as Work does the Office-wide limit and `initiative` and Pipelines does `pipeline` (with the `list_pipelines` and `propose_library_pipeline` tools), and drafts them through a port bound to `ProposalService`. An Office setting registers with `registerSetting`, giving its value now, which a Proposal of it starts from (`ProposalService.draftSetting`).

**Traps:** a call behind an enforced Hard switch (`HeldCalls`, the `change_role` tool, Task Threads only: a chat has no Decision to wait in) never waits in the tool call: it opens an approval Decision, and the Agent's repeat of the identical call runs once after "Allow once" (`decisions.approval_spent_at`); only `application/thread-runner.test.ts` leaves Threads answering, and it alone recovers interrupted answers ([testing](../../../docs/testing.md)). A consult of a hired Consultant (`Consultations`, `Decision.putTo`) is the same Decision the Agent waits on, put to them instead of the user: the Consultation Thread (`Thread.consultation`) opens when the Agent's turn ends (`TurnEnded`), or at once for The Office's Decision a Pipeline puts to the CTO first (`StageDecisions.open` with `putTo`, spec 2.3), which the CTO answers only in their own words (`consultantAnswerProblems`) or passes on to the user; the Consultant answers with `answer_consultation` through `DecisionService.answer`, and the user answering first is the take-over. A Consultant asked to approve may pass it on (`passOn` on `answer_consultation`, `passDecisionOn`): the same Decision is put to the one they name, in a Consultation of its own, or to the user on the second step (`PASS_ON_STEPS`) or for someone not hired or already asked; `Decision.passedOn` keeps who and why, and only the Consultant it waits on now may answer. A Decision with `putTo` is left out of `openDecisions()` and raises no Notification (spec 6); `putDecisionToUser` is the way back when the Consultant can't answer. A Consultation's session gets only `CONSULTATION_OFFICE_TOOLS`, so it opens no Decision and consults no one. A message's mentions are the record links in it (`recordLinksIn` from the contracts, read in `ThreadsController.send`); `ThreadRunner.send` reads each record then (`MentionedRecords`) and puts them in the Brief of a session that starts on the message, or after the message into a running or resumed one: the log keeps the message as written, and a barge-in into a running Stage Thread gets no records. A Proposal is drafted by the Office Manager's `propose_role` and `propose_office_setting` (`chatOfficeTools`), by Devops' `propose_project_commands` and `propose_library_pipeline` (`roleOfficeTools`, given in their chat and their Stage Threads alike, so a Devops session needs Pipelines booted for its tools), or by the CTO's shaping tools on an active Initiative (Work's `ProposalDrafts`), returns at once and waits on nobody; the owner judges it as it is drafted, and the Agent reads its reasons as the tool's error (`ScriptedSession.reportedEvents` shows what the Agent read); applying holds its row (`updateProposal`) while the owner carries it out, so a refusal saves nothing and leaves it open. A `change` keeps only the fields it rewrites (`from`/`to`) and is merged onto the card as it is when applied, never a stale whole card. Its test (`application/proposal-service.test.ts`) boots the real People module for the Roles it hires, under titles of its own, with `RoleCards` overridden for the Office Manager's fixed key, People's preset hiring spied on for a preset's fixed key, and a stand-in for Work's Office-wide limit applier; People's `EngineModule` then has a registry of its own, so the chat's stand-in tools are registered through a provider on the scripted one. A Link card is posted only by the Office Manager's `post_link_card`, refused (the Agent reads why) for themself, someone let go, a Role nobody fills, Chat off, a blank note or no such Task; about a Task with no person named it points to whoever has its newest Stage Thread, and its note links the Task (`linkCardNote`) so the user's message mentions it. The message the user sends from it is theirs, saying whose note it was (`handoverNoteFrom`), never a `handover-note` message: that kind is the person's own, which a fresh Brief carries. Every test file shares the `conversations_settings` row each Context policy decision reads: tests bind `ConversationsSettingsForTests`, and only the default is ever saved to the row.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Public entry (`index.ts`)

DecisionService, InitiativeThreadSetups, InitiativeThreadRequest, InitiativeThreadSetup, InitiativeThreadSource, InterruptedAnswers, ProposalAppliers, ProposalApplier, SettingProposalApplier, StageDecisions, StageDecisionRequest, StageThreads, StageSessionSettings, StageThread, StageThreadRequest, StageTurn, TaskTokens, TaskThreadSetups, TaskThreadRequest, TaskThreadSetup, TaskThreadSource, ThreadRunner, ThreadService, InitiativeThreadOpening, TaskThreadOpening, WorkRecords, WorkRecordSource, ConversationsModule, DecisionAnswered, DecisionOpened, DecisionReopened, TokensCounted, TurnEnded, ProposalService, PipelineStage, ProposedInitiativeChange, ProposedPipelineChange, ProposedSettingChange, LIST_PIPELINES_TOOL, PROPOSE_LIBRARY_PIPELINE_TOOL, ProposalRefused

## Domain events

- `domain/conversation-events.ts`: ThreadStarted, ThreadRenamed, MessagesLogged, DeliveryMarked, TurnEnded, TokensCounted, ContextOverrideChosen, DecisionOpened, DecisionAnswered, DecisionReopened, ProposalDrafted, ProposalApplied, ProposalDeclined, SizeThresholdChanged

## HTTP routes (under `/api`)

- `GET /decisions/open`: DecisionsController.listOpen
- `POST /decisions/:id/answer`: DecisionsController.answer
- `GET /proposals/:id`: ProposalsController.read
- `POST /proposals/:id/apply`: ProposalsController.apply
- `POST /proposals/:id/decline`: ProposalsController.decline
- `GET /settings/size-threshold`: SizeThresholdController.read
- `PUT /settings/size-threshold`: SizeThresholdController.change
- `GET /chats/:roleKey/threads`: ThreadsController.listInChat
- `POST /chats/:roleKey/threads`: ThreadsController.startInChat
- `GET /tasks/:taskId/threads`: ThreadsController.listOnTask
- `GET /initiatives/:initiativeId/threads`: ThreadsController.listOnInitiative
- `GET /roles/:roleKey/task-threads`: ThreadsController.listOnTasksWith
- `GET /threads/:id`: ThreadsController.read
- `PUT /threads/:id/title`: ThreadsController.rename
- `PUT /threads/:id/context-override`: ThreadsController.chooseOverride
- `GET /threads/:id/messages`: ThreadsController.messages
- `POST /threads/:id/messages`: ThreadsController.send

## Tables

- `adapters/postgres/conversations-settings.schema.ts`: conversations_settings
- `adapters/postgres/threads.schema.ts`: threads, thread_messages, decisions, proposals

## Files

### ./

- `conversations.module.ts`: ConversationsModuleOptions, ConversationsModule
- Tests: conversations.module.test.ts

### adapters/http/

- `conversation-responses.ts`: toThreadResponse, CardRecords, toMessageResponse, toProposalResponse, toDecisionResponse
- `decisions.controller.ts`: DecisionsController
- `proposals.controller.ts`: ProposalsController
- `size-threshold.controller.ts`: SizeThresholdController
- `thread-refusals.filter.ts`: ThreadRefusalsFilter
- `threads.controller.ts`: ThreadsController
- Tests: threads.controller.test.ts

### adapters/office-tools/

- `decision-office-tools.ts`: DecisionOfficeTools
- `link-card-office-tools.ts`: LinkCardOfficeTools
- `memory-office-tools.ts`: MemoryOfficeTools
- `project-command-office-tools.ts`: ProjectCommandOfficeTools
- `proposal-office-tools.ts`: ProposalOfficeTools
- `refused-to-the-agent.ts`: refusedToTheAgent
- `role-office-tools.ts`: RoleOfficeTools
- Tests: memory-office-tools.test.ts, proposal-office-tools.test.ts, role-office-tools.test.ts

### adapters/postgres/

- `conversations-settings.schema.ts`: conversationsSettings
- `postgres-conversations-settings.ts`: PostgresConversationsSettings
- `postgres-thread-repository.ts`: PostgresThreadRepository
- `threads.schema.ts`: SavedPassedOn, ThreadSessionRow, threads, threadMessages, decisions, proposals
- Tests: postgres-conversations-settings.test.ts, postgres-thread-repository.test.ts

### adapters/proposals/

- `size-threshold-proposals.ts`: SizeThresholdProposals

### adapters/websocket/

- `thread-web-events.ts`: ThreadWebEvents

### application/

- `barge-ins.ts`: BargeInMessage, BargeInsAfterTurn, BargeIns
- `briefs.ts`: Briefs
- `consultations.ts`: Consultations
- `context-policy-settings.ts`: ContextPolicySettingsService
- `decision-service.ts`: DecisionService
- `held-calls.ts`: HeldCallOutcome, HeldCallRequest, HeldCalls
- `initiative-thread-setups.ts`: InitiativeThreadRequest, InitiativeThreadSetup, InitiativeThreadSource, InitiativeThreadSetups
- `interrupted-answers.ts`: InterruptedAnswers
- `link-cards.ts`: LinkCardRequest, LinkCards
- `mentioned-records.ts`: MentionedRecords
- `project-command-proposals.ts`: ProjectCommandProposals
- `proposal-appliers.ts`: ProposalApplier, SettingProposalApplier, ProposalAppliers
- `proposal-service.ts`: ProposalService
- `role-proposals.ts`: RoleProposals
- `session-log.ts`: SessionEvent, SessionLogger, sessionLogLines
- `session-memory.fixtures.ts`: MemoryAsk, sessionMemoryProvider
- `session-memory.ts`: SessionMemory
- `session-places.ts`: SessionPlace, SessionPlaces
- `session-role.fixtures.ts`: aPlannerCard
- `stage-decisions.ts`: StageDecisionRequest, OpenedStageDecision, StageDecisions
- `stage-threads.ts`: StageSessionSettings, StageThreadRequest, StageTurn, AskedDecision, StageThread, StageThreads
- `task-thread-setups.ts`: TaskThreadRequest, TaskThreadSetup, TaskThreadSource, TaskThreadSetups
- `task-tokens.ts`: TaskTokens
- `thread-contexts.ts`: ThreadContexts
- `thread-runner.ts`: Answerer, ThreadRunner
- `thread-service.ts`: TaskThreadOpening, InitiativeThreadOpening, ThreadService
- `work-records.ts`: WorkRecordSource, WorkRecords
- Tests: briefs.test.ts, consultations.test.ts, devops-proposals.test.ts, held-calls.test.ts, link-cards.test.ts, proposal-service.test.ts, session-memory.test.ts, stage-threads.test.ts, test-project-check.test.ts, thread-runner.test.ts

### domain/

- `brief.ts`: Brief, BriefProject, CHAT_EXCHANGES_TOKENS, MEMORY_TOKENS, estimatedTokens, BriefMemoryNote, BriefMemory, NO_MEMORY, selectMemory, newChatThreadBrief, freshChatThreadBrief, TaskThreadRecord, taskThreadBrief, InitiativeThreadRecord, initiativeThreadBrief
- `chat-not-found.ts`: ChatNotFound
- `consult.ts`: THE_OFFICE, APPROVAL_OPTIONS, approvalQuestion, isApproval, PASS_ON_STEPS, Consult, ConsultedParty, ConsultantPerson, consultantNamed, passedOnTo, consultDecision, consultantAnswerProblems, consultationTitle, consultationOpening
- `context-policy.ts`: SessionDefault, ContextMove, ContextReason, ContextPolicySettings, DEFAULT_CONTEXT_POLICY_SETTINGS, Continuation, ContextAlternative, ContextDecision, decideContext
- `conversation-events.ts`: ThreadStarted, ThreadRenamed, MessagesLogged, DeliveryMarked, TurnEnded, TokensCounted, ContextOverrideChosen, DecisionOpened, DecisionAnswered, DecisionReopened, ProposalDrafted, ProposalApplied, ProposalDeclined, SizeThresholdChanged
- `decision-not-found.ts`: DecisionNotFound
- `decision.fixtures.ts`: aDecision
- `decision.ts`: Recommendation, DecisionDraft, DecisionAnswer, GivenAnswer, PassedOn, Decision, decisionProblems, answerProblems, answerWords
- `held-call.ts`: HeldCallRuling, heldCallRuling
- `link-card.ts`: LinkedTask, linkCardNote
- `mention.ts`: Mention, MentionedRecord, briefWithMentionedRecords, withMentionedRecords, decisionRecordText
- `message.ts`: Message, MessageDraft, StageWorkClosing, HeldBy, MessageDelivery, IdeaCard, OfficeStatusCard
- `proposal-changes.ts`: ProposalChange, applyProposal, declineProposal
- `proposal-not-found.ts`: ProposalNotFound
- `proposal-refused.ts`: ProposalRefused
- `proposal.fixtures.ts`: aProposedCard, aProposal
- `proposal.ts`: ProposedChanges, ProposedChangeKind, ProposedChange, RoleCardFields, ProposedHire, ProposedPresetHire, ProposedRoleChange, OFFICE_SETTINGS, OfficeSetting, ProposedSettingChange, ProposedInitiativeChange, InitiativeEdit, ProposedProjectCommands, ProposedPipelineChange, PipelineStage, ProposalStatus, Proposal, EditedHire, proposedRoleChange, proposedChangeProblems, changeToApply, refuseUnlessOpen
- `session-instructions.ts`: SessionPersonCard, chatInstructions, workThreadInstructions, CHAT_OFFICE_TOOLS, PROPOSE_ROLE_TOOL, PROPOSE_OFFICE_SETTING_TOOL, POST_LINK_CARD_TOOL, SHOW_OFFICE_STATUS_TOOL, PROPOSE_PROJECT_COMMANDS_TOOL, PROPOSE_LIBRARY_PIPELINE_TOOL, LIST_PIPELINES_TOOL, chatOfficeTools, roleOfficeTools, ANSWER_CONSULTATION_TOOL, CONSULTATION_OFFICE_TOOLS, consultationInstructions, REMEMBER_TOOL, CHANGE_ROLE_TOOL, sessionOfficeTools, HANDOVER_REQUEST, briefedMessage, openingMessage, decisionAnswerMessage
- `thread-changes.ts`: ThreadChange, DeliveryMarking, ChatPerson, startChatThread, TaskThreadStart, startTaskThread, startStageThread, startConsultationThread, InitiativeThreadStart, startInitiativeThread, renameThread, logMessages, freshSession, Answering, Opening, beginAnswer, bargeIn, markDelivery, DecisionOpening, openDecision, ProposalDrafting, draftProposal, DecisionAnswering, answerDecision, DecisionRecording, recordDecisionAnswer, beginOpening, beginStageWork, StageWorkEnding, endStageWork, TurnCount, endTurn, countRunningTurn, UnopenedSession, failAnswer, failDecisionAnswer, putDecisionToUser, PassingOn, passDecisionOn, chooseOverride
- `thread-not-found.ts`: ThreadNotFound
- `thread-refused.ts`: ThreadRefused
- `thread-title.ts`: TITLE_LENGTH, titleFrom, titleProblems
- `thread.fixtures.ts`: aThread, aUserMessage
- `thread.ts`: Home, ThreadState, TokenTotals, NO_TOKENS, addTokens, tokensSoFar, ThreadSession, ContextOverride, Consultation, Thread
- `tool-activity.ts`: toolActivitySummary
- `undelivered-messages.ts`: undeliveredSince, waitingMessageIds, workWithUndelivered
- Tests: brief.test.ts, consult.test.ts, context-policy.test.ts, decision.test.ts, held-call.test.ts, mention.test.ts, proposal.test.ts, session-instructions.test.ts, thread-changes.test.ts, tool-activity.test.ts

### ports/

- `conversations-settings.fixtures.ts`: ConversationsSettingsForTests
- `conversations-settings.ts`: ConversationsSettings
- `project-bases.ts`: ProjectBases
- `thread-repository.ts`: ThreadUpdate, ThreadRepository
