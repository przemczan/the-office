# Work surface: map

**Owns:** the Work board (the Project filter narrows its cards, the Tags and Initiatives its bar offers, Ideas with their tab's count, and Initiatives, each with the shell's note of how many more are in other Projects; the board's counts only the Tasks its filters match, and blockers and drag placement still read every Task; each card's Tags; its filters, kept in the address, in `board-filters.ts` with the bar in `filter-bar.tsx`, the search's words matched by the service's `GET /tasks?query=`; its Saved views in `saved-views.tsx`, a view on while the filters are its own, `sameBoardFilters`), a Task's Tags (`tags-input.tsx`, on the Task page in `task-tags.tsx` and in "+ Task"; suggested from the Tasks list, `tag-words.ts`), Ideas (shaped into a Task or an Initiative), Initiatives (the tab's cards with progress, `initiatives-list.tsx`; the Initiative page, `initiative-page.tsx`: the Task graph across Projects, `task-graph.tsx`, laid out in `initiative-words.ts`, blockers outside it dashed; its head's Confirm, "Add a Task" (the new-Task dialog given the Initiative, with what it must wait for) and Drop, `initiative-actions.tsx`; the outcome the user edits while shaping, `outcome-block.tsx`; its record's blocks as folds and its Threads with the CTO as the timeline), and the Task page: the record's tabs (Overview, Changes, Attachments, each in the address as `recordTab`, `record-tab.ts`), Overview's folds (`record-fold.tsx`, each block's memory in this browser's local storage per Task or Initiative, `record-folds.ts`, `useFold`; the Plan and the Definition of Done start open in Planning, the rest folded; an Initiative's Outcome and Attachments start open, as the click-through's do; a folded body stays mounted, so an editor keeps what was typed, and whatever starts from a fold's side, as Edit does, and must be seen calls `fold.open`), the Definition of Done's Reported met, read from `GET /tasks/:id/stages`, never worked out here (`definition-of-done-statements.tsx`), its head's "Open pull request" from the newest finished Publish (`pull-request-button.tsx`), the Needs you card under the rail (`needs-you-card.tsx`, words in `needs-you-words.ts`: the Task's unanswered Decisions whole and answered there, with the Attachments each names beside it, those with a Consultant shown and not counted; the Gate it waits at, `gate-card.tsx` with its words in `gate-card-words.ts`: four facts, the pictures of this round, `GateActions` and Open Changes; in Planning Before Ready holds this place, beside any Decision, `before-ready.tsx`: the checklist from `GET /tasks/:id/readiness`, each line by its `part` with what settles it, Confirm or the Planner's Proposed Pipeline, while Mark Ready stays in the head; otherwise it says where the Task stands, by `needsYouClearWords`, Ready's with its Usage estimate unless queued, and a Dropped Task's over anything left open; a slim bar takes the card's place, sticky at both edges, while it is out of view, `use-in-view.ts`; a `?decision=` link lands on its card, and only this card carries the element id, as the shell's panel can show the same Decision over the page), the Pipeline rail across the page (`pipeline-rail.tsx`, its words in `stage-rail-words.ts`: the library's Stages until the Task has its copy, with "Edit for this Task" in its header; each Stage a button that opens its Stage history under the rail, `stage-history.tsx` with its words in `stage-history-words.ts`, a look kept on the page and not in the address, held by `TaskBody` in `task-page.tsx` as a chapter's link selects too and keyed by Task, stepped with the arrow keys and closed with Esc, heard on the rail and not the document, as the Attachment viewer has the same keys; the loop-backs' arcs from the runs' `carriedFailure`, `loopBacks`, placed by column shares with no measuring; when the Stages don't fit, the rail keeps the current one in view by `scrollLeft` alone, `railScrollLeft`, leaving a reader's scrolling be; a run's "Open its Thread" is the `taskThread` link, which unfolds that chapter and scrolls the timeline to it, so folding the chapter it names takes it off the address and the link works every time), planning, run controls, its dependencies (added and removed before it starts; the board's "Blocked by"), the "Edit for this Task" dialog (the shell's Stage editor on the Task's copy, and the Pipeline swap before Start), and the Task's conversation. The board's card is one link (the title's, stretched over it; its menu, buttons and links sit above), its "More" menu the shell's `FloatingMenu`. The Changes tab folds each file to its header, its part of the diff found by `diffOfFile`, with "Unfold all" and "Fold all". "+ Task" opens the new Task's page; "Add a Task" on an Initiative stays there. The queue for Start (`queue-parts.tsx`, from `GET /queue`): a queued Task's "Queued" mark with its place and reasons on its board card and on its page, where "Move up" and "Take out of the queue" stand in for Start; Start says when it would only join the queue (`start-action.tsx`). The Usage estimate (the shell's `UsageEstimateLine`): on each Ready card, queued ones too, from `GET /usage-estimates`; beside Start and in the card's place under the rail, from the start check; the Planner's token estimate under the Plan. Overlaps: the Plan's files to change under the Plan, edited and confirmed with it (`PlanBlock`'s `PlanEditor` in `planning-parts.tsx`); an Overlap in the start check names the Task in progress and the files, and Start becomes "Start anyway" and "Queue behind it" (`start-action.tsx`). The Task's conversation is the timeline (`thread-timeline.tsx`, words in `timeline-words.ts`: every Thread a chapter in the order they started, folded to a line of tokens and Handover note read from what the page has, so a folded chapter reads no messages; the Thread the user is on and those holding an open Decision start unfolded, and a chapter once unfolded stays so until the user folds it; a chapter's head has a link per Stage the Thread ran, which selects it on the rail and moves focus there, `stage-selection.ts`; a "new messages" button over it, `new-messages.ts`, for what lands in the To and live Threads out of a reader's view, as `use-timeline-scroll.ts` never moves a reader who scrolled up; one composer at the foot, `timeline-foot.tsx`, under the To line, whose rule is `to-line.ts`: it starts on the live Thread, follows it, and offers every writable Thread, with a draft held to its Thread and carried by the one mounted composer; with none writable the foot says why; only the timeline scrolls, by `use-timeline-scroll.ts`, never the page, but for a link the user follows; at 900px and below, on the Initiative page too, it is a drawer, `conversation-drawer.tsx`: one panel always mounted, so a draft, folds and the handle's unread count survive closing, out of sight by `visibility` as the timeline goes on measuring; pressing outside, Esc and Close shut it; a link to a Thread opens it, and an open Decision's link closes it, by what the address gained, `conversation-drawer-address.ts`, or through the shell's `DecisionCardLinkContext` for a link followed again). The Initiative page has the same timeline: it passes no `TimelineWork`, having no Decisions and no Stages, so its To line goes to the newest Thread, and its address names the Thread as `initiativeThread`. Both mark a Thread added while the page is open, such as a Stage's session, New with `threads-seen.ts`, unless the To line is on it, and the user stays where they are. A Task's and an Initiative's page share Attachments (`attachments-block.tsx`, in the shell's gallery: a Task's by round from its Stages, an Initiative's and an Idea's card's in one, an Initiative's in a fold, `InitiativeAttachments`; the Gate's card shows only the current round's pictures, the rest staying in the Attachments tab), Origin (`origin-block.tsx`, a fold on both pages: the Idea, and for a Task its Initiative) and the missing-record view. It reads the service through `src/api/` (see [the web app's map](../../MAP.md)).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `attachments-block.tsx`: AttachmentsBlock, InitiativeAttachments
- `before-ready.tsx`: BeforeReady
- `board-filters.ts`: boardFiltersOf, withoutBoardFilters, hasBoardFilters, sameBoardFilters, withBoardFilter, withTagToggled, tagsOffered, boardFilter
- `board-placement.ts`: placementAmong
- `board.tsx`: Board
- `changes-words.ts`: fileLineWords, TEST_RESULT_WORDS, editorLink, diffOfFile
- `conversation-drawer-address.ts`: DrawerAddress, DrawerMove, drawerMoveOn
- `conversation-drawer.tsx`: ConversationDrawerProvider, useConversationDrawer, useBringThreadIntoView, useDrawerFollowsAddress, ConversationPanel, CloseConversation
- `definition-of-done-statements.tsx`: DefinitionOfDoneStatements, ReportedMetBadge
- `dependencies-block.tsx`: DependenciesBlock
- `dependency-words.ts`: blockersOf, blockingTasksOf, canHoldBack, waitingFor, dependenciesSummary, blockerCandidates
- `edit-task-stages-dialog.tsx`: EditTaskStagesDialog
- `filter-bar.tsx`: FilterBar
- `gate-card-words.ts`: gateQuestion, linesChanged, testsBeforeGate, testsFact, definitionOfDoneFact, picturesOfThisRound
- `gate-card.tsx`: GateCard
- `ideas-page.tsx`: IdeasPage
- `initiative-actions.tsx`: InitiativeActions
- `initiative-page.tsx`: InitiativePage
- `initiative-parts.tsx`: InitiativeStateBadge, InitiativeProjects
- `initiative-words.ts`: INITIATIVE_STATE_TONES, initiativeStateName, tasksOfInitiative, InitiativeProgress, initiativeProgress, progressWords, outcomeSummary, attachmentsSummary, GraphNode, GraphEdge, TaskGraph, taskGraph
- `initiatives-list.tsx`: InitiativesList
- `missing-record.tsx`: MissingRecord
- `needs-you-card.tsx`: NeedsYouCard
- `needs-you-words.ts`: waitingOnYou, needsYouSummary, needsYouClearWords
- `new-messages.ts`: NewMessages, NO_NEW_MESSAGES, WatchedLog, withArrivals, withNewMessagesRead, newMessagesWords, useNewMessages
- `new-task-dialog.tsx`: NewTaskDialog
- `origin-block.tsx`: OriginBlock
- `outcome-block.tsx`: OutcomeBlock
- `part-editor.tsx`: PartEditor
- `pipeline-rail.tsx`: PipelineRail
- `planning-actions.tsx`: PlanButton, MarkReadyButton
- `planning-parts.tsx`: DefinitionOfDoneBlock, PlanBlock, useRecordChange
- `planning-words.ts`: statementsOf, reportedMetCount, definitionOfDoneSummary, planSummary
- `pull-request-button.tsx`: PullRequestButton
- `queue-parts.tsx`: useQueued, QueuedMark, QueueActions
- `record-block.tsx`: RecordBlock
- `record-fold.tsx`: RecordFold
- `record-folds.ts`: RECORD_FOLDS_STORAGE_KEY, FoldedRecord, RecordFoldsStore, createRecordFoldsStore, Fold, useFold
- `record-tab.ts`: RecordTab, RECORD_ELEMENT_ID, recordTabOf
- `resume-words.ts`: ResumeWords, HeldWork, resumeWords, latestRunOf
- `run-controls.tsx`: RunControls
- `saved-views.tsx`: SavedViewsRow
- `stage-history-words.ts`: stageHistoryLine, runTimeWords, runBadge, runResultText, carriedFailureWords, gateChoiceWords, commandRunWords
- `stage-history.tsx`: StageHistory
- `stage-rail-words.ts`: stagesOnRail, currentStageIndex, railScrollLeft, railCaption, stageWorkerWords, railStateWords, railRunsWords, LoopBack, loopBacks, loopBackWords
- `stage-selection.ts`: stageElementId, focusStage
- `stage-words.ts`: STAGE_STATE_WORDS, SESSION_WORDS, StageNames, REMOVED_PIPELINE, pipelineLabel, stageNamesOf, stageRule, pullRequestUrlOf, scriptCommandLine, timeTaken, budgetWords, gateActionWords, firstLine, withoutMarkdownMarks, taskTokens
- `start-action.tsx`: StartButton
- `tag-words.ts`: tagOf, withTag, tagsInUse
- `tags-input.tsx`: TagsInput
- `task-changes.tsx`: ChangesTab, ChangesView
- `task-conversation.tsx`: TaskConversation
- `task-graph.tsx`: TaskGraph
- `task-menu.tsx`: TaskMenu
- `task-page.tsx`: TaskPage
- `task-record.tsx`: TaskRecord
- `task-tags.tsx`: TaskTags
- `thread-timeline.tsx`: ThreadTimeline
- `threads-seen.ts`: ThreadsSeen, threadsSeen, withThreadSeen
- `timeline-foot.tsx`: TimelineFoot
- `timeline-words.ts`: ChapterWork, TimelineWork, NO_TIMELINE_WORK, ChapterFolds, threadsInOrder, chaptersStartingOpen, withChaptersStarted, withChapterOpen, chapterWork, foldedLine
- `to-line.ts`: NO_WRITABLE_THREAD_WORDS, ToLine, writableThreads, liveThread, toLinePicked, toLineNow
- `use-board-filters.ts`: BoardFiltering, useBoardFilters
- `use-in-view.ts`: useInView
- `use-initiative-change.ts`: useInitiativeChange
- `use-planning.ts`: usePlanning, useReadyConditionsMet, useMarkingReady
- `use-shaping.ts`: useShaping, useShapingIntoInitiative
- `use-timeline-scroll.ts`: TimelineScroll, chapterElementId, bringChapterIntoView, useTimelineScroll
- `work-page.tsx`: WorkPage
- Tests: board-filters.test.ts, board-placement.test.ts, changes-words.test.ts, conversation-drawer-address.test.ts, dependency-words.test.ts, gate-card-words.test.ts, initiative-words.test.ts, needs-you-words.test.ts, new-messages.test.ts, planning-parts.test.tsx, planning-words.test.ts, pull-request-button.test.tsx, record-folds.test.ts, resume-words.test.ts, stage-history-words.test.ts, stage-rail-words.test.ts, stage-words.test.ts, tag-words.test.ts, threads-seen.test.ts, timeline-words.test.ts, to-line.test.ts
