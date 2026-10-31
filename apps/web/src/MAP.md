# Web app: map

**Owns:** the shell (A3 · Desk: rail, top bar, status strip, panels, toasts; `shell/`), the Markdown view for what people and The Office write (`shell/markdown-text.tsx`: sanitised, raw HTML shown as text, headings kept out of the page's outline, a link to a Task, Initiative, Decision or Idea shown as its chip, `shell/record-mention.tsx`), the chat modal and conversation views (the composer's `@` picker, `shell/conversation/mention-picker.tsx`, offering Tasks, Initiatives, open Decisions and Ideas; Copy link on a Decision, an Idea or an Initiative, `shell/copy-record-link.ts`; a Proposal's card, `shell/conversation/proposal-card.tsx`, one body and foot per kind (a skill update's shows its files' diff, `shell/skill-update-diff.tsx`, through `shell/unified-diff-view.tsx`, which the Task's Changes tab shares): a new Role's "Edit before hiring" opens People's `/hire?proposal=…`, a preset's Role edits the name in place, an Office setting shows its value then and proposed, refreshing the setting's query once applied, the CTO's change to an Initiative names its Tasks and Project (`AnswerFoot` is the plain Apply / Not now foot; task 22's step 4b owes its Playwright check), and Devops' change to a Project's commands or a library Pipeline's Stages shows now and proposed (`devops-proposal-changes.tsx`, the Stages by `shell/pipelines/pipeline-words.ts`, the commands' words in `shell/project-words.ts`); a Link card, `shell/conversation/link-card.tsx`, with the person's status from Now's running Tasks, `link-card-words.ts`, opening a new chat Thread whose composer takes the Handover note left in the shell's `HandoverNotes`, `handover-notes.tsx`, for the user to edit or leave out; asking someone from a page (`shell/chat/ask-in-chat.tsx`, as `shell/ask-devops.tsx` on a Project's Commands and a library Pipeline) opens a new chat Thread whose composer starts from the question left in `ThreadDrafts`, `thread-drafts.tsx`; an Idea captured in the chat, `shell/conversation/idea-card.tsx`, read live from Work and planned from there with the Planner through `shell/work/use-idea-planning.ts` and `shape-idea-dialog.tsx`, which the Ideas page shares; the Office status, `office-status-card.tsx`, read live from Now), the words a Role card is shown in, shared by People and the Proposal card (`shell/role-card-words.ts`), Attachments, the Stage editor (`shell/pipelines/`: one component for "Edit for this Task" and the tier 2 library, Task-free, fed the service's flags), Notifications' channels and what Now shares with the shell (`shell/notifications/`: the channel port with the in-app and desktop adapters, the tab's title and favicon, the web's own "service down", routed by the user's routing last read; the desktop left out for a Notification quiet hours hold (the toast shows), a raised one taking the place of those it `replaces` (collapsed Outcomes), and the user reported active once a minute while the tab is focused, which holds phone pushes (`shell/user-activity.ts`); `phone` is the service's to push and ignored here; the Needs you panel and its items, answered in place; Now's words; the strip reads the same `now` and `notifications` queries), token counts (`shell/token-count.tsx`: every count shows input, output and cache writes by contracts' `countedTokens`, cache reads left out, with an info icon giving each kind and its cost, `shell/token-words.ts`; Threads, Stages, the Task, Now and the strip; the service sends the four kinds), the floating menu (`shell/floating-menu.tsx`: the design system's Menu with its list portalled to the body and fixed to the window, below its trigger or flipped up, `menu-placement.ts`, so a scrolling parent such as the board doesn't clip it; the same props, so a Menu that clips switches by its import; the Task's "More" menu uses it), the Gate's actions (`shell/work/gate-actions.tsx`, on a Task's record and in Needs you), the Project filter (`shell/project-filter/`: the top bar's picker, which stays open while Projects are turned on and off, so not the design system's Menu; the choice kept in this browser's local storage, never in the address, so no Saved view holds it, and rewritten only by the user; `useProjectFilter` for every surface, its rule `isInProjectFilter` from contracts, `narrowed` splitting what it shows from how many it leaves out; the "N more in other Projects" note with "Show all projects"; Needs you narrowed alike on Now, in its panel and in the strip by `useNeedsYou`, the rail badge never), the fire alarm (`shell/fire-alarm/`: the top bar's "Sound the alarm" / "All clear…", the strip's state with its desks at 0, the note under a chat's composer with "Let <name> act in this thread" / "Take it back", "Paused by the alarm" on `TaskStateBadge`, the review's open state in `FireAlarmReviewProvider`; the alarm is read from Now, its lifts under `["fire-alarm", "lifts"]`, refreshed by `fire-alarm.sounded` and `fire-alarm.all-clear`), the top bar's search (`shell/search/`: ⌘K or Ctrl+K, a combobox over `GET /search` with the Project filter, people matched here from those hired by `searchWords`, which mirrors the service's; a document picked opens in `DocumentDialog`, held by the top bar as the search closes), and `api/`: one file per service module with its fetch functions and query keys, plus the event stream (`event-stream.ts`) that turns the service's web events into query refreshes. Each surface has its own map in `surfaces/<surface>/MAP.md`.

**Talks to:** the service only through `api/` and `@the-office/contracts`; components come from `@the-office/ui` (the design system). The layout is enforced by `tools/lint-rules/src/web-layers.ts`.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `app.tsx`: App
- `main.tsx`
- `router.tsx`: OverPageSearch, IdeasSearch, TaskSearch, HireSearch, router

### api/

- `api-client.ts`: ApiError, shouldRetry, getFromApi, sendToApi, deleteFromApiReturning, sendFileToApi, postToApi, deleteFromApi
- `conversations.ts`: threadQueries, sizeThresholdQuery, changeSizeThreshold, decisionQueries, proposalQueries, applyProposal, declineProposal, fireAlarmLiftsQuery, liftTheAlarm, takeTheLiftBack, startChatThread, sendMessage, renameThread, chooseContextOverride, answerDecision, threadEventInvalidations, threadEventCacheUpdates, homeThreadsQuery
- `event-stream-provider.tsx`: EventInvalidations, EventCacheUpdates, EventStreamProvider, useEventStreamStatus
- `event-stream.ts`: EventStreamStatus, EventStreamOptions, RECONNECT_DELAYS_MS, EventStream
- `notifications.ts`: nowQueries, notificationQueries, setTiming, setRoutingChannel, resetRouting, reportActivity, notificationEventCacheUpdates
- `people.ts`: roleQueries, roleCardQueries, hire, changeRoleCard, filledRoleKeys, letGoOfPerson, hirePersonBack, addMemoryNote, deleteMemoryNote, clearMemory, roleEventInvalidations
- `pipelines.ts`: pipelineQueries, addPipeline, duplicatePipeline, savePipeline, removePipeline, editTaskStages, continueAtGate, sendBackFromGate, dropAtGate, pipelineEventInvalidations
- `projects.ts`: projectQueries, taskChangesKey, addProject, changeCommand, changeInstallInputs, startEnvironmentCheck, changePublishingMode, changeDefaultPipeline, changeUseProjectSkills, projectEventInvalidations
- `skills.ts`: skillQueries, writeSkill, uploadSkill, editSkill, uploadSkillVersion, changeSkillState, changeSkillEveryone, assignSkill, removeSkill, skillEventInvalidations
- `work.ts`: TASKS, FIRE_ALARM, ideaQueries, initiativeQueries, officeWideLimitQuery, changeOfficeWideLimit, soundTheAlarm, giveTheAllClear, savedViewsQuery, saveView, removeView, searchQuery, taskQueries, onboardingsQuery, attachmentQueries, captureIdea, shapeIdea, planIdea, shapeIntoInitiative, startShapingThread, confirmInitiative, dropInitiative, writeInitiativeOutcome, addTaskToInitiative, dropIdea, restoreIdea, createTask, changePriority, changeTags, placeTask, planTask, confirmPlan, confirmDefinitionOfDone, setPipeline, addDependency, removeDependency, markReady, startTask, takeOutOfQueue, moveUpInQueue, pauseTask, stopTask, resumeTask, dropTask, addLink, addFile, removeAttachment, attachmentContentUrl, workEventInvalidations
- Tests: api-client.test.ts, conversations.test.ts, event-stream.test.ts

### shell/

- `ask-devops.tsx`: AskDevopsButton, useDevops, useAskDevops
- `brand-tone.ts`: useBrandTone
- `copy-record-link.ts`: useCopyRecordLink
- `desk.tsx`: Desk, PanelHeadingProps, Panel, PanelHeading, Feed
- `engine-words.ts`: EFFORT_LABELS, modelLabel
- `floating-menu.tsx`: FloatingMenu
- `item-card.tsx`: CardEdge, ItemCard, EmptyCard
- `markdown-text.tsx`: MarkdownText
- `menu-placement.ts`: Box, Size, Placement, menuPlacement
- `page-heading.tsx`: PageHeading, usePageHeadingState, PageHeadingProvider, usePageHeading
- `palette-menu.tsx`: PaletteMenu
- `person-name.ts`: personName, roleName
- `project-chip.tsx`: ProjectChip
- `project-mark.tsx`: ProjectMark
- `project-words.ts`: publishingLabel, COMMAND_KEYS, COMMAND_LABELS, INSTALL_INPUTS_LABEL, installInputsLine
- `rail.tsx`: Rail
- `record-mention.tsx`: RecordMention
- `refusal-alert.tsx`: RefusalAlert
- `role-card-words.ts`: CapabilityInfo, CAPABILITIES, ENGINE_LABELS, SESSION_DEFAULTS, HARD_SWITCH_LABELS, ENFORCEMENT_LABELS, ASKS_YOU_UNTIL_HIRED, RUN_LABELS, RoleTitles, roleTitlesOf, taskLimitLabel, taskLimitShort, hardSwitchValueLabel, permissionProfileLines, RoleCardFieldChange, fieldLabel, changeLine, proposedFieldChanges, skillsChangeLine, fieldValueText
- `shell.tsx`: Shell
- `skill-chip.tsx`: SkillChip
- `skill-update-diff.tsx`: SkillUpdateDiff
- `skill-words.ts`: pinnedVersionLabel, samePinnedVersion, sourceLabel
- `status-strip.tsx`: StatusStrip
- `time.ts`: dayOf, dayAndClockOf, clockOf, momentWords, durationWords
- `toasts.tsx`: Notice, Notices, ToastProvider, useToast, useNotices
- `token-count.tsx`: TokenCount, TokenInfo
- `token-words.ts`: NO_TOKENS, sumTokens, tokenKindLines
- `top-bar.tsx`: TopBar
- `unified-diff-view.tsx`: UnifiedDiffView
- `unified-diff.ts`: DiffLineKind, DiffLine, diffLines
- `use-clock.ts`: useClock
- `use-closed-from-outside.ts`: useClosedFromOutside
- `use-hired.ts`: useHired
- `user-activity.ts`: pageAt, useReportingActivity
- Tests: engine-words.test.ts, markdown-text.test.tsx, menu-placement.test.ts, role-card-words.test.ts, time.test.ts, token-words.test.ts, unified-diff.test.ts, user-activity.test.ts

### shell/attachments/

- `add-attachment-dialog.tsx`: AddAttachmentDialog
- `attachment-chips.tsx`: AttachmentChips, DocumentDialog
- `attachment-picker.tsx`: AttachmentPicker
- `pending-attachment.ts`: PendingAttachment, attach, pendingName

### shell/chat/

- `ask-in-chat.tsx`: AskInChat, useAskInChat, AskInChatButton
- `chat-modal.tsx`: ChatModal
- `use-chat.ts`: ChatControls, useChat

### shell/conversation/

- `composer.tsx`: PrefilledNote, Composer
- `context-bar.tsx`: ContextBar
- `context-words.ts`: MOVE_WORDS, OVERRIDE_WORDS, OVERRIDE_HINTS, tokensShort, contextDetail, contextLabel
- `decision-card.tsx`: DecisionCard
- `devops-proposal-changes.tsx`: ProposedCommandChanges, ProposedStageChanges, ProposedSkillInstallFields, ProposedSkillUpdateFields
- `handover-notes.tsx`: HandoverNote, HandoverNotes, HandoverNotesProvider, useHandoverNotes
- `idea-card.tsx`: IdeaCard
- `link-card-words.ts`: personStatus
- `link-card.tsx`: LinkCard
- `mention-picker.tsx`: Mentions, useMentions
- `mention-words.ts`: MENTION_KINDS, MentionKind, Mentionable, MentionQuery, MENTIONS_SHOWN, mentionQueryAt, mentionables, matchingMentionables, withMentionLinks
- `message-field.tsx`: MessageField
- `message-list.tsx`: MessageList
- `office-status-card.tsx`: OfficeStatusCard
- `office-status-words.ts`: waitingWords, pausedWords
- `proposal-card.tsx`: ProposalCard
- `thread-drafts.tsx`: ThreadDrafts, ThreadDraftsProvider, useThreadDrafts
- `thread-title.ts`: threadTitle
- `thread-view.tsx`: ThreadView
- Tests: context-words.test.ts, link-card-words.test.ts, mention-words.test.ts, message-field.test.tsx, message-list.test.tsx, office-status-words.test.ts, thread-title.test.ts

### shell/fire-alarm/

- `alarm-button.tsx`: AlarmButton
- `alarm-note.tsx`: AlarmNote
- `fire-alarm-review.tsx`: FireAlarmReview, FireAlarmReviewProvider, useFireAlarmReview
- `fire-alarm-words.ts`: AllClearChoice, ALL_CLEAR_CHOICES, ResumePill, ResumeWords, resumeWords, allClearSummary, alarmStateWords, PAUSED_BY_THE_ALARM

### shell/notifications/

- `desktop-channel.ts`: DesktopPermission, desktopPermission, askForDesktopPermission, DesktopChannel
- `in-app-channel.tsx`: useInAppChannel
- `needs-you-feed.tsx`: NeedsYouFeed
- `needs-you-panel.tsx`: NeedsYouPanel
- `notification-channel.ts`: ShownNotification, NotificationChannel
- `notification-channels.ts`: useNotificationChannels, NotificationChannels
- `notification-words.ts`: OFFICE_TITLE, NotificationTarget, targetOf, serviceDown, titleWithUnread, personOf, aboutLine, unreadCount
- `now-words.ts`: OUTCOME_NAMES, OUTCOME_TONES, OUTCOME_EDGES, needsYouWords, desksWords, sinceWords, inStageWords, resetWords, doneSinceYouLeft
- `unread-badge.ts`: useUnreadBadge
- `use-needs-you-panel.ts`: NeedsYouPanelControls, useNeedsYouPanel
- `use-needs-you.ts`: useNeedsYou
- Tests: notification-channels.test.tsx, notification-words.test.ts, now-words.test.ts

### shell/pipelines/

- `pipeline-words.ts`: stagesLine, StageChange, stageChanges
- `stage-editor.tsx`: StageEditorProps, StageEditor
- `stage-edits.ts`: StageKind, AgentStage, ScriptStage, StageCommand, STAGE_KIND_NAMES, STAGE_COMMANDS, addStage, removeStage, canMove, moveStage, replaceStage, withRole, withCommand, canContinue, failureTargets
- Tests: pipeline-words.test.ts, stage-edits.test.ts

### shell/project-filter/

- `in-other-projects-note.tsx`: InOtherProjectsNote
- `project-filter-choices.ts`: knownProjectFilter, showsProject, withProjectToggled, onlyProjectShown, onlyProject, projectFilterLabel, inOtherProjectsWords, Narrowed, narrowed
- `project-filter-menu.tsx`: ProjectFilterMenu
- `project-filter-store.ts`: PROJECT_FILTER_STORAGE_KEY, ProjectFilterStore, createProjectFilterStore
- `use-project-filter.ts`: ProjectFilterControls, useProjectFilter
- Tests: project-filter-choices.test.ts, project-filter-store.test.ts

### shell/search/

- `search-options.ts`: searchWords, peopleMatching, SearchPick, SearchOption, SearchGroup, searchGroups, matchesInOtherProjects
- `top-bar-search.tsx`: TopBarSearch
- Tests: search-options.test.ts

### shell/work/

- `capture-idea-dialog.tsx`: CaptureIdeaDialog
- `drop-task-dialog.tsx`: DropTaskDialog
- `gate-actions.tsx`: GateActions
- `gate-words.ts`: WaitingGate, waitingGateOf, defaultSendBackTarget, sendBackWords, continueLabel
- `shape-idea-dialog.tsx`: ShapeIdeaDialog
- `task-state-badge.tsx`: TaskStateBadge, PriorityIcon
- `use-cto.ts`: useCto
- `use-idea-planning.ts`: useIdeaPlanning, useOnPlanned
- `use-planner.ts`: usePlanner
- `waiting-on-you.ts`: waitsOnYou, waitsOnYouInItsState, useWaitingOnYou, useWaitingOnYouInItsState
- `work-words.ts`: TASK_STATE_NAMES, NOT_STARTED, TASK_STATE_TONES, PRIORITY_NAMES, PRIORITY_ICONS, authorName, projectIdsOfIdea
- Tests: gate-words.test.ts, waiting-on-you.test.ts
