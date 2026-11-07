# Web app: map

**Owns:** the shell (A3 · Desk: rail, top bar, status strip, panels, toasts; `shell/`), the rail's two states (`shell/rail.tsx`: icon-only with tooltips, or expanded with each item's label beside its icon and no tooltips, switched by the toggle at its foot; the rail sets its own width and the shell's grid follows it; the choice kept in this browser's local storage by `shell/rail-store.ts`, icon-only when none is kept or storage is blocked, never sent to the service), the Markdown view for what people and The Office write (`shell/markdown-text.tsx`: sanitised, raw HTML shown as text, headings kept out of the page's outline, a link to a Task, Initiative, Decision or Idea shown as its chip, `shell/record-mention.tsx`), the chat drawer and conversation views (the composer's `@` picker, `shell/conversation/mention-picker.tsx`, offering Tasks, Initiatives, open Decisions and Ideas; Copy link on a Decision, an Idea or an Initiative, `shell/copy-record-link.ts`; a Proposal's card, `shell/conversation/proposal-card.tsx`, one body and foot per kind (a skill update's shows its files' diff, `shell/skill-update-diff.tsx`, through `shell/unified-diff-view.tsx`, which the Task's Changes tab shares): a new Role's "Edit before hiring" opens People's `/hire?proposal=…`, a preset's Role edits the name in place, an Office limit shows its value then and proposed and the Office instructions their whole new text (scrolling in place when very long), each refreshing the setting's query once applied, the CTO's change to an Initiative names its Tasks and Project (`AnswerFoot` is the plain Apply / Not now foot; task 22's step 4b owes its Playwright check), and Devops' onboarding Proposal shows its Repository URL and the folder it is cloned into when it names one, and Devops' change to a Project's commands or a library Pipeline's Stages shows now and proposed (`devops-proposal-changes.tsx`, the Stages by `shell/pipelines/pipeline-words.ts`, the commands' words in `shell/project-words.ts`); a Link card, `shell/conversation/link-card.tsx`, with the person's status from Now's running Tasks, `link-card-words.ts`, opening a new chat Thread whose composer takes the Handover note left in the shell's `HandoverNotes`, `handover-notes.tsx`, for the user to edit or leave out; asking someone from a page (`shell/chat/ask-in-chat.tsx`, as `shell/ask-devops.tsx` on a Project's Commands and a library Pipeline) opens a new chat Thread whose composer starts from the question left in `ThreadDrafts`, `thread-drafts.tsx`; an Idea captured in the chat, `shell/conversation/idea-card.tsx`, read live from Work and planned from there with the Planner through `shell/work/use-idea-planning.ts` and `shape-idea-dialog.tsx`, which the Ideas page shares; the Office status, `office-status-card.tsx`, read live from Now), the words a Role card is shown in, shared by People and the Proposal card (`shell/role-card-words.ts`, with what an engine declares it can't do, from the card options), a secret value's field, never showing the kept value (`shell/secret-value-input.tsx`, shared by Settings › MCP servers and a Project's Server values), a model's words (`shell/engine-words.ts`), and an engine by its name from Settings › Engines (`shell/use-engine-name.ts`: the Role card, its change history and a Proposal's change, the Usage estimate, Office limits; one no longer listed by its id), Attachments (`shell/attachments/`: chips, Add, and the gallery, `attachment-gallery.tsx`: images as thumbnails opening the viewer, `attachment-viewer.tsx`, which steps through them by Previous/Next and ← →; a Task's grouped into rounds by `attachmentRounds`, each closed by a Gate's send-back, worked out here from the Task's Stages with no service change, the newest open and the earlier folded), the Stage editor (`shell/pipelines/`: one component for "Edit for this Task" and the tier 2 library, Task-free, fed the service's flags; an Agent Stage's permission profile offers only what narrows its Role card's, `stage-permissions.ts`), Notifications' channels and what Now shares with the shell (`shell/notifications/`: the channel port with the in-app and desktop adapters, the tab's title and favicon, the web's own "service down", routed by the user's routing last read; the desktop left out for a Notification quiet hours hold (the toast shows), a raised one taking the place of those it `replaces` (collapsed Outcomes), and the user reported active once a minute while the tab is focused, which holds phone pushes (`shell/user-activity.ts`); `phone` is the service's to push and ignored here; the Needs you panel and its items on Now and in the panel (`needs-you-feed.tsx`: the Task page's cards in `NeedsYouList`, under the Task's title and Project chip, a Decision with when it was asked in place of where; each Gate reads its Task's changes, a git diff in the service, and each Decision its Thread), answered in place, a Decision with nothing to look at by `shell/conversation/decision-card.tsx`, which also has its short and answered forms for a Thread, `DecisionInThread`, and the parts every form shares; wherever it is answered `shell/conversation/decision-on-task.tsx`: answered in place, each answer on its own line, or, naming Attachments, its recommended answer to Accept and Open details, a large window answering as a form (`packages/ui`'s `RadioList`, native radios; a `Dialog` sits on the body and one press of Esc closes one thing by `useCloseOnEscape`: a menu, then a window, then the side panel opened last, by `packages/ui`'s `openSidePanels`, which the Needs you panel, the chat drawer and the conversation's drawer join); Now's words; each engine's usage windows named and in the engines list's order, `use-usage-windows.ts`, an engine no longer listed last by its id; the strip reads the same `now` and `notifications` queries, its usage figure `shell/usage-figure.tsx`, one engine's windows inline, several's behind a list drawn on the page's body as the strip clips what leaves it, placed by `use-placed-list.ts`, which the floating menu shares), token counts (`shell/token-count.tsx`: every count shows input, output and cache writes by contracts' `countedTokens`, cache reads left out, with an info icon giving each kind and its cost, `shell/token-words.ts`; Threads, Stages, the Task, Now and the strip; the service sends the four kinds; `TokenMeter` is the count against the Planner's estimate, in a Task's head when it has one), a page of sections (`shell/section-layout.tsx`: the left-hand menu beside the open section, a row above it at 980px and under, for Settings and a Project's page; an active match leaves the search out, so the Needs you panel doesn't unmark the section), the floating menu (`shell/floating-menu.tsx`: the design system's Menu with its list portalled to the body and fixed to the window, below its trigger or flipped up, `menu-placement.ts`, so a scrolling parent such as the board doesn't clip it; the same props, so a Menu that clips switches by its import; the Task's "More" menu uses it), the Gate's card and window (`shell/work/gate-card.tsx`, `gate-window.tsx`, words in `gate-card-words.ts`, what they do in `gate-actions.tsx`, one set for the Task page, Now and the panel: the window's Open Changes goes to the Task and leaves the panel out of the address, and brings the tab into view only on the Task's own page, by `record-tab.ts`'s `RECORD_ELEMENT_ID`), `NeedsYouList` (`shell/work/needs-you-list.tsx`: what makes a Decision and a Gate read alike as cards; in a Thread `.message` stays a short form), a Usage estimate's line and the measures' words (`shell/work/usage-estimate-line.tsx`, `usage-estimate-words.ts`: the ticked measures, per engine by its name when there are several, the windows left out on an engine id without them, "no estimate" or "no cost", and where it came from; Work and Now show it, Settings › Office limits ticks the measures by the same words), the Project filter (`shell/project-filter/`: the top bar's picker, which stays open while Projects are turned on and off, so not the design system's Menu; the choice kept in this browser's local storage, never in the address, so no Saved view holds it, and rewritten only by the user; `useProjectFilter` for every surface, its rule `isInProjectFilter` from contracts, `narrowed` splitting what it shows from how many it leaves out; the "N more in other Projects" note with "Show all projects"; Needs you narrowed alike on Now, in its panel and in the strip by `useNeedsYou`, the rail badge never), Allow changes in the Caretaker's chat Threads (`shell/conversation/allow-changes.tsx`, shown where `thread.changesAllowed` isn't null: the read-only note with Allow changes, confirmed in a dialog, or the banner with Switch off; each answers with the Thread, set in its query, and its log read again for the "Changes allowed" or "Changes switched off" line), the fire alarm (`shell/fire-alarm/`: the top bar's "Sound the alarm" / "All clear…", the strip's state with its desks at 0, the note under a chat's composer with "Let <name> act in this thread" / "Take it back", "Paused by the alarm" on `TaskStateBadge`, the review's open state in `FireAlarmReviewProvider`; the alarm is read from Now, its lifts under `["fire-alarm", "lifts"]`, refreshed by `fire-alarm.sounded` and `fire-alarm.all-clear`), the Repository file browser (`shell/repository-files/`: `RepositoryFileWindow`, a Medium `Dialog` around `RepositoryFileBrowser`, for any surface; the caller gives the Project, a title, the extensions and `onPick`, which gets the path and the commit; it fetches the base branch once per sitting, `projectQueries.baseBranchFetch`, kept off the Projects' key so no event moves it to another commit, then reads each folder from that commit), the top bar's search (`shell/search/`: ⌘K or Ctrl+K, a combobox over `GET /search` with the Project filter, people matched here from those hired by `searchWords`, which mirrors the service's; a document picked opens in `DocumentDialog`, held by the top bar as the search closes), and `api/`: one file per service module with its fetch functions and query keys, plus the event stream (`event-stream.ts`) that turns the service's web events into query refreshes. Each surface has its own map in `surfaces/<surface>/MAP.md`. The Details switch (`shell/conversation/details-store.ts`, its rule in `message-visibility.ts`, with `onlyDetailsWouldShow` for the line a log shows when the switch alone leaves it empty) is one browser setting for every Thread's log. A direct child of `.message-list` lines up with a turn's words by `--turn-gutter`, unless `conversation.css` names it as The Office's own line.

**The chat drawer** (`shell/chat/`, spec §4, `docs/design/chat-drawer.html`): a side panel in the shell's grid, in column 3 under the strip, so it pushes the page aside, over it at 601–900px, filling the window below (`chat-drawer-width.ts`, with its width in this browser's local storage, resized by `packages/ui`'s `SidePanelEdge`). Where it stands lives in the shell, not the address, in `chat-store.ts` through `ChatProvider` and `useChat`, in this tab's session storage, so links, Back and Forward leave it be and a reload keeps it; `?chat=…&thread=…` stays a way in, taken out of the address as it opens. It lists direct chats only. `chat-button.tsx` at the top bar's end shows `chatButtonLook`, read from `GET /chats/activity` with the hired people with chat on (`use-chat-people.ts`, which leaves the Thread on screen out, so an answer read as it lands never flashes). `useReportingSeen` tells the service the newest message on screen while the tab is visible. Inside it a Mention of a waiting Decision opens its window (`OpenMentionedDecisionContext`) rather than moving the page. Pages lay themselves out by the `page` container on `.shell-main` (`@container page`, each width the window's less the 56px rail), so the open drawer folds them; only what is on the body keeps `@media`, and `shell/use-narrow-page.ts` is the same rule for the conversation's drawer.

**Talks to:** the service only through `api/` and `@the-office/contracts`; components come from `@the-office/ui` (the design system). The layout is enforced by `tools/lint-rules/src/web-layers.ts`. The status strip shows "Update scheduled", with how many things it waits for, from `GET /office-update` while one is scheduled; a Notification pointing at `office-update` opens Settings › Updates.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `app.tsx`: App
- `main.tsx`
- `router.tsx`: OverPageSearch, IdeasSearch, InitiativeSearch, TaskSearch, HireSearch, OfficeIdentitySearch, router

### api/

- `api-client.ts`: ApiError, shouldRetry, getFromApi, sendToApi, deleteFromApiReturning, sendFileToApi, sendToApiWithNoAnswer, deleteFromApi
- `conversations.ts`: threadQueries, sizeThresholdQuery, changeSizeThreshold, officeInstructionsQuery, changeOfficeInstructions, decisionQueries, proposalQueries, applyProposal, declineProposal, fireAlarmLiftsQuery, liftTheAlarm, takeTheLiftBack, startChatThread, openPersonsThread, sendMessage, renameThread, chooseContextOverride, allowChanges, markThreadSeen, switchChangesOff, answerDecision, threadEventInvalidations, threadEventCacheUpdates, homeThreadsQuery
- `engine.ts`: engineSettingsQuery, changeEngineSettings, engineRemovalQuery, removeEngine, engineAccountQuery, startEngineSignIn, enterEngineSignInCode, pasteEngineToken, signOutOfEngine, engineEventInvalidations
- `event-stream-provider.tsx`: EventInvalidations, EventCacheUpdates, EventStreamProvider, useEventStreamStatus
- `event-stream.ts`: EventStreamStatus, EventStreamOptions, RECONNECT_DELAYS_MS, EventStream
- `github.ts`: gitHubQueries, gitHubAppManifestForm, startGitHubSignIn, signOutOfGitHub, gitHubEventInvalidations
- `mcp-servers.ts`: mcpServerQueries, addMcpServer, readPastedConfig, changeMcpServer, changeMcpServerState, assignMcpServer, removeMcpServer, mcpServerEventInvalidations
- `notifications.ts`: nowQueries, notificationQueries, setTiming, setRoutingChannel, resetRouting, reportActivity, notificationEventCacheUpdates
- `office-identity.ts`: officeIdentityQueries, regenerateSshKey, scanHost, confirmFingerprint
- `office-updates.ts`: officeUpdateQueries, checkForUpdates, scheduleOfficeUpdate, cancelOfficeUpdate, OFFICE_UPDATE_LOG_URL, officeUpdateEventInvalidations
- `people.ts`: ENGINE_CASCADE, roleQueries, roleCardQueries, hire, changeRoleCard, filledRoleKeys, letGoOfPerson, hirePersonBack, addMemoryNote, deleteMemoryNote, clearMemory, roleEventInvalidations
- `pipelines.ts`: pipelineQueries, addPipeline, duplicatePipeline, savePipeline, removePipeline, editTaskStages, continueAtGate, sendBackFromGate, dropAtGate, pipelineEventInvalidations
- `projects.ts`: REMOTE_NEEDS, projectQueries, taskChangesKey, addProject, startRepositoryClone, changeCommand, changeInstallInputs, startEnvironmentCheck, changePublishingMode, changeMark, uploadProjectImage, chooseProjectImage, removeProjectImage, projectImageAddress, changeDefaultPipeline, changeProjectDefault, changeUseForEveryRole, changeRoleOverride, changeUseProjectSkills, changeProjectSkillUse, changeProjectServerValues, projectEventInvalidations, repositoryCloneEventInvalidations
- `skills.ts`: skillQueries, writeSkill, uploadSkill, editSkill, uploadSkillVersion, changeSkillState, changeSkillEveryone, assignSkill, removeSkill, skillEventInvalidations
- `work.ts`: TASKS, FIRE_ALARM, ideaQueries, initiativeQueries, officeWideLimitQuery, changeOfficeWideLimit, usageSettingsQuery, changeUsageSettings, soundTheAlarm, giveTheAllClear, savedViewsQuery, saveView, removeView, searchQuery, taskQueries, onboardingsQuery, attachmentQueries, captureIdea, shapeIdea, planIdea, shapeIntoInitiative, startShapingThread, confirmInitiative, dropInitiative, writeInitiativeOutcome, addTaskToInitiative, dropIdea, restoreIdea, createTask, changePriority, changeTags, placeTask, changeDescription, planTask, makeAPlan, PlanSaving, savePlan, confirmPlan, saveDefinitionOfDone, confirmDefinitionOfDone, setPipeline, addDependency, removeDependency, markReady, startTask, takeOutOfQueue, moveUpInQueue, pauseTask, stopTask, resumeTask, dropTask, addLink, addFile, removeAttachment, attachmentContentUrl, workEventInvalidations
- Tests: api-client.test.ts, conversations.test.ts, event-stream.test.ts

### shell/

- `ask-devops.tsx`: AskDevopsButton, useDevops, useAskDevops
- `brand-tone.ts`: useBrandTone
- `copy-record-link.ts`: useCopyRecordLink
- `desk.tsx`: Desk, PanelHeadingProps, Panel, PanelHeading, Feed
- `engine-model-fields.tsx`: OfferedEngine, EngineModelFields
- `engine-words.ts`: EFFORT_LABELS, modelLabel
- `floating-menu.tsx`: FloatingMenu
- `item-card.tsx`: CardEdge, ItemCard, EmptyCard
- `mark-colours.ts`: markLabelColour
- `markdown-text.tsx`: MarkdownText
- `menu-placement.ts`: Box, Size, Placement, menuPlacement
- `page-heading.tsx`: PageHeading, usePageHeadingState, PageHeadingProvider, usePageHeading
- `palette-menu.tsx`: PaletteMenu
- `person-name.ts`: personName, roleName, roleFirstName
- `person-tag.tsx`: PersonTag, NamedTag
- `project-chip.tsx`: ProjectChip
- `project-image.ts`: useShownProjectImage
- `project-logo.tsx`: ProjectLogo
- `project-mark.tsx`: ProjectMark
- `project-words.ts`: publishingLabel, COMMAND_KEYS, COMMAND_LABELS, INSTALL_INPUTS_LABEL, installInputsLine
- `rail-item.tsx`: RailItemFace, RailItemTooltip
- `rail-store.ts`: RAIL_EXPANDED_STORAGE_KEY, RailStore, createRailStore, RailExpansion, useRailExpansion
- `rail.tsx`: Rail
- `record-mention.tsx`: OpenMentionedDecisionContext, RecordMention
- `refusal-alert.tsx`: RefusalAlert
- `role-card-words.ts`: CapabilityInfo, CAPABILITIES, missingCapabilitiesWords, SESSION_DEFAULTS, HARD_SWITCH_LABELS, ENFORCEMENT_LABELS, ASKS_YOU_UNTIL_HIRED, RUN_LABELS, RoleTitles, roleTitlesOf, FieldValueNames, worksWithText, ENGINE_CASCADE_LEVEL_WORDS, engineInCascadeText, taskLimitLabel, taskLimitShort, hardSwitchValueLabel, hardSwitchChoiceOf, hardSwitchValueOf, hardSwitchChoices, editLabel, webLabel, mcpToolKey, mcpToolSettingLines, permissionProfileLines, RoleCardFieldChange, fieldLabel, changeLine, proposedFieldChanges, skillsChangeLine, fieldValueText
- `secret-value-input.tsx`: SecretValueInput
- `secret-value.ts`: SecretOnSave, secretOnSave, SECRET_ON_SAVE_WORDS
- `section-layout.tsx`: MenuSection, SectionLayout
- `shell.tsx`: Shell
- `skill-chip.tsx`: SkillChip
- `skill-update-diff.tsx`: SkillUpdateDiff
- `skill-words.ts`: pinnedVersionLabel, samePinnedVersion, sourceLabel
- `ssh-host-name.ts`: sshHostName
- `status-strip.tsx`: StatusStrip
- `time.ts`: dayOf, dayAndClockOf, clockOf, sameDay, dayLineWords, momentWords, durationWords, shortDurationWords
- `toasts.tsx`: Notice, Notices, ToastProvider, useToast, useNotices
- `token-count.tsx`: TokenCount, TokenFigure, TokenMeter
- `token-words.ts`: NO_TOKENS, sumTokens, tokenKindLines
- `top-bar.tsx`: TopBar
- `unified-diff-view.tsx`: UnifiedDiffView
- `unified-diff.ts`: DiffLineKind, DiffLine, diffLines
- `usage-figure.tsx`: UsageFigure
- `use-clock.ts`: useClock
- `use-closed-from-outside.ts`: useClosedFromOutside
- `use-engine-name.ts`: useEngineName
- `use-hired.ts`: useHired
- `use-narrow-page.ts`: useNarrowPage
- `use-placed-list.ts`: usePlacedList
- `use-tab-visible.ts`: useTabVisible
- `user-activity.ts`: pageAt, useReportingActivity
- Tests: engine-words.test.ts, mark-colours.test.ts, markdown-text.test.tsx, menu-placement.test.ts, project-mark.test.tsx, rail-store.test.ts, role-card-words.test.ts, secret-value.test.ts, time.test.ts, token-words.test.ts, unified-diff.test.ts, user-activity.test.ts

### shell/attachments/

- `add-attachment-dialog.tsx`: AddAttachmentDialog
- `attachment-chips.tsx`: AttachmentChips, DocumentDialog
- `attachment-gallery.tsx`: AttachmentGallery
- `attachment-picker.tsx`: AttachmentPicker
- `attachment-rounds.ts`: AttachmentRound, attachmentRounds, attachmentsOfGateRun, oneRound, roundName
- `attachment-viewer.tsx`: ViewedImage, AttachmentViewer
- `pending-attachment.ts`: PendingAttachment, attach, pendingName
- Tests: attachment-rounds.test.ts

### shell/chat/

- `ask-in-chat.tsx`: AskInChat, useAskInChat, AskInChatButton
- `chat-button.tsx`: CHAT_BUTTON_ELEMENT_ID, ChatButton
- `chat-drawer-width.ts`: CHAT_DRAWER_WIDTH_STORAGE_KEY, CHAT_DRAWER_WIDTHS, ChatDrawerPlace, ChatDrawerLayout, showChatDrawerWidth, rememberChatDrawerWidth, chatDrawerLayout, useChatDrawerLayout
- `chat-drawer.tsx`: ChatDrawer
- `chat-store.ts`: ChatPlace, CHAT_STORAGE_KEY, ChatStore, tabStorage, createChatStore
- `chat-words.ts`: PersonActivity, ChatPerson, ChatStanding, chatStanding, ChatButtonLook, chatButtonLook, chatButtonWords, withoutThreadShown
- `use-chat-people.ts`: useChatPeople, useThreadShown
- `use-chat.tsx`: ChatControls, ChatProvider, useChat
- Tests: chat-drawer-width.test.ts, chat-store.test.ts, chat-words.test.ts

### shell/conversation/

- `allow-changes.tsx`: AllowChangesBar
- `cache-mark.tsx`: useCacheState, CacheMark
- `composer.tsx`: PrefilledNote, Composer
- `context-bar.tsx`: ContextBar
- `context-words.ts`: MOVE_WORDS, ContextChoice, CONTEXT_CHOICES, overrideOf, contextChoiceOf, CacheState, cacheStateAt, startsASessionWords, offersAChoice, contextChoiceWords, tokensShort, contextDetail, contextLabel
- `decision-card.tsx`: DecisionCard, DecisionCardProps, useNamedAttachments, DecisionInThread, bringDecisionCardIntoView, decisionCardElementId, DecisionCardLinkContext, DecisionFrame, AskerTag, DecisionDetail, ConsultationNote, Recommendation, FollowUpsHint, AnswerRefused, stillAnsweringHint, useAnswering
- `decision-on-task.tsx`: useDecisionThread, DecisionOnTask, MentionedDecisionWindow
- `decision-words.ts`: answerWords, namedAttachments, decisionDetailsWords
- `details-store.ts`: DETAILS_STORAGE_KEY, DetailsStore, createDetailsStore, Details, useDetails
- `details-switch.tsx`: DetailsSwitch
- `devops-proposal-changes.tsx`: ProposedCommandChanges, ProposedStageChanges, ProposedSkillInstallFields, ProposedSkillUpdateFields
- `handover-notes.tsx`: HandoverNote, HandoverNotes, HandoverNotesProvider, useHandoverNotes
- `idea-card.tsx`: IdeaCard
- `link-card-words.ts`: personStatus
- `link-card.tsx`: LinkCard
- `mention-picker.tsx`: Mentions, useMentions
- `mention-words.ts`: MENTION_KINDS, MentionKind, Mentionable, MentionQuery, MENTIONS_SHOWN, mentionQueryAt, mentionables, matchingMentionables, withMentionLinks
- `message-field.tsx`: MessageField
- `message-groups.ts`: TurnMessage, ToolCall, MessageGroup, LogLine, LogPiece, withLogLines, withDayLines, groupedMessages
- `message-list.tsx`: HandoverNoteReader, MessageList
- `message-visibility.ts`: visibleMessages, onlyDetailsWouldShow, latestToolCall
- `office-status-card.tsx`: OfficeStatusCard
- `office-status-words.ts`: waitingWords, pausedWords
- `proposal-card.tsx`: ProposalCard
- `thread-composer.tsx`: ThreadComposer, ReadOnlyNote
- `thread-drafts.tsx`: ThreadDrafts, ThreadDraftsProvider, useThreadDrafts
- `thread-title.ts`: threadTitle
- `thread-view.tsx`: ThreadView, ThreadLog, ThreadTitle
- `thread-writing.ts`: takesMessages
- Tests: context-words.test.ts, decision-words.test.ts, details-store.test.ts, link-card-words.test.ts, mention-words.test.ts, message-field.test.tsx, message-groups.test.ts, message-list-kinds.test.tsx, message-list.test.tsx, message-visibility.test.ts, office-status-words.test.ts, proposal-card.test.tsx, thread-title.test.ts

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
- `now-words.ts`: OUTCOME_NAMES, OUTCOME_TONES, OUTCOME_EDGES, needsYouWords, desksWords, sinceWords, inStageWords, resetWords, resetMomentWords, doneSinceYouLeft, UsageWindows, UsageWindow, NamedUsageWindows, namedUsageWindows, fiveHourWindowName, percentWords, UsageFigurePart, usageFigureWords, usageFigureLabel
- `unread-badge.ts`: useUnreadBadge
- `use-needs-you-panel.ts`: NeedsYouPanelControls, useNeedsYouPanel
- `use-needs-you.ts`: useNeedsYou
- `use-usage-windows.ts`: useUsageWindows
- Tests: notification-channels.test.tsx, notification-words.test.ts, now-words.test.ts

### shell/pipelines/

- `pipeline-words.ts`: stagesLine, StageChange, stageChanges
- `stage-editor.tsx`: StageEditorProps, StageEditor
- `stage-edits.ts`: StageKind, AgentStage, ScriptStage, StageCommand, STAGE_KIND_NAMES, STAGE_COMMANDS, addStage, removeStage, canMove, moveStage, replaceStage, withRole, withCommand, canContinue, failureTargets
- `stage-permission-fields.tsx`: StagePermissionFields
- `stage-permissions.ts`: narrowerRuns, narrowerSettings, withPermissions, withMcpToolSetting
- Tests: pipeline-words.test.ts, stage-edits.test.ts, stage-permissions.test.ts

### shell/project-filter/

- `in-other-projects-note.tsx`: InOtherProjectsNote
- `project-filter-choices.ts`: knownProjectFilter, showsProject, withProjectToggled, onlyProjectShown, onlyProject, projectFilterLabel, inOtherProjectsWords, Narrowed, narrowed
- `project-filter-menu.tsx`: ProjectFilterMenu
- `project-filter-store.ts`: PROJECT_FILTER_STORAGE_KEY, ProjectFilterStore, createProjectFilterStore
- `use-project-filter.ts`: ProjectFilterControls, useProjectFilter
- Tests: project-filter-choices.test.ts, project-filter-store.test.ts

### shell/repository-files/

- `repository-file-browser.tsx`: RepositoryFile, RepositoryFileBrowser
- `repository-file-window.tsx`: RepositoryFileWindow
- Tests: repository-file-window.test.tsx

### shell/search/

- `search-options.ts`: searchWords, peopleMatching, SearchPick, SearchOption, SearchGroup, searchGroups, matchesInOtherProjects
- `top-bar-search.tsx`: TopBarSearch
- Tests: search-options.test.ts

### shell/work/

- `capture-idea-dialog.tsx`: CaptureIdeaDialog
- `drop-task-dialog.tsx`: DropTaskDialog, useDroppingTask, WhatDroppingDoes
- `gate-actions.tsx`: ContinueRefused, SendingBack, useSendingBack, SendBackFields, useContinuingAtGate
- `gate-card-words.ts`: gateQuestion, gateHeading, linesChanged, testsBeforeGate, testsFact, definitionOfDoneFact, gateFactsLine, picturesOfThisRound
- `gate-card.tsx`: GateCard
- `gate-window.tsx`: GateWindow
- `gate-words.ts`: WaitingGate, waitingGateOf, defaultSendBackTarget, SEND_BACK_WITH_NOTES, sendBackWords, continueLabel
- `needs-you-list.tsx`: NeedsYouList
- `record-tab.ts`: RecordTab, RECORD_ELEMENT_ID, recordTabOf
- `shape-idea-dialog.tsx`: ShapeIdeaDialog
- `task-state-badge.tsx`: TaskStateBadge, PriorityIcon
- `usage-estimate-line.tsx`: UsageEstimateLine, useUsageEstimate
- `usage-estimate-words.ts`: MEASURES, MEASURE_LABELS, usageEstimateWords
- `use-cto.ts`: useCto
- `use-idea-planning.ts`: useIdeaPlanning, useOnPlanned
- `use-planner.ts`: usePlanner
- `waiting-on-you.ts`: waitsOnYou, waitsOnYouInItsState, useWaitingOnYou, useWaitingOnYouInItsState
- `work-words.ts`: TASK_STATE_NAMES, STOPPED, taskStateWords, NOT_STARTED, TASK_STATE_TONES, PRIORITY_NAMES, PRIORITY_ICONS, authorName, reportedMetCount, projectIdsOfIdea
- Tests: gate-card-words.test.ts, gate-words.test.ts, usage-estimate-words.test.ts, waiting-on-you.test.ts, work-words.test.ts
