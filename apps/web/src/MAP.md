# Web app: map

## Owns

- The shell (`shell/`): rail (`rail.tsx`, state in `rail-store.ts`), top bar (Create, search, Project filter, fire alarm, user menu, chat button), status strip (`status-strip.tsx`, `strip-figure.tsx`), side panels (Needs you, Activity, conversation drawer), chat drawer (`shell/chat/`), toasts, `RootLayout` (sign-in, first-run setup, Test instance banner).
- Shared kits a surface may draw (a surface never imports another): the Work kit (`shell/work/`), the Pipelines kit and flow editor (`shell/pipelines/`, `flow/`, `flow-routes/`).
- Also shared: conversation views and cards (`shell/conversation/`: Decisions, Proposals, Link cards, bug-task, Allow changes), Notifications (`shell/notifications/`), Attachments (`shell/attachments/`), mentions, commands, Sub-agents and Processes, Activity, devices, test instances, issues, the Markdown view and its copy.
- Shared words (`*-words.ts`: engine, role card, duty, tone, CI run, device state, environment check, usage window, token, notification time).
- `api/`: one file per service module (fetch functions and query keys), `api-client.ts` (`callOfficeAction`, `SignedOut`), `event-stream.ts` (web events to query refreshes, `subscribeToThread`), `pages.ts` (paged lists), `device-relay.ts` and `device-transports/`.

## Talks to

- The service only through `api/` and `@the-office/contracts`; components from `@the-office/ui` (never `design-system/` directly).
- Layers are enforced by `tools/lint-rules/src/web-layers.ts`; `shell-consumers.ts` fails `npm run lint` on a shell file one surface alone uses: move it into that surface.
- Each surface has its own map in `surfaces/<surface>/MAP.md`.

## Traps

- A new action on a record is called with `callOfficeAction` from its contracts declaration.
- Signed out is learned only from a 401 (`SignedOut`, `sendToSignIn`); the event stream starts only once `GET /account` answered (`useConnectedEventStream`), and close code 4401 stops it.
- `RootLayout` chooses bare vs shell by the matches shown, never the location; existing routes stay the root's children (the Open page's route ids expect it).
- Every event handler reads with `safeParse` (`readEvent`); each cache update, invalidation and listener runs apart. An unreadable answer is `UnreadableAnswer`, never retried.
- `zod-without-eval.ts` stays `main.tsx`'s first import: the CSP allows no `eval`.
- Thread-scoped streams (Sub-agent messages, Process output) catch up by sequence (`catch-up.ts`, `useCaughtUpStream`): subscribe first, read only on `onSubscribed`, apply only after `lastSequence`. Only `subscribeToThread` gets a thread-scoped type; tests give `ThreadEventsContext` their own.
- In code a Process is never a variable named `process`.
- Markdown copy reads the rendered DOM: a heading out of the outline carries `data-heading`, a chip `data-markdown-href`, buttons are dropped; a new rendering must carry what the converter needs.
- The flow canvas is scaled by a transform: a measure or pointer divides by drawn width over `offsetWidth`; anything drawn over the page from inside goes to the body. Full screen moves the element to the body and leaves on Escape first. A pressable ≤N× mark is left out of the viewport's pan, or the press pans.
- Anything that animates forever runs on `transform`/`opacity` in a box with `contain: paint`; `.shell-main` stays opaque. Restyle `.live-dot` only through its variables.
- The floating menu's items are `menuitem`s: e2e tests use `getByRole("menuitem")`. The strip hides words by width but keeps them in the DOM: tests read a figure by accessible name, title or one part.
- The chat drawer's place lives in session storage (`chat-store.ts`), not the address; `?chat=…&thread=…` is a way in, taken out as it opens. Every way in goes through `open`.
- Pages lay out by the `page` container (`@container page`); only what is on the body uses `@media`.
- Images: pasted in a message box are handled by the box's own `paste` handler (never doubling a dialog's `usePastedFiles`); a paste with text stays text. Every content address comes from `useAttachmentContentUrl` (`?copy=N`) after `attachment.replaced`.
- Selection checkboxes (the kit's `Checkbox`) carry no event: the row's capture handler notes Shift first.
- `SeenWatcher` uses the global `setTimeout` (tests' fake timers reach it); the Activity feed keeps the items it showed for the visit (`useItemsThisVisit`).
- Every Notification line with `at` goes through `notificationLineOf`.
- The device relay's `writable()` backpressure must be awaited before reading the device again; serial stamped changes re-anchor each time (`MonotonicClock`); register test transports on top (`registerDeviceTransport` stacks).
- Appearance: `AccountAppearance` cancels reads begun before a save; `api/appearance-ids.test.ts` holds contracts' ids equal to `packages/ui`'s.
- Anything new sized to the window takes `--test-instance-banner-height` off `100vh`.
- The design system's tabs' inline styles can't be cloned by jsdom (`create-dialog.test.tsx` reads words without `shownText`); `vitest.setup.ts` gives jsdom a light `matchMedia`.
- Use the density aliases (`--pad-card`, `--pad-row`, …) where a part is drawn; spacing inside a part stays fixed.
- Words more than one surface draws live in the shell. Tests sign in with `shell/user.fixtures.ts`'s `signIn`; `shell/page.fixtures.tsx` opens a page with the service stubbed.

## Spec

- [4 UX direction](../../../docs/spec/4-ux-direction.md), [4.1 UI rules](../../../docs/spec/4.1-ui-rules.md), [screens/shell.md](../../../docs/spec/screens/shell.md), [screens/decision-card.md](../../../docs/spec/screens/decision-card.md), [screens/thread.md](../../../docs/spec/screens/thread.md)
- [screens/activity.md](../../../docs/spec/screens/activity.md), [screens/pipeline-flow-editor.md](../../../docs/spec/screens/pipeline-flow-editor.md), [2.4 Conversations](../../../docs/spec/2.4-conversations.md), [2.10 Users and signing in](../../../docs/spec/2.10-users-and-signing-in.md)
- [2.9 Sub-agents and Processes](../../../docs/spec/2.9-sub-agents-and-processes.md), [2.13 Connected devices](../../../docs/spec/2.13-connected-devices.md), [2.12 Test instances](../../../docs/spec/2.12-test-instances.md), [2.7 Notifications](../../../docs/spec/2.7-notifications.md)

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `app.tsx`: App
- `main.tsx`
- `router.tsx`: OverPageSearch, SignInSearch, LinkedIdentitiesSearch, IdeasSearch, DaysSearch, InitiativeSearch, TestInstanceSearch, ActionRunSearch, TaskSearch, HireSearch, StatsSearch, SystemHealthSearch, OfficeIdentitySearch, PromptTemplatesSearch, FirstRunSetupSearch, router, OfficeRouter
- `signed-out.ts`: officeQueryClient, sendToSignIn
- `zod-without-eval.ts`
- Tests: app.test.tsx, first-run-setup.test.tsx

### api/

- `action-runs.ts`: actionRunQueries, startActionRun, stopActionRun, readActionRunLog, changeActionSettings, ACTION_RUN_CHANGED, actionRunEventInvalidations
- `actions.ts`: actionQueries, saveActions, useSaveActions
- `activity.ts`: activityQueries, markActivitySeen, activityEventInvalidations
- `api-client.ts`: ApiError, SignedOut, RefusedAs, UnreadableAnswer, shouldRetry, getFromApi, sendToApi, deleteFromApiReturning, callOfficeAction, sendFileToApi, sendToApiWithNoAnswer, sendToApiRefusedAs, sendToApiWithNoAnswerRefusedAs, deleteFromApi
- `attachment-copies.ts`: AttachmentCopies, attachmentCopiesOf
- `branch-deletions.ts`: BranchOwnerRef, branchQueries, deleteBranch
- `ci-runs.ts`: ciRunQueries, refreshCiRuns, rerunCiRun, startWorkflow, ciRunEventInvalidations
- `conversations.ts`: threadQueries, readSubAgentMessages, readProcessOutput, sizeThresholdQuery, changeSizeThreshold, stageContextLimitsQuery, changeStageContextLimits, officeInstructionsQuery, changeOfficeInstructions, decisionQueries, proposalQueries, applyProposal, declineProposal, fireAlarmLiftsQuery, liftTheAlarm, takeTheLiftBack, startChatThread, openPersonsThread, sendMessage, uploadMessageImage, renameThread, chooseContextOverride, allowChanges, markThreadSeen, switchChangesOff, answerDecision, stopThread, deleteChatThreads, threadEventInvalidations, threadEventCacheUpdates, withLaterMessages, dropDeletedThreads, homeThreadsKey
- `days.ts`: dayQueries, isTodaysQuery, invalidateToday, useDayLiveUpdates
- `deleted-threads.ts`: rememberDeletedThreads, useThreadDeleted
- `device-relay.ts`: DeviceRelaySink, DeviceTransport, RequestedDevice, UsbDeviceKind, DeviceTransportProvider, registerDeviceTransport, deviceTransportProviders, subscribeToDeviceTransports, DeviceRelayState, DeviceRelay, DeviceRelayOptions, RELAY_HIGH_WATER_BYTES, RELAY_LOW_WATER_BYTES, openDeviceRelay
- `devices.ts`: deviceQueries, addProjectDevice, changeProjectDevice, pairProjectDevice, removeProjectDevice, lendProjectDevice, connectDevice, pairWirelessDevice, usePairWirelessDevice, disconnectDevice, connectRefusalOf, connectRefusalWords, deviceEventInvalidations, projectDeviceEventInvalidations
- `engine.ts`: engineSettingsQuery, changeEngineSettings, engineRemovalQuery, removeEngine, engineAccountQuery, startEngineSignIn, enterEngineSignInCode, pasteEngineToken, setEngineApiKey, refreshEngineModels, signOutOfEngine, useEngineAccountChanged, engineEventInvalidations, engineEventCacheUpdates
- `event-stream-provider.tsx`: EventInvalidations, EventCacheUpdates, readEvent, ThreadEvents, ThreadEventsContext, EventStreamProvider, useOfficeEvent, useThreadEvents, useConnectedEventStream, useEventStreamStatus, useWebAppUpdated
- `event-stream.ts`: EventStreamStatus, EventStreamOptions, ThreadSubscription, SIGNED_OUT_CLOSE_CODE, RECONNECT_DELAYS_MS, EventStream
- `github.ts`: gitHubQueries, gitHubAppManifestForm, startGitHubSignIn, checkGitHubPermissions, signOutOfGitHub, gitHubEventInvalidations
- `google-client.ts`: GOOGLE_CLIENT, googleClientQueries, saveGoogleClient, removeGoogleClient
- `linked-identities.ts`: LINKED_IDENTITIES, linkedIdentityQueries, continueWith, startLinking, unlinkIdentity
- `live-view.ts`: liveViewQueries, liveViewEventCacheUpdates
- `mcp-servers.ts`: mcpServerQueries, addMcpServer, readPastedConfig, changeMcpServer, changeMcpServerState, assignMcpServer, removeMcpServer, mcpServerEventInvalidations
- `notifications.ts`: nowQueries, notificationQueries, setTiming, setRoutingChannel, resetRouting, reportActivity, notificationEventCacheUpdates
- `off-board-tasks.ts`: OFF_BOARD_TASKS, offBoardTaskQueries, startOnboard
- `office-identity.ts`: officeIdentityQueries, regenerateSshKey, scanHost, confirmFingerprint
- `office-updates.ts`: officeUpdateQueries, checkForUpdates, scheduleOfficeUpdate, cancelOfficeUpdate, scheduleOfficeRestart, cancelOfficeRestart, OFFICE_UPDATE_LOG_URL, officeUpdateEventInvalidations
- `openid-connect-provider.ts`: OPENID_CONNECT_PROVIDER, openIdConnectProviderQueries, saveOpenIdConnectProvider, removeOpenIdConnectProvider
- `pages.ts`: pagedQueryOptions, rowsOf, totalOf, changeRows
- `passkeys.ts`: PASSKEYS, passkeyQueries, startAddingPasskey, addPasskey, renamePasskey, removePasskey, startPasskeySignIn, signInWithPasskey
- `people.ts`: ENGINE_CASCADE, taskEngineCascadeKey, DUTIES, roleQueries, roleCardQueries, dutyQueries, changeDuty, hire, changeRoleCard, filledRoleKeys, letGoOfPerson, hirePersonBack, uploadAvatar, removeAvatar, avatarAddress, addMemoryNote, deleteMemoryNote, clearMemory, roleEventInvalidations
- `pipeline-keys.ts`: PIPELINES_KEY, PROJECT_PIPELINES_KEY, STAGE_TEMPLATES_KEY, staleStaffing
- `pipelines.ts`: pipelineQueries, standInChoiceQueries, projectPipelineQueries, stageTemplateQueries, refreshPipelineList, refreshStageTemplateList, addPipeline, duplicatePipeline, savePipeline, removePipeline, addProjectPipeline, saveProjectPipeline, removeProjectPipeline, addStageTemplate, saveStageTemplate, removeStageTemplate, applyStageTemplateEdit, editTaskStages, continueAtGate, sendBackFromGate, dropAtGate, switchToStandIn, pipelineEventInvalidations
- `projects.ts`: ISSUE_LINKS, OPEN_ISSUES, REMOTE_NEEDS, RUN_ENVIRONMENTS, TEST_TARGETS_SET_UPS, projectQueries, taskChangesKey, addProject, startRepositoryClone, changeInstallCommand, changeBeforePublishingCommand, changeAfterPublishingCommand, addCommand, changeCommand, removeCommand, changeInstallInputs, saveEnvironment, startEnvironmentCheck, changePublishingMode, changeDeleteMergedBranches, changeRunEnvironment, setUpRunEnvironment, changeMark, changeProjectLimit, ProjectImageVersion, uploadProjectImage, chooseProjectImage, removeProjectImage, projectImageAddress, changeDefaultPipeline, changeKindDefaultPipeline, changeIssueSettings, changeFeatures, importIssues, changeProjectEngine, changeUseProjectSkills, changeProjectSkillUse, changeProjectServerValues, saveTestTargets, askTestTargetsChat, projectEventInvalidations, repositoryCloneEventInvalidations, repositoryFileAddress
- `prompt-templates.ts`: PROMPT_TEMPLATES, promptTemplateQueries, savePromptTemplate, resetPromptTemplate, promptTemplateEventInvalidations
- `pull-requests.ts`: pullRequestQueries, refreshPullRequests, mergePullRequest, closePullRequest, pullRequestRefusalOf, pullRequestEventInvalidations
- `run-environments.ts`: runEnvironmentOfficeLimitsQuery, changeRunEnvironmentOfficeLimits, runEnvironmentEventInvalidations
- `skills.ts`: skillQueries, writeSkill, uploadSkill, editSkill, uploadSkillVersion, changeSkillState, changeSkillEveryone, assignSkill, removeSkill, skillEventInvalidations, skillEventCacheUpdates
- `telemetry.ts`: TELEMETRY_SETTINGS, BASIC_STATS, BASIC_STATS_REFRESH_MS, FULL_STATS, FULL_STATS_STARTING_REFRESH_MS, SYSTEM_HEALTH, SYSTEM_HEALTH_HOUR_REFRESH_MS, SYSTEM_HEALTH_TIMEOUT_MS, statsQueries, telemetryQueries, saveTelemetry, startBundledGrafana, checkGrafana
- `test-instances.ts`: testInstanceQueries, launchTestInstance, launchOnBranch, stopTestInstance, openTestInstance, testBuildFileAddress, linkTestBuildFile, readTestInstanceLog, changeTestInstanceSettings, TEST_INSTANCE_CHANGED, testInstanceEventInvalidations
- `users.ts`: ACCOUNT, USERS, FIRST_RUN_SETUP, userQueries, userEventInvalidations, addUser, newOneTimePassword, removeUser, setFirstPassword, changeProfile, changePassword, saveAppearance, createFirstUser, closeFirstRunSetup, signInWithPassword, signInWithCode, setUpAuthenticator, confirmAuthenticator, turnOffAuthenticator, makeNewRecoveryCodes, signOut, signOutDevice, SIGN_IN_PATH, SIGN_IN_CODE_PATH, returnPathOf
- `work.ts`: TASKS, PERSON_TASKS, FIRE_ALARM, ideaQueries, ArchivedInitiativesAsked, initiativeQueries, officeWideLimitQuery, changeOfficeWideLimit, archivePeriodQuery, changeArchivePeriod, autoModeQuery, usageSettingsQuery, changeUsageSettings, soundTheAlarm, giveTheAllClear, savedViewsQuery, saveView, removeView, searchQuery, taskQueries, EveryTask, useEveryTask, onboardingsQuery, attachmentQueries, SHOWN_TEXT_LIMIT, ShownText, captureIdea, editIdea, shapeIdea, planIdea, shapeIntoInitiative, startShapingThread, planInitiative, planInitiativeWith, startReadyTasks, confirmInitiative, initiativeBackToShaping, pauseInitiative, resumeInitiative, dropInitiative, archiveInitiative, restoreInitiative, writeInitiativeOutcome, setInitiativePipelines, addTaskToInitiative, dropIdea, restoreIdea, createTask, changePriority, changeKind, changeCausedBy, changeFoundInVersion, changeTags, placeTask, changeTitle, changeDescription, changeCommitMessage, changeTaskEngine, changeInitiativeEngine, planTask, makeAPlan, PlanSaving, savePlan, confirmPlan, saveDefinitionOfDone, confirmDefinitionOfDone, setPipeline, addDependency, removeDependency, addToInitiative, takeOutOfInitiative, markReady, startTask, resolveConflicts, takeOutOfQueue, moveUpInQueue, moveToTopOfQueue, pauseTask, stopTask, resumeTask, restartTask, startTaskOver, reopenTask, moveTask, dropTask, archiveTask, restoreTask, addLink, addFile, removeAttachment, attachmentContentUrl, workEventInvalidations, workEventCacheUpdates
- `workstation.ts`: WORKSTATION_REFRESH_MS, workstationQueries
- Tests: api-client.test.ts, appearance-ids.test.ts, conversations-deleted.test.ts, conversations.full.test.ts, days.test.ts, device-relay.test.ts, engine.full.test.ts, event-stream-provider.full.test.tsx, event-stream.full.test.ts, skills.full.test.ts, users.full.test.ts

### api/device-transports/

- `serial-usb.ts`: SERIAL_PORT_BUSY, DEFAULT_SERIAL_SETTINGS, MonotonicClock, NEEDS_WEB_SERIAL, NEEDS_SECURE_CONTEXT, serialUsbTransport, serialUsbIdsOfKey, serialReopenFailedWords, serialBoardName, serialDeviceKey
- `web-serial.d.ts`
- Tests: serial-usb.test.ts

### shell/

- `account-appearance.tsx`: adoptAccountAppearance, AccountAppearance
- `action-words.ts`: ACTION_KIND_LABELS, ACTION_FIELD_LABELS, ACTION_FIELDS, minutesWords, actionSettingsWords, actionFieldWords, leavesTheWorkstationWords
- `ask-devops.tsx`: AskDevopsButton, useDevops, useAskDevops
- `authority.fixtures.ts`: NEVER_EVERYWHERE, AUTHORITY_AREAS
- `block-loader.tsx`: BlockLoaderShape, BlockLoaderProps, BlockLoader, BlockRead, BlockLoaderOrProblem
- `brand-tone.ts`: useBrandTone
- `ci-run-status-words.ts`: CI_RUN_STATUS_WORDS
- `code-answer-field.tsx`: CodeAnswerDraft, NO_CODE_ANSWER, codeAnswerOf, CodeAnswerField, CodeRefusal, useCodeRefusal, CodeRefusalAlert
- `code-host-words.ts`: ciRunName, shortCommit, ciRunProblemWords, CHECKS_WORDS, MERGEABLE_WORDS, pullRequestName, pullRequestProblemWords, checkedWords
- `copy-record-link.ts`: useCopyRecordLink
- `copy-text.ts`: CopyWords, useCopyText
- `desk.tsx`: Desk, PanelHeadingProps, Panel, PanelHeading, Feed
- `device-state-words.ts`: DEVICE_STATE_WORDS, DEVICE_STATE_TONES
- `duties.fixtures.ts`: aDuty
- `duty-unheld-note.tsx`: DutyUnheldNote
- `duty-words.fixtures.ts`: roleFor, CARETAKER, PLANNER, DEVOPS, DEVELOPER_LET_GO, dutyOf
- `duty-words.ts`: DUTY_LABELS, STAGE_DUTIES, dutyHolder, NOBODY, dutyDescription, fallbackWords, labelsFallingBackTo, holderOptions, dutiesHeldBy, holderName, holderNameOf, letGoHolderWords, passedOverWords, dutyLabels, suitsWords, dutyCountWords
- `engine-offers.ts`: ENGINES_DEFAULT_CHOICE, TypeOffer, typeOfferOf, modelChoices
- `engine-type-account-fields.tsx`: EngineTypeAccount, AccountChoice, EngineTypeChoice, OfficeDefaultChoice, officeDefaultLabel, EngineTypeAccountFields
- `engine-words.ts`: ENGINE_KIND_LABELS, ENGINE_KIND_ICONS, ENGINE_KINDS, EFFORT_LABELS, modelLabel, noLongerOfferedModelLabel, runEngineWords, standInForWords
- `environment-check-words.ts`: ENVIRONMENT_CHECK_STATE_WORDS
- `floating-menu.tsx`: FloatingMenu
- `github-permissions-prompt.tsx`: permissionWords, GitHubPermissionsPrompt
- `google-mark.tsx`: GoogleMark
- `google-words.ts`: googleUnavailableWords
- `image-row.tsx`: IMAGE_LIMIT_IN_MB, ImageChanging, ImageRow, ImageRowEmpty
- `inline-title-edit.tsx`: InlineTitleEdit
- `item-card.tsx`: CardEdge, ItemCard, EmptyCard
- `mark-colours.ts`: markLabelColour
- `markdown-copy-blocks.tsx`: CopyableCodeBlock, CopyableQuote
- `markdown-copy.ts`: CopiedMarkdown, selectionAsMarkdown, markdownOf
- `markdown-text.fixtures.tsx`: rendered, documentOf
- `markdown-text.tsx`: MarkdownText, MarkdownDocument
- `menu-placement.ts`: Box, Size, Placement, menuPlacement
- `office-mark.tsx`: OfficeMark
- `open-page-chip.tsx`: OpenPageChip
- `page-heading.tsx`: PageHeading, usePageHeadingState, PageHeadingProvider, usePageHeading
- `page.fixtures.tsx`: Answers, Sent, stubService, openPage, closePage, until, typed, buttonNamed, shownText
- `passkey-words.ts`: passkeysUnavailableWords, elsewhereWords, elsewhereHref, passkeyAtWords
- `person-avatar.tsx`: PersonAvatar
- `person-name.ts`: personName, roleName, roleFirstName
- `person-tag.tsx`: PersonTag, NamedTag
- `project-chip.tsx`: ProjectChip
- `project-image.ts`: IMAGE_PALETTES, otherPalette, versionsToTry, useShownProjectImage
- `project-mark.tsx`: ProjectMark
- `project-words.ts`: publishingLabel, INSTALL_LABEL, COMMAND_KINDS, COMMAND_KIND_LABELS, STARTING_COMMANDS, INSTALL_INPUTS_LABEL, installInputsLine
- `rail-item.tsx`: RailItemFace, RailItemTooltip
- `rail-store.ts`: RAIL_EXPANDED_STORAGE_KEY, RailStore, createRailStore, RailExpansion, useRailExpansion
- `rail.tsx`: Rail
- `record-mention.tsx`: OpenMentionedDecisionContext, RecordMention
- `refusal-alert.tsx`: RefusalAlert
- `role-card-words.ts`: CapabilityInfo, CAPABILITIES, missingCapabilitiesWords, SESSION_DEFAULTS, HARD_SWITCH_LABELS, ENFORCEMENT_LABELS, ASKS_YOU_UNTIL_HIRED, RUN_LABELS, AUTHORITY_ROW_LABELS, AUTHORITY_VALUE_LABELS, CAPPED_NOTE, CAP_REASONS, followedWords, PRESET_DEFAULT, presetDefaultWords, authorityValueLabel, authoritySettingLabel, sameAuthorityValue, ownAndOthersOf, sameAuthoritySetting, settingOf, areaSetting, authoritySummaryLines, jobSettingsWords, authorityInEffect, authorityChoiceOf, authorityValueOf, authorityChoices, RoleTitles, roleTitlesOf, FieldValueNames, ENGINES_DEFAULT, EACH_ENGINES_DEFAULT, effortText, takesEffort, engineSettingsLines, worksWithLines, ENGINE_CASCADE_LEVEL_WORDS, workCascadeLevelWords, modelAndEffortText, engineInCascadeText, workSourceText, taskLimitLabel, taskLimitShort, hardSwitchValueLabel, hardSwitchChoiceOf, hardSwitchValueOf, hardSwitchChoices, editLabel, webLabel, mcpToolKey, mcpToolSettingLines, permissionProfileLines, RoleCardFieldChange, fieldLabel, changeLine, proposedFieldChanges, roleChangeByLine, skillsChangeLine, fieldValueText
- `root-layout.tsx`: RootLayout
- `secret-value-input.tsx`: SecretValueInput
- `secret-value.ts`: SecretOnSave, secretOnSave, SECRET_ON_SAVE_WORDS
- `section-layout.tsx`: MenuSection, SectionLayoutNarrow, SectionLayout
- `shell.tsx`: Shell
- `show-more.tsx`: ShowMore
- `shown-image.ts`: ShownImage, useShownImage
- `side-panel-layout.ts`: SidePanelLayout, sidePanelLayout, useSidePanelLayout
- `side-panels.ts`: SHELL_PANELS_CLOSED, closePagePanels, usePagePanel, useClosingShellPanels
- `skill-chip.tsx`: SkillChip
- `skill-update-diff.tsx`: SkillUpdateDiff
- `skill-uses.ts`: skillUsesLabel
- `skill-words.ts`: pinnedVersionLabel, samePinnedVersion, sourceLabel
- `ssh-host-name.ts`: sshHostName
- `stand-in-engine-rows.tsx`: StandInEngineRow, StandInEngineChoice, withStandInMoved, StandInEngineRows, AddStandIn
- `status-strip.tsx`: StatusStrip
- `strip-figure.tsx`: StripFigureAction, StripFigure, StripLabel
- `test-instance-banner.tsx`: TestInstanceBanner
- `test-target-words.ts`: TEST_TARGET_KIND_LABELS, BUILT_TEST_TARGET_KINDS, ENTRY_POINT_KIND_LABELS, TEST_TARGET_FIELD_LABELS, entryPointWords, testTargetFieldsOf, testTargetFieldWords, commandsBeforeWords, memoryWords
- `text-diff.ts`: textDiff
- `theme-menu.tsx`: ThemeMenu
- `time.ts`: dayOf, dayAndClockOf, clockOf, sameDay, dayLineWords, momentWords, durationWords, shortDurationWords
- `toasts.tsx`: Notice, Notices, ToastProvider, useToast, useNotices
- `token-count.tsx`: TokenCount, TokenFigure, TokenMeter, TokenInfo
- `token-words.ts`: NO_TOKENS, sumTokens, tokenKindLines
- `tone-badge.tsx`: ToneBadge
- `tone-words.ts`: Tone, ToneWords
- `top-bar.tsx`: TopBar
- `try-again-words.ts`: tryAgainWords, useTryAgainWords
- `unified-diff-view.tsx`: UnifiedDiffView
- `unified-diff.ts`: DiffLineKind, DiffLine, diffLines
- `usage-figure.tsx`: UsageFigure
- `usage-window-words.ts`: pausedByUsageWindowWords, usageWindowUsedUpWords, engineSwitchedWords
- `use-clock.ts`: useClock
- `use-closed-from-outside.ts`: useClosedFromOutside
- `use-duty-holder.ts`: DutyHolder, useDutyHolder, dutyHolderOf, dutyUnheldWords
- `use-engine-name.ts`: useEngineName
- `use-hired.ts`: useHired
- `use-narrow-page.ts`: useNarrowPage
- `use-page-scroll-reset.ts`: usePageScrollReset
- `use-placed-list.ts`: usePlacedList
- `use-sign-out.ts`: SignOutOf, useSignOut
- `use-streamed-log.ts`: StreamedLog, LogRead, LogSource, useStreamedLog
- `use-tab-visible.ts`: useTabVisible
- `use-user-name.ts`: You, UserNamer, isSignedInUser, userName, useSignedInUserId, useUserName
- `user-activity.ts`: pageAt, useReportingActivity
- `user-menu.tsx`: UserMenu
- `user.fixtures.ts`: SIGNED_IN, BY_YOU, BY_ANN, signIn
- `workflow-inputs.tsx`: CHOOSE_OPTION, WorkflowInputControl, workflowInputValuesOf
- Tests: ask-devops.test.tsx, code-host-words.full.test.ts, duty-unheld-note.test.tsx, duty-words.full.test.ts, engine-words.full.test.ts, floating-menu.full.test.tsx, mark-colours.full.test.ts, markdown-copy.test.ts, markdown-text.full.test.tsx, markdown-text.test.tsx, menu-placement.full.test.ts, office-mark.test.tsx, person-avatar.full.test.tsx, project-mark.full.test.tsx, rail-store.full.test.ts, role-card-words.full.test.ts, secret-value.test.ts, section-layout.test.tsx, side-panel-layout.test.ts, side-panels.test.tsx, skill-uses.full.test.ts, stand-in-engine-rows.test.tsx, status-strip.full.test.tsx, text-diff.test.ts, time.full.test.ts, token-words.full.test.ts, try-again-words.full.test.ts, unified-diff.full.test.ts, usage-window-words.test.ts, use-page-scroll-reset.test.tsx, user-activity.full.test.ts, user-menu.test.tsx

### shell/activity/

- `activity-feed.tsx`: ActivityFeed
- `activity-figure.tsx`: ActivityFigure, activityFigureName
- `activity-panel-width.ts`: ACTIVITY_PANEL_WIDTH_STORAGE_KEY, ACTIVITY_PANEL_WIDTHS, showActivityPanelWidth, rememberActivityPanelWidth, useActivityPanelLayout
- `activity-panel.tsx`: ActivityPanel
- `activity-words.ts`: ActivityGroup, ACTIVITY_GROUPS, GroupedActivity, groupedActivity, StateWords, stateWords, kindWords, inStateWords, spanWords, detailWords, ActivityPlace, activityPlaceOf, activityCountWords, NOTHING_RUNNING, NOTHING_RUNNING_HERE, WHAT_SHOWS_HERE
- `activity.fixtures.ts`: TASK_ID, INITIATIVE_ID, NOW, taskItem, environmentCheckItem, ciRunItem, testInstanceItem, actionRunItem, failedTaskItem, OFF_BOARD_TASK_ID, offBoardTaskItem, minutesAgo
- `use-activity-panel.ts`: ActivityPanelControls, useActivityPanel
- `use-marking-seen.ts`: SEEN_AFTER_MS, SEND_EVERY_MS, useMarkingSeen, SeenWatcher
- Tests: activity-feed.test.tsx, activity-figure.test.tsx, activity-words.full.test.ts, use-marking-seen.full.test.ts

### shell/attachments/

- `attachment-chips.tsx`: AttachmentChips, DocumentDialog
- `attachment-download-link.tsx`: AttachmentDownloadLink
- `attachment-gallery.tsx`: AttachmentGallery
- `attachment-picker.tsx`: AttachmentPicker
- `attachment-rounds.ts`: AttachmentRound, attachmentRounds, attachmentsOfGateRun, oneRound, roundName
- `attachment-viewer.tsx`: MessageImageShown, ViewedImage, IMAGE_REMOVED, AttachmentViewer
- `html-preview-dialog.tsx`: HtmlPreviewDialog
- `image-thumbnail.tsx`: ImageThumbnail
- `pasted-files.fixtures.ts`: clipboardOf, paste, screenshot
- `pasted-files.ts`: pastedFiles, pastedImageName, usePastedFiles
- `pending-attachment.ts`: PendingAttachment, attach, attachAll, pendingName
- `pending-attachments-field.tsx`: PendingAttachmentsField
- `plain-text-file.tsx`: PlainTextFile
- `use-attachment-content-url.ts`: useAttachmentContentUrl
- Tests: attachment-chips.test.tsx, attachment-gallery.full.test.tsx, attachment-rounds.full.test.ts, attachment-viewer.full.test.tsx, pasted-files.full.test.ts, replaced-attachment.test.tsx

### shell/chat/

- `ask-in-chat.tsx`: AskInChat, ChatThreadToOpen, useOpenWithDraft, useAskInChat, AskInChatButton
- `chat-button.tsx`: CHAT_BUTTON_ELEMENT_ID, ChatButton
- `chat-drawer-width.ts`: CHAT_DRAWER_WIDTH_STORAGE_KEY, CHAT_DRAWER_WIDTHS, OVER_QUERY, ChatDrawerPlace, ChatDrawerLayout, showChatDrawerWidth, rememberChatDrawerWidth, chatDrawerLayout, useChatDrawerLayout
- `chat-drawer.tsx`: ChatDrawer
- `chat-standing.tsx`: StandingWords, StandingDot
- `chat-store.ts`: ChatTab, ChatPlace, ChatLanding, CHAT_STORAGE_KEY, ChatStore, tabStorage, createChatStore
- `chat-tabs.tsx`: ChatTabs
- `chat-words.ts`: PersonActivity, ChatPerson, ChatStanding, chatStanding, ChatButtonLook, chatButtonLook, chatButtonWords, withoutThreadShown
- `delete-threads-dialog.tsx`: DoomedThread, DeleteThreadsDialog
- `deletion-words.ts`: DeletionLockWords, deletionLockWords, deleteTitle, deletedToast
- `open-page.ts`: MatchedRoute, openPageOf, useOpenPage
- `thread-selection.ts`: ThreadSelection, NOTHING_PICKED, pickable, pickedAmong, pressRow, pickedMark, pressAll
- `use-chat-people.ts`: useChatPeople, useThreadShown
- `use-chat.tsx`: ChatControls, ChatProvider, useChat, useChatLandingProposal
- Tests: chat-drawer-width.full.test.ts, chat-store.full.test.ts, chat-tabs.full.test.tsx, chat-words.full.test.ts, delete-threads-dialog.test.tsx, open-page.full.test.ts, thread-selection.test.ts

### shell/commands/

- `command-notes.tsx`: CommandNote, CommandHelp, SkillCommandClash
- `command-picker.tsx`: Commands, useCommands
- `command-words.ts`: CommandChoice, COMMAND_KIND_WORDS, commandQueryOf, commandChoices, matchingCommands, officeCommandClashWords
- Tests: commands.full.test.tsx

### shell/conversation/

- `allow-changes.tsx`: AllowChangesBar
- `approval-card.tsx`: ApprovalCard
- `bug-task-card.tsx`: BUG_TASK_GOES, proposesWords, BugTaskCard, BugTaskWindowOf, BugTaskAnswered
- `cache-mark.tsx`: useCacheState, CacheMark
- `changed-fields.tsx`: ChangedFields
- `composer-images.fixtures.tsx`: THREAD_ID, aThread, stubObjectUrls, aFile, ShownComposer, showComposer, drop, dragOver
- `composer.tsx`: PrefilledNote, Composer
- `context-bar.tsx`: ContextBar
- `context-reading-words.ts`: ReadingShown, ReadingPart, ReadingLimitMark, ReadingMeter, ContextReadingLook, threadReadingLook, endedRunReadingLook
- `context-reading.tsx`: SessionRow, ContextReading
- `context-words.ts`: MOVE_WORDS, ContextChoice, CONTEXT_CHOICES, overrideOf, contextChoiceOf, CacheState, cacheStateAt, startsASessionWords, offersAChoice, contextChoiceWords, tokensShort, contextDetail, contextLabel, newSessionLabel, earlierSessionLabel, contextBarLabel, stageContextLimitWords, stageSessionRestartedWords
- `decision-answered.tsx`: DecisionAnswered
- `decision-card.fixtures.tsx`: INITIATIVE_ID, PLANNING_THREAD, TASK_THREAD, CHAT_THREAD, CONSULTATION_ON_TASK, DECISION_ID, TASK, PLANNER, REVIEWER, FORMAT, FILE_NAME, COLUMNS, STORES, aDecision, rendered, buttonsNamed, buttonName, buttonNamed, fieldsLabelled, fieldLabelled, type, click, radio, checkbox, settle
- `decision-card.tsx`: DecisionCardPlace, DecisionCardProps, DecisionCard, DecisionInThread, DecisionCardLinkContext
- `decision-compact.tsx`: CompactDecision
- `decision-drafts.tsx`: DecisionDraftsProvider, DecisionDraftHandle, useDecisionDraft, useTakeOver
- `decision-form-words.ts`: QuestionDraft, DecisionDraft, COMPACT_QUESTIONS, FEED_COMPACT_QUESTIONS, decisionSummary, initialDraft, isAnswered, inWords, missingAnswer, submitBlockedWords, answeredCount, progressWords, allChoices, isCompact, canBeDismissed, draftChanges, draftKeptWords, moreQuestionsWords, draftAnswerWords, severalPicks, submittedAnswer, acceptAnswer, askedAgainAnswer, dismissedAnswer, AnsweredLine, answeredLines, formAnswerWords, EMPTY_QUESTION_DRAFT
- `decision-form.tsx`: DecisionFormProps, DecisionForm, Dismissal, useDismissal, DismissButton, DismissStep, ProgressLine
- `decision-on-task.tsx`: DecisionOnTask
- `decision-parts.tsx`: DecisionAnsweringProps, useDecisionThread, useNamedAttachments, bringDecisionCardIntoView, decisionCardElementId, DecisionFrame, DecisionHeading, DecisionDetail, ContextFirstLine, ConsultationNote, TAKE_IT_OVER_FIRST, FollowUpsHint, AnswerRefused, AnsweringHints, stillAnsweringHint, ClosedLine, LinkToConsultation, useConsultationId, consultantName, askerName, useAnswering
- `decision-window.tsx`: DecisionWindow, MentionedDecisionWindow
- `decision-words.ts`: atUsersRequestWords, CLOSED_WORDS, closedWords, namedAttachments, decisionDetailsWords
- `details-store.ts`: DETAILS_STORAGE_KEY, DetailsStore, createDetailsStore, Details, useDetails
- `details-switch.tsx`: DetailsSwitch
- `devops-proposal-changes.tsx`: ProposedCommandChanges, commandWords, ProposedTestTargetChanges, ProposedActionChanges, ProposedStageChanges, ProposedStageFieldChanges, ProposedProjectPipelineFields, ProposedSkillInstallFields, ProposedSkillUpdateFields
- `edit-in-library.ts`: useEditInLibrary
- `handover-notes.tsx`: HandoverNote, HandoverNotes, HandoverNotesProvider, useHandoverNotes
- `idea-card.tsx`: IdeaCard
- `link-card-words.ts`: personStatus
- `link-card.tsx`: LinkCard
- `message-field.tsx`: MessageField
- `message-groups.ts`: TurnMessage, ToolCall, MessageGroup, LogLine, LogPiece, withLogLines, withDayLines, groupedMessages
- `message-images.ts`: PendingMessageImage, UploadMessageImages, MessageImages, useMessageImages, messageImageProblems
- `message-list.tsx`: LINKED_CARD_SELECTOR, SendAgain, HandoverNoteReader, MessageList
- `message-visibility.ts`: visibleMessages, onlyDetailsWouldShow, latestToolCall
- `office-action-proposal.tsx`: OfficeActionChange, SubjectLink, OfficeActionBody
- `office-setup-changes.tsx`: ProposedOfficeSetupChange, officeSetupApplyLabel, ProposedOfficeSetup
- `office-status-card.tsx`: OfficeStatusCard
- `office-status-words.ts`: waitingWords, pausedWords
- `pending-message-images.tsx`: PendingMessageImages
- `proposal-card.tsx`: ProposalCard
- `proposal-on-flow.tsx`: ShowOnFlowButton, showsOnFlow, useProposalShown, OfficeProposalOnFlow, ProjectProposalOnFlow
- `proposal-search.ts`: ProposalSearch, proposalSearchOf
- `proposed-route-changes.tsx`: ProposedRouteChanges, RoutesOutChange, ProposedFlow
- `proposed-routes.fixtures.ts`: FULL_NOW, FULL_PROPOSED, FULL_ROUTES, ROUTES_PROPOSAL_ID, ROUTES_PROPOSAL, PROJECT_ROUTES_PROPOSAL_ID, PROJECT_ROUTES_PROPOSAL
- `stop-button.tsx`: mayStopThread, Stopping, useStopping, StopButton
- `stopped-messages.ts`: UserMessage, stoppedMessages
- `thread-composer.tsx`: ThreadComposer, ReadOnlyNote
- `thread-drafts.tsx`: ThreadDrafts, ThreadDraftsProvider, useThreadDrafts
- `thread-link.tsx`: ThreadLink
- `thread-sessions.ts`: ContextLineMessage, ThreadSession, SessionPieces, threadSessions, piecesBySession
- `thread-title.ts`: threadTitle
- `thread-view.tsx`: ThreadView, ThreadLog, ThreadLoader, ThreadTitle
- `thread-writing.ts`: takesMessages, writingPlaceholder
- `use-answering.ts`: ProposalAnswering, useAnswering
- Tests: bug-task-card.test.tsx, composer-images.full.test.tsx, composer-images.test.tsx, context-reading-words.full.test.ts, context-reading.full.test.tsx, context-words.full.test.ts, decision-card.full.test.tsx, decision-drafts.full.test.tsx, decision-form-words.full.test.ts, decision-on-task.full.test.tsx, decision-words.full.test.ts, details-store.full.test.ts, devops-proposal-changes.full.test.tsx, link-card-words.full.test.ts, message-field.full.test.tsx, message-groups.full.test.ts, message-list-images.full.test.tsx, message-list-kinds.full.test.tsx, message-list.full.test.tsx, message-visibility.full.test.ts, office-status-words.full.test.ts, proposal-card.full.test.tsx, proposal-on-flow.full.test.tsx, stop-button.test.tsx, stopped-messages.test.ts, thread-drafts.test.tsx, thread-sessions.full.test.ts, thread-title.full.test.ts, thread-writing.full.test.ts

### shell/devices/

- `device-parts.tsx`: registerBrowserDeviceTransports, usbKindChoice, DevicesNote
- `device-relays.ts`: keepDeviceRelay, keepsDeviceRelay, deviceNotice, subscribeToDeviceNotices, closeEveryDeviceRelay
- `device-words.ts`: DEVICE_KIND_WORDS, PAIR_WIRELESS_HINTS, PAIR_WIRELESS_ERRORS, KEEP_TAB_OPEN
- `project-device-over-usb.ts`: notReachedWords, openProjectDeviceOverUsb, isTheDevice
- `project-device-words.ts`: PROJECT_DEVICE_STATE_WORDS, PROJECT_DEVICE_STATE_TONES, isOverUsb, holderName, projectDeviceChoiceWords, notAProjectDeviceWords, LAST_USE_ENDED_WORDS
- `run-relays.ts`: RunRelay, RunRelayStart, needsBrowserWords, keepTabOpenWords, useRunRelayStart, useRunRelays
- `wireless-pairing-fields.tsx`: WirelessPairingFields, WirelessPairingErrors, NO_WIRELESS_PAIRING_FIELDS, wirelessPairingOf, phonePortOf, WirelessPairingDraft, useWirelessPairingDraft, WirelessPairingInputs
- Tests: wireless-pairing-fields.test.ts

### shell/devices/android-usb/

- `adb-packets.ts`: ADB_HEADER_LENGTH, ADB_MAX_PAYLOAD, ADB_COMMANDS, ADB_AUTH_TYPES, AdbHeader, AdbPacket, adbHeaderOf, AdbPacketReader, needsZeroLengthTransfer, AdbAuthorisation, adbPacketBytes
- `android-usb-words.ts`: NEEDS_WEBUSB, NEEDS_SECURE_CONTEXT, USB_DEBUGGING_HINT, ALLOW_USB_DEBUGGING, ADB_SERIAL, ANDROID_PHONE, PHONE_IN_USE, NO_SERIAL_NUMBER, NO_USB_DEBUGGING, BrowserSystem, browserSystemOf, accessDeniedWords, hex4
- `webusb-adb.ts`: AndroidUsbOptions, androidUsbTransport
- Tests: adb-packets.test.ts, webusb-adb.test.ts

### shell/fire-alarm/

- `alarm-button.tsx`: AlarmButton
- `alarm-note.tsx`: AlarmNote
- `fire-alarm-review.tsx`: FireAlarmReview, FireAlarmReviewProvider, useFireAlarmReview
- `fire-alarm-words.ts`: AllClearChoice, ALL_CLEAR_CHOICES, ResumePill, ResumeWords, resumeWords, allClearSummary, FireAlarmWayWords, FIRE_ALARM_WAYS, stricterWays, alarmHoldsChats, soundedWords, soundRefusedWords, alarmStateWords, alarmFigureWords, GOING_ON_BADGES, PAUSED_BY_THE_ALARM
- Tests: alarm-button.test.tsx

### shell/issues/

- `import-issues-dialog.tsx`: ImportIssuesDialog, IssuesRefused
- `issue-words.ts`: MOST_PICKED, MOST_LISTED, PICKED_ENOUGH, SIGN_IN_TO_IMPORT, issueImportOf, issuesMatching, openedWords, repositoryOfIssue, issuesPageOf, notImportedWords, importWords, importedWords, IssuesRefusal, issuesRefusalOf
- Tests: issue-words.test.ts

### shell/mentions/

- `mention-field.tsx`: MentionField
- `mention-picker.tsx`: Mentions, useMentions
- `mention-words.ts`: MENTION_KINDS, MentionKind, Mentionable, OPEN_PAGE_MENTION, offersOpenPage, mentionsOpenPage, MentionQuery, MENTIONS_SHOWN, mentionQueryAt, mentionables, matchingMentionables, withMentionLinks
- Tests: mention-words.full.test.ts

### shell/notifications/

- `desktop-channel.ts`: DesktopPermission, desktopPermission, askForDesktopPermission, DesktopChannel
- `in-app-channel.tsx`: useInAppChannel
- `needs-you-feed.tsx`: NeedsYouFeed
- `needs-you-panel-width.ts`: NEEDS_YOU_PANEL_WIDTH_STORAGE_KEY, NEEDS_YOU_PANEL_WIDTHS, showNeedsYouPanelWidth, rememberNeedsYouPanelWidth, useNeedsYouPanelLayout
- `needs-you-panel.tsx`: NeedsYouPanel
- `needs-you-tab.ts`: useNeedsYouTab
- `notification-channel.ts`: NotificationPerson, ShownNotification, NotificationChannel
- `notification-channels.ts`: useNotificationChannels, NotificationChannels
- `notification-words.ts`: OFFICE_TITLE, NotificationTarget, targetOf, serviceDown, tabTitle, blinkingTabTitle, personOf, aboutLine, notificationLineOf, namedTimeWords
- `now-words.ts`: OUTCOME_NAMES, OUTCOME_TONES, OUTCOME_EDGES, needsYouWords, waitingForYouWords, desksWords, sinceWords, inStageWords, resetWords, resetMomentWords, UsageWindows, UsageWindow, NamedUsageWindows, namedUsageWindows, fiveHourWindowName, percentWords, UsageTone, usageTone, meterFilled, UsageReading, UsageFigureWords, usageFigureWords, usageFigureLabel
- `off-board-failed-card.tsx`: OFF_BOARD_TASK_FAILED, RETRY, OPEN_THE_DECISION, failedLineWords, retryHintWords, agoWords, retryAnswer, OffBoardFailedCard, isOffBoardFailure
- `office-messages-slot.tsx`: OfficeMessages
- `office-messages.ts`: OfficeMessage, OfficeMessageSources, OfficeMessageList, officeMessages, OfficeMessageTone, OfficeMessageWords, officeMessageWords, officeMessageKey
- `stand-in-choice-card.tsx`: StandInChoiceCard, StandInChoiceOnTask, useShownChoices
- `stand-in-choice-words.ts`: STAND_IN_CHOICE_TITLE, SWITCH_NOW, SWITCH_ALL_NOW, standInContextLine, contextSizeWords, ranOutWords, NO_ROOM, standInWords, waitsForResetWords, leftWithoutGoingOn, choiceName, whySwitchDisabled, whySwitchAllDisabled, shownChoices, ChoiceNarrowing
- `use-needs-you-panel.ts`: NeedsYouPanelControls, useNeedsYouPanel
- `use-needs-you.ts`: useNeedsYou
- `use-usage-windows.ts`: useUsageWindows
- `use-waiting-for-you.ts`: useWaitingForYou
- `waiting-for-you-feed.tsx`: WaitingForYouGroup, WaitingForYouFeed
- `waiting-for-you-words.ts`: WAITING_FOR_YOU_KIND_NAMES, WAITING_FOR_YOU_KIND_TONES, pullRequestTroubleWords, skillUpdatesWords, officeUpdateWords
- Tests: needs-you-feed.full.test.tsx, needs-you-tab.full.test.tsx, notification-channels.full.test.tsx, notification-words.full.test.ts, now-words.full.test.ts, office-messages.test.ts, stand-in-choice-card.full.test.tsx, stand-in-choice-words.full.test.ts, waiting-for-you-feed.full.test.tsx

### shell/pipelines/

- `apply-template-edit-dialog.tsx`: TemplateEdit, ApplyTemplateEditDialog
- `library-commands.ts`: useLibraryCommands, projectCommandsOf
- `pipeline-choices.ts`: PipelineChoice, PipelineChoiceGroup, ChoosingProject, taskPipelineChoices, openingChoice, defaultPipelineChoices, choiceById, brokenWords
- `pipeline-picker.tsx`: PipelinePicker
- `pipeline-search.ts`: PipelineSearch, pipelineSearchOf
- `pipeline-use-words.ts`: pipelineUseLine, projectPipelineUseLine
- `pipeline-words.ts`: PUBLISH_TARGET_NAMES, PUBLISH_RESULT_NAMES, PUBLISH_TARGET_WORDS, StageFieldChange, stageFieldChanges, stagesLine, copiedFromWords, whoWorks, counted, thousands, StageChange, stageChanges
- `remove-pipeline-dialog.tsx`: RemovePipelineDialog
- `stage-check-alerts.tsx`: StageCheckAlerts
- `stage-commands.ts`: ANOTHER_KEY, StageCommandSource, StageCommandChoice, commandChoices, commandWords, namedCommands, commandKeysOf
- `stage-context-limit-fields.tsx`: StageContextLimitFields
- `stage-edits.ts`: StageKind, AgentStage, ScriptStage, PublishStage, StageCommand, STAGE_KIND_NAMES, STAGE_KIND_ICONS, addStage, addStageFrom, stageFromTemplate, AddedStage, namedAmong, standaloneStage, removeStage, replaceStage, StageWorker, stageWorker, withRole, withDuty, withCommand, canContinue
- `stage-form.tsx`: StageFormProps, StageForm
- `stage-permission-fields.tsx`: StagePermissionFields
- `stage-permissions.ts`: narrowerRuns, narrowerSettings, withPermissions, withMcpToolSetting, withCommands
- `stages-check.ts`: StagesCheckState, checkAwaited, StageProblemsByLevel, byLevel
- `template-link.ts`: WHO_FIELD, TemplateFields, templateFields, fieldsDiffering, fieldsChanged, withTemplateFields, unlinkedStage, templateFieldLabel, templateFieldWords, differenceWords, replacedWords, stageCount, linkedPipelineWords
- `use-pipelines.ts`: useEveryPipeline, useEveryPipelineRead, useProjectPipelineChoices, asPipeline
- `use-save-as-template.ts`: useSaveAsTemplate, shownName
- Tests: pipeline-choices.test.ts, pipeline-use-words.full.test.ts, pipeline-words.full.test.ts, stage-commands.test.ts, stage-edits.full.test.ts, stage-form.test.tsx, stage-permission-fields.test.tsx, stage-permissions.full.test.ts, stages-check.full.test.ts, template-link.test.ts

### shell/pipelines/flow/

- `condition-builder.tsx`: ConditionBuilderProps, ConditionBuilder
- `condition-commands.ts`: ConditionCommandChoice, NO_COMMAND, conditionCommandChoices, conditionCommandKeys, commandNote
- `condition-edits.ts`: TestPath, ConditionItem, StageTest, StageTestIs, DefinitionOfDoneIs, TestSubject, NEW_CONDITION, isGroup, testAt, withTestAdded, withGroupAdded, withoutTest, withTestReplaced, subjectOf, withSubject, withTestIs, withTimes, withCommandKey, withCombine
- `condition-words.ts`: RouteSource, STAGE_TEST_WORDS, PUBLISH_ONLY_TESTS, DEFINITION_OF_DONE_TEST_WORDS, WordsOptions, previousStageLabel, stageNameOrGone, testWords, groupWords, routeTargetName, routeWhen, routeRowWhen, limitMark, atMostWords, followedWhen
- `conflict-chain.ts`: conflictOnlyStages
- `converted-flow.ts`: isConvertedFlow, optionalStageSentences
- `converted-note.tsx`: ConvertedNote
- `elk-in-worker.ts`: elkInWorker
- `flow-add-menu.tsx`: FlowAddMenu
- `flow-auto-align.ts`: FlowCardSize, ElkLayout, AUTO_ALIGN_OPTIONS, alignGraph, alignedPositions, autoAligned, estimatedCardSize
- `flow-canvas.tsx`: FlowCanvasProps, FlowCanvas, FlowCanvasEdit
- `flow-checks.ts`: flowProblems
- `flow-editor-words.ts`: flowSummary, howToHint, addedHint, besideHint, movedInOrderHint, autoAlignedHint, AUTO_ALIGN_UNDONE, AUTO_ALIGN_FAILED, removedHint, onRouteHint, routeRemovedHint, drawnHint
- `flow-editor.tsx`: FlowEditorControls, useFlowEditorControls, FlowEditorProps, FlowEditor
- `flow-layout.ts`: FlowOrientation, NARROW_FLOW_WIDTH, orientationFor, FlowPoint, FlowBox, MeasuredStage, FlowMeasure, FlowLineLook, FlowLine, isMarked, lineMarkWords, FlowPath, FlowStartPath, FlowGridCell, narrowBands, FlowNarrowLayout, narrowLayout, listsRoutes, flowLines, FlowRoom, NO_ROOM, flowRoom, arrowHead, drawingStart, startPath
- `flow-locked.tsx`: FlowLock, FlowLockedNote, FlowLockedFields, lockedTitle
- `flow-marks.ts`: FlowStageMarkTone, FlowStageMark, FlowStageMarks, FlowLocks, NO_LOCKS, FlowOverlay, FlowProgress, FlowTakenRoute
- `flow-model.ts`: ROUTE_BACK_LIMIT, FAILED_CONDITION, PUBLISH_RESULTS, RouteForm, MoveDirection, StageAddedToFlow, RoutesDrawn, RouteDrawn, LockedStages, NOTHING_LOCKED, stageNamed, asFlow, withStageAdded, frozenStages, canMoveStage, withStageMoved, withStagePositioned, FlowPositions, positionsOf, withPositions, stepInOrder, laterStages, isRouteBack, defaultLimit, limitOf, isFailureRoute, choiceCondition, choiceWordsOf, endedResults, endsCondition, routeFormOf, routesWithDrawn, routesWithAdded, formsToAdd, routesWithout, canMoveRouteAmong, routesMoved, routesWithTarget, routesWithLimit, routesWithCondition, withRouteDrawn, withRouteAdded, withRouteRemoved, canMoveRoute, withRouteMoved, withRouteTarget, withRouteLimit, withRouteCondition, withStageOnRoute, withStageRemovedFromFlow
- `flow-overview.tsx`: FlowOverviewProps, FlowOverview
- `flow-panel.tsx`: FlowPanelProps, FlowPanel
- `flow-pick.ts`: FlowPick, pickOfProblem, problemKey
- `flow-problem-alert.tsx`: FlowProblemAlert
- `flow-route-fields.tsx`: FlowRouteTarget, FlowRouteLimit
- `flow-route-panel.tsx`: FlowRoutePanel
- `flow-routes-out.tsx`: FlowRoutesOut
- `flow-snap.ts`: CARD_WIDTH, STAGE_GAP, GRID_STEP, END_SIZE, SNAP_REACH, CLEARANCE, FlowCard, FlowGuide, SnappedMove, SnapOptions, snapMove, ClearSpot, clearSpot, steppedPast, estimatedCardHeight, estimatedBox, freeSpotBeside, EndNeighbour, derivedEndPosition
- `flow-stage-card.tsx`: FlowStageCardProps, FlowStageCard
- `flow-stage-panel.tsx`: FlowStagePanel
- `flow-template-line.tsx`: FlowTemplateLine
- `flow-view.ts`: FlowCanvasEdit, stageProblemsOf, routeHasProblem, routeProblems, noneHoldsAsks, NONE_HOLDS_WORDS, routeName, routeLine, isPickedStage, isPickedRoute, ArrowStep, arrowStep
- `flow-viewport-context.ts`: FlowOverviewBlock, FlowOverviewShape, FlowViewportLink, FlowViewportContext, useFlowViewport
- `flow-viewport.tsx`: FlowViewportProps, FlowViewport
- `flow-zoom.ts`: FlowZoomView, FlowSize, FlowViewPoint, ZOOM_MIN, ZOOM_MAX, ZOOM_STEPS, NAMES_ONLY_BELOW, AT_START, clampZoom, namesOnlyAt, steppedZoom, clampedView, zoomedAround, pannedBy, fittedView, centredOn, withBoxInView, overflows, viewportHeight
- `office-flow-editor.tsx`: OfficeFlowEditorProps, OfficeFlowEditor
- `office-flow-edits.ts`: FlowEdited, FlowDraft, draftAfter, canvasEdited, stageMoved, routeDrawn, routeAdded, routeRemoved, stageAdded, stageOnRoute, stageRemoved
- `proposal-flow.ts`: ProposedStageRoutes, ProposalFlow, proposalFlow, layoutSentences, routeWhenAfterTarget, routesOutSentence, sourceOf, checkedSentence
- `task-flow-editor.tsx`: TaskFlowEditorProps, TaskFlowEditor
- `use-flow-drag.ts`: CardDrag, RouteDrag, FlowDrag, FlowDragging, FlowDragOptions, useFlowDrag
- `use-flow-measure.ts`: FlowView, useFlowMeasure, scaleOf
- `use-overview-choice.ts`: OVERVIEW_STORAGE_KEY, useOverviewChoice
- `use-route-drawing.ts`: ROUTE_DRAWING_STORAGE_KEY, ROUTE_DRAWING_WORDS, useRouteDrawing
- Tests: condition-edits.test.ts, condition-words.test.ts, flow-auto-align.test.ts, flow-checks.test.ts, flow-editor.full.test.tsx, flow-layout.test.ts, flow-model.test.ts, flow-snap.test.ts, flow-zoom.test.ts, proposal-flow.test.ts

### shell/pipelines/flow/flow-routes/

- `curves.ts`: curves
- `mark-spots.ts`: MarkRule, MarkedLine, MARK_AIR, markSpots
- `right-angles.ts`: rightAngles
- `route-drawer.ts`: PortSide, RouteDrawing, ROUTE_DRAWINGS, DEFAULT_ROUTE_DRAWING, LIMIT_MARK, RouteScene, DrawnRoute, DrawnRoutes, RoughDrawing, RouteDrawer
- `route-drawers.ts`: ROUTE_DRAWERS
- `route-ends.ts`: Side, OUTWARD, RouteEnd, RouteEnds, OWN_LOOP, EndOrder, endKey, RowLines, routeEnds
- `route-fixtures.ts`: FixtureName, FIXTURE_NAMES, fixtureScene, gridScene
- `route-frame.ts`: FrameCard, FrameLine, RouteFrame, FramedRoute, routeFrame, drawnRoutes, unionOf, routesById
- `route-geometry.ts`: Pt, add, sub, times, distance, towards, right, bottom, centre, grown, boxAround, boxesOverlap, boxHolds, stretchInBox, stretchHitsBox, lineHitsBox, stretchesCross, crossingsOf, lengthOf, pointAlong, ShapePiece, RouteShape, straightShape, shapePoints, shapeHeading, shapePath, arrowAt
- `straight-lines.ts`: straightLines
- `track-grid.ts`: Track, TrackAxis, PortTrack, LINES_APART, trackAxis, useTrack, isCrowded, portTrack, settleTracks
- `track-router.ts`: Heading, RIGHT, DOWN, LEFT, UP, isLevel, reversed, TrackGrid, trackGrid, nodeAt, columnOf, rowOf, WayEnd, Way, keepNode, keepCorner, takeWay, trackAlong, cornersOf, cheapestWay
- `way-round.ts`: CARD_CLEAR, CORNER_OUT, CROSSING, LINES_APART, WayEnd, WayAsked, CornerUses, ownBoxes, passesClear, runsOutOf, wayRound, LaidLine, laidInArrivalOrder
- Tests: right-angles.test.ts, route-drawers.test.ts

### shell/project-filter/

- `in-other-projects-note.tsx`: InOtherProjectsNote
- `project-filter-choices.ts`: knownProjectFilter, showsProject, withProjectToggled, onlyProjectShown, onlyProject, projectFilterLabel, inOtherProjectsWords, Narrowed, narrowed
- `project-filter-menu.tsx`: ProjectFilterMenu
- `project-filter-store.ts`: PROJECT_FILTER_STORAGE_KEY, ProjectFilterStore, createProjectFilterStore
- `use-project-filter.ts`: ProjectFilterControls, useProjectFilter
- Tests: project-filter-choices.full.test.ts, project-filter-store.full.test.ts

### shell/repository-files/

- `repository-files-words.ts`: leftOutWords, emptyFolderWords, fileSizeWords, pathIn, folderOf, nameOf, foldersAbove, isMarkdownPath

### shell/search/

- `search-options.ts`: searchWords, peopleMatching, SearchPick, SearchOption, SearchGroup, searchGroups, matchesInOtherProjects
- `top-bar-search.tsx`: TopBarSearch
- Tests: search-options.full.test.ts

### shell/sub-agents-and-processes/

- `catch-up.ts`: Sequenced, CaughtUp, CatchUpStep, startingToRead, readingAgain, withPart, withRead
- `sub-agents-and-processes-line.tsx`: SubAgentsAndProcessesLine, SubAgentsAndProcessesLineOf
- `sub-agents-and-processes-view.tsx`: SubAgentsAndProcessesView
- `sub-agents-and-processes-window.tsx`: SubAgentsAndProcessesWindow
- `sub-agents-and-processes-words.ts`: LinePiece, LineWords, lineWords, lineText, listGroups, itemTitle, kindWords, STATE_WORDS, stateWords, secondLine, timeWords, contextWords, ranFor, ranWords, startedByWords, factWords, EndingTone, endingStrip, earlierOutputWords, earlierMessagesWords, sizeWords, whereWords
- `sub-agents-and-processes.fixtures.ts`: THREAD_ID, STARTED_AT, aSubAgent, aProcess, endedAfter, TestThreadEvents, TestService, outputEvent, messagesEvent, itemEvent
- `use-caught-up.ts`: StreamRead, CaughtUpStream, useCaughtUpStream
- `use-sub-agents-and-processes.ts`: useSubAgentsAndProcesses, listWithEvent
- Tests: catch-up.full.test.ts, sub-agents-and-processes-line.full.test.tsx, sub-agents-and-processes-view.full.test.tsx, sub-agents-and-processes-words.full.test.ts, use-sub-agents-and-processes.full.test.ts

### shell/test-instances/

- `open-test-instance-button.tsx`: OpenTestInstanceButton
- `test-build-qr-dialog.tsx`: ShownTestBuildLink, TestBuildQrDialog
- `test-instance-log-window.tsx`: TestInstanceLogWindow
- `test-instance-words.ts`: TEST_INSTANCE_STATE_WORDS, TEST_INSTANCE_STATE_TONES, NEEDS_RUN_ENVIRONMENT, isActive, needsRunEnvironment, isWorking, onDeviceWords, builtForWords, ITS_BUILD, reusingBuildWords, installsWords, FILES_REMOVED, qrTitle, QR_LINK_WORKS, QR_NEEDS_LAN_ADDRESS, qrRefusedTitle, shortCommit, instanceAddress, instanceMoment, instanceLine, NEWER_COMMITS, branchMovedPast, earlierWords, launchRefusedTitle, OTHER_ADDRESSES, OPEN_AT_HEADING, openRefusedTitle, stoppedToast, launchDisabledWhy, logTitle, launchedWords, LogLine, logLinesOf
- `test-target-launch-row.tsx`: TestTargetLaunchRow, NeedsRunEnvironmentNote, TestInstanceStateBadge
- `use-test-instance-actions.ts`: TestInstanceLaunching, TestInstanceActions, useTestInstanceActions
- `use-test-instance-into-view.ts`: useTestInstanceIntoView
- `use-test-instance-log.ts`: ReadLog, useTestInstanceLog
- Tests: test-instance-words.full.test.ts

### shell/work/

- `capture-idea-form.tsx`: CaptureIdeaForm, useCaptureIdea, CaptureIdeaActions, CaptureIdeaBody
- `create-dialog.tsx`: CreateDialog
- `drop-reason-field.tsx`: DropReasonDraft, NO_DROP_REASON, OTHER_REASON_MAX, dropReasonOf, dropReasonWords, DropReasonField
- `drop-task-dialog.tsx`: DropTaskDialog, DropButton, useDroppingTask, WhatDroppingDoes
- `gate-actions.tsx`: ContinueRefused, SendingBack, useSendingBack, SendBackFields, useContinuingAtGate, ContinuingWithNotes, useContinuingWithNotes, ContinueNotesField
- `gate-card-words.ts`: gateQuestion, gateHeading, linesChanged, testsBeforeGate, testsFact, definitionOfDoneFact, UnmetStatement, unmetAtTheCheck, continueAtGateLabel, gateFactsLine, attachmentsOfThisRound
- `gate-card.tsx`: GateCard
- `gate-unmet-statements.tsx`: GateUnmetStatements
- `gate-window.tsx`: GateWindow
- `gate-words.ts`: WaitingGate, waitingGateOf, defaultSendBackTarget, SEND_BACK_WITH_NOTES, sendBackWords, CONTINUE_WITH_NOTES, continueNotesPlaceholder, continueLabel
- `idea-fields.tsx`: IdeaFields
- `initiative-progress.ts`: blockersOf, blockingTasksOf, canHoldBack, InitiativeProgress, initiativeProgress, progressWords
- `kind-field.tsx`: KindField, focusBugOutline
- `needs-you-list.tsx`: NeedsYouList
- `new-task-dialog.tsx`: NewTaskDraft, EMPTY_TASK_DRAFT, NewTaskForm, useNewTask, NewTaskDialog, NewTaskActions, NewTaskBody
- `off-board-task-badge.tsx`: OFF_BOARD_TASK, OffBoardTaskBadge
- `queue-reasons.ts`: QueueReason, queueReasonsOf, reasonsBesideBlockers, distinctShortReasons
- `record-tab.ts`: RecordTab, RECORD_ELEMENT_ID, recordTabOf
- `shape-idea-dialog.tsx`: IdeaShapeChoice, ShapeIdeaDialog
- `tag-words.ts`: tagOf, withTag, tagsInUse
- `tags-input.tsx`: TagsInput
- `task-state-badge.tsx`: TaskStateBadge, PriorityIcon, PriorityGlyph, KindMark, KindGlyph
- `usage-estimate-line.tsx`: UsageEstimateLine, useUsageEstimate
- `usage-estimate-words.ts`: MEASURES, MEASURE_LABELS, usageEstimateWords
- `use-idea-planning.ts`: useIdeaPlanning, useOnPlanned
- `use-planner.ts`: usePlanner
- `waiting-on-you.ts`: waitsOnYou, waitsOnYouInItsState, useWaitingOnYou, useWaitingOnYouInItsState
- `work-words.ts`: TASK_STATE_NAMES, STOPPED, PausedHold, taskStateWords, Archived, isArchived, canBeArchived, NOT_STARTED, TASK_STATE_TONES, PRIORITY_NAMES, PRIORITY_ICONS, KIND_NAMES, KIND_ICONS, KIND_PLURALS, kindDefaultWords, BUG_DESCRIPTION_OUTLINE, BUG_OUTLINE_CURSOR, descriptionForKind, authorName, creatorName, reportedMetCount, projectIdsOfIdea
- Tests: create-dialog.test.tsx, drop-task-dialog.test.tsx, gate-card-words.full.test.ts, gate-words.full.test.ts, new-task-dialog.test.tsx, queue-reasons.full.test.ts, record-tab.test.ts, tag-words.full.test.ts, usage-estimate-words.full.test.ts, waiting-on-you.full.test.ts, work-words.full.test.ts

### shell/workstation/

- `workstation-figure.tsx`: WorkstationFigure
- `workstation-history.ts`: HISTORY_LENGTH, WorkstationRead, withRead, readOf, useWorkstationHistory
- `workstation-panel.tsx`: WorkstationPanel
- `workstation-sparkline.tsx`: WorkstationSparkline
- `workstation-words.ts`: MEASURING, percentWords, cpuUseWords, coresWords, bytesWords, speedWords, loadAverageWords, uptimeWords, LoadLevel, loadLevel, shareOf
- Tests: workstation-figure.full.test.tsx, workstation-history.full.test.ts, workstation-words.full.test.ts
