# Web app: map

**Owns:** the shell (A3 · Desk: rail, top bar, status strip, panels, toasts; `shell/`), the rail's two states (`shell/rail.tsx`: icon-only with tooltips, or expanded with each item's label beside its icon and no tooltips, switched by the toggle at its foot; the rail sets its own width and the shell's grid follows it; the choice kept in this browser's local storage by `shell/rail-store.ts`, icon-only when none is kept or storage is blocked, never sent to the service), the Markdown view for what people and The Office write (`shell/markdown-text.tsx`: sanitised, raw HTML shown as text, headings kept out of the page's outline, a link to a Task, Initiative, Decision or Idea shown as its chip, `shell/record-mention.tsx`, a link to another page of the app opened in place, Copy on every code block and quote, `shell/markdown-copy-blocks.tsx`), the `@` mentions (`shell/mentions/`: `useMentions` and its picker, `mention-picker.tsx`, offering Tasks, Initiatives, open Decisions and Ideas and linking the records picked on send or save, `mention-words.ts`; used by the chat's composer and, through `mention-field.tsx`'s `MentionField`, which opens the picker under a field, by a Task's Description in New Task and on the Task page, whose fold lets it overflow while open), the chat drawer and conversation views (Copy link on a Decision, an Idea or an Initiative, `shell/copy-record-link.ts`, over the one copy helper with its toast, `shell/copy-text.ts`; a Proposal's card, `shell/conversation/proposal-card.tsx`, one body and foot per kind (a skill update's shows its files' diff, `shell/skill-update-diff.tsx`, through `shell/unified-diff-view.tsx`, which the Task's Changes tab shares): a new Role's "Edit before hiring" opens People's `/hire?proposal=…`, a preset's Role edits the name in place, an Office limit shows its value then and proposed and the Office instructions their whole new text (scrolling in place when very long), each refreshing the setting's query once applied, the CTO's change to an Initiative names its Tasks and Project (`AnswerFoot` is the plain Apply / Not now foot; task 22's step 4b owes its Playwright check), and Devops' onboarding Proposal shows its Repository URL and the folder it is cloned into when it names one, and Devops' change to a Project's commands, a library Pipeline's Stages or a Stage template's Stage shows now and proposed; a Project Pipeline's (`ProposedProjectPipelineFields`, as the adopted design `docs/design/project-pipelines.html` words it: "Add … to <Project>'s Pipelines" or "Change <Project>'s …", each value as was → proposed, its Stage changes Kept or New in the editor's words, `stageChangeLine` in `shell/pipelines/pipeline-words.ts`, and what the Project gets, built by the service's `POST /project-pipelines/check`, never in the web); while a library Pipeline's Proposal is open the card asks `POST /pipelines/check` and lists the Project Pipelines its Stages would break, each with its Project and why, its button then "Apply anyway" (`devops-proposal-changes.tsx`, the Stages, and each field of a template's Stage it rewrites in the Stage editor's words (`stageFieldChanges`), by `shell/pipelines/pipeline-words.ts`, the commands' words in `shell/project-words.ts`); a Link card, `shell/conversation/link-card.tsx`, with the person's status from Now's running Tasks, `link-card-words.ts`, opening a new chat Thread whose composer takes the Handover note left in the shell's `HandoverNotes`, `handover-notes.tsx`, for the user to edit or leave out; asking someone from a page (`shell/chat/ask-in-chat.tsx`, as `shell/ask-devops.tsx` on a Project's Commands, a library Pipeline and a Project's Pipelines) opens a new chat Thread whose composer starts from the question left in `ThreadDrafts`, `thread-drafts.tsx`; an Idea captured in the chat, `shell/conversation/idea-card.tsx`, read live from Work and planned from there with the Planner through `shell/work/use-idea-planning.ts` and `shape-idea-dialog.tsx`, which the Ideas page shares; the Office status, `office-status-card.tsx`, read live from Now), the words a Role card is shown in, shared by People and the Proposal card (`shell/role-card-words.ts`, with what an engine declares it can't do, from the card options), a secret value's field, never showing the kept value (`shell/secret-value-input.tsx`, shared by Settings › MCP servers and a Project's Server values), a model's words (`shell/engine-words.ts`), the run environment question and what Set up run environment and On or Off did (`shell/run-environment-words.ts`, shared by Add a Project, a Project's Run environment block and the Task head's Start notes), and an engine by its name from Settings › Engines (`shell/use-engine-name.ts`: the Role card, its change history and a Proposal's change, the Usage estimate, Office limits; one no longer listed by its id), Attachments (`shell/attachments/`: chips, Add, and the gallery, `attachment-gallery.tsx`: images as thumbnails opening the viewer, `attachment-viewer.tsx`, which steps through them by Previous/Next and ← →; a Task's grouped into rounds by `attachmentRounds`, each closed by a Gate's send-back, worked out here from the Task's Stages with no service change, the newest open and the earlier folded), the Stage editor (`shell/pipelines/`: one component for "Edit for this Task" and the tier 2 library, Task-free, fed the service's flags; a Script Stage's "Project command" comes from a `StageCommandSource` (`stage-commands.ts`): in the library and Stage templates every Project's keys (`useLibraryCommands`), each named with the Projects that have it, then Publish and "Another key…", typed and checked with the contracts' `scriptStageCommandSchema`; in a Task's own editor its Project's commands by name and line, then Publish; a key not offered stays listed, so its problem shows; a Stage's row reads its command with `commandWords`, the key where no Project is known; one Stage's fields in `stage-form.tsx`'s `StageForm`, which a Stage template in Settings › Pipelines shares with `template` set, leaving out "On failure"; the editor reads the Stage templates itself (`stageTemplateQueries.list()`), so both places get "From a template" beside the three kinds, a copy with its own key and a name no other Stage has (`addStageFrom`), and each unlocked Stage's "Save as template"; an Agent Stage's permission profile offers only what narrows its Role card's, `stage-permissions.ts`; a Project Pipeline's Stage changes in `stage-changes-view.tsx`'s `StageChangesView` (docs/design/project-pipelines.html): the rows the service built (`ProjectPipelineCheck`), each marked from the base Pipeline, inserted, replaced, changed or removed, with Insert points, Edit through `StageForm`, Undo, Replace and Remove, a Change's fields beside the base Pipeline's with Set back, and the Stage changes that don't apply with their fixes, read-only without `onChange` for a Proposal's card; its edits in `stage-change-edits.ts`, which find a Stage change by the key it names, never a row's index, and keep a Change to the fields that differ, and its words in `stage-change-words.ts`; a Project Pipeline's commands are its own Project's (`projectCommandsOf`); `RemovePipelineDialog` and `pipelineUseLine` serve both kinds of Pipeline), the one Pipeline picker (`shell/pipelines/pipeline-picker.tsx` over `packages/ui`'s `GroupedSelect`, a select-only combobox whose list opens under its field in named groups, each option with a second line, and a disabled one saying why in its place, as a native `optgroup` can't; docs/design/project-pipelines.html, recommendation 6): `pipeline-choices.ts` gives a Task's groups ("{Project}'s Pipelines", the Project's default first and badged Project default, then "Office-wide Pipelines"; a Broken Project Pipeline listed with a Broken badge and its reasons, never chosen; another Project's never offered) and a default's (the same, unbadged); `use-pipelines.ts` reads a Project's own (`projectPipelineQueries.list`, `GET /project-pipelines?projectId=`) with the office-wide ones, and `useEveryPipeline` finds any Pipeline a Task or a Project names by its id, a Project Pipeline with its built Stages (`projectPipelineQueries.every`, both under the library's key, so `pipeline.added`/`saved`/`removed` read them again); an Initiative's picker, Add a Project and onboarding read `pipelineQueries.list()`, office-wide only, Notifications' channels and what Now shares with the shell (`shell/notifications/`: the channel port with the in-app and desktop adapters, the tab's title and favicon, the web's own "service down", routed by the user's routing last read; the desktop left out for a Notification quiet hours hold (the toast shows), a raised one taking the place of those it `replaces` (collapsed Outcomes), and the user reported active once a minute while the tab is focused, which holds phone pushes (`shell/user-activity.ts`); `phone` is the service's to push and ignored here; the Needs you panel and its items on Now and in the panel (`needs-you-feed.tsx`: the Task page's cards in `NeedsYouList`, under the Task's title and Project chip, a Decision with when it was asked in place of where; each Gate reads its Task's changes, a git diff in the service, and each Decision its Thread), answered in place, a Decision with nothing to look at by `shell/conversation/decision-card.tsx`, which also has its short and answered forms for a Thread, `DecisionInThread` (in an Initiative's planning Thread, which may hold several open at once, one per Task, each names its Task), and the parts every form shares; `useDecisionThread` says the person is answering only outside an Initiative's Thread, where the card stays answerable and says "Reaches <name> when this turn ends" instead (`ReachesAtTurnEndHint`); wherever it is answered `shell/conversation/decision-on-task.tsx`: answered in place, each answer on its own line, or, naming Attachments, its recommended answer to Accept and Open details, a large window answering as a form (`packages/ui`'s `RadioList`, native radios; a `Dialog` sits on the body and one press of Esc closes one thing by `useCloseOnEscape`: a menu, then a window, then the side panel opened last, by `packages/ui`'s `openSidePanels`, which the Needs you panel, the chat drawer and the conversation's drawer join); Now's words; each engine's usage windows named and in the engines list's order, `use-usage-windows.ts`, an engine no longer listed last by its id; the strip reads the same `now` and `notifications` queries, its usage figure `shell/usage-figure.tsx`, one engine's windows inline, several's behind a list drawn on the page's body as the strip clips what leaves it, placed by `use-placed-list.ts`, which the floating menu shares; the Workstation figure, `shell/workstation/workstation-figure.tsx`, polls `GET /workstation/load` itself every 2 s, React Query pausing it while the tab is hidden, so it shows while Now loads, its panel placed the same way (`workstation-panel.tsx`, styled in `workstation.css`, each meter coloured by `loadLevel`), its words in `workstation-words.ts`; it keeps the last 60 reads, about 2 minutes, for the panel's sparklines in `workstation-history.ts`, in this browser only, empty after a reload and not growing while the tab is hidden), token counts (`shell/token-count.tsx`: every count shows input, output and cache writes by contracts' `countedTokens`, cache reads left out, with an info icon giving each kind and its cost, `shell/token-words.ts`; Threads, Stages, the Task, Now and the strip; the service sends the four kinds; `TokenMeter` is the count against the Planner's estimate, in a Task's head when it has one), a page of sections (`shell/section-layout.tsx`: the left-hand menu beside the open section, a row above it at 980px and under, for Settings and a Project's page; an active match leaves the search out, so the Needs you panel doesn't unmark the section), the floating menu (`shell/floating-menu.tsx`: the design system's Menu with its list portalled to the body and fixed to the window, below its trigger or flipped up, `menu-placement.ts`, so a scrolling parent such as the board doesn't clip it; the same props, so a Menu that clips switches by its import; the Task's "More" menu uses it), the Gate's card and window (`shell/work/gate-card.tsx`, `gate-window.tsx`, words in `gate-card-words.ts`, what they do in `gate-actions.tsx`, one set for the Task page, Now and the panel: the window's Open Changes goes to the Task and leaves the panel out of the address, and brings the tab into view only on the Task's own page, by `record-tab.ts`'s `RECORD_ELEMENT_ID`), `NeedsYouList` (`shell/work/needs-you-list.tsx`: what makes a Decision and a Gate read alike as cards; in a Thread `.message` stays a short form), a Usage estimate's line and the measures' words (`shell/work/usage-estimate-line.tsx`, `usage-estimate-words.ts`: the ticked measures, per engine by its name when there are several, the windows left out on an engine id without them, "no estimate" or "no cost", and where it came from; Work and Now show it, Settings › Office limits ticks the measures by the same words), the Project filter (`shell/project-filter/`: the top bar's picker, which stays open while Projects are turned on and off, so not the design system's Menu; the choice kept in this browser's local storage, never in the address, so no Saved view holds it, and rewritten only by the user; `useProjectFilter` for every surface, its rule `isInProjectFilter` from contracts, `narrowed` splitting what it shows from how many it leaves out; the "N more in other Projects" note with "Show all projects"; Needs you narrowed alike on Now, in its panel and in the strip by `useNeedsYou`, the rail badge never), Allow changes in the Caretaker's chat Threads (`shell/conversation/allow-changes.tsx`, shown where `thread.changesAllowed` isn't null: the read-only note with Allow changes, confirmed in a dialog, or the banner with Switch off; each answers with the Thread, set in its query, and its log read again for the "Changes allowed" or "Changes switched off" line), the fire alarm (`shell/fire-alarm/`: the top bar's "Sound the alarm" / "All clear…", the strip's state with its desks at 0, the note under a chat's composer with "Let <name> act in this thread" / "Take it back", "Paused by the alarm" on `TaskStateBadge` (and "Usage window used up · resumes 14:00" for a Task its engine's usage window holds, `shell/usage-window-words.ts`, which words a Thread's `usage-window-used-up` notice too, both in local time through `momentWords`), the review's open state in `FireAlarmReviewProvider`; the alarm is read from Now, its lifts under `["fire-alarm", "lifts"]`, refreshed by `fire-alarm.sounded` and `fire-alarm.all-clear`), the Repository file browser (`shell/repository-files/`: `RepositoryFileWindow`, a Medium `Dialog` around `RepositoryFileBrowser`, for any surface; the caller gives the Project, a title, the extensions and `onPick`, which gets the path and the commit; it fetches the base branch once per sitting, `projectQueries.baseBranchFetch`, kept off the Projects' key so no event moves it to another commit, then reads each folder from that commit), the top bar's Create (`shell/top-bar.tsx`: a `FloatingMenu` with Task and Idea, each dialog starting in the Project of the page or Task shown, else the one the filter shows; Task opens "New Task", `shell/work/new-task-dialog.tsx`, the medium window with a title, a Description, the Project and Tags, `shell/work/tags-input.tsx` with `tag-words.ts`, which then opens the new Task's page; Work's Initiative page gives it the Initiative and the Tasks it can wait for, and stays; Idea opens `shell/work/capture-idea-dialog.tsx`), the top bar's search (`shell/search/`: ⌘K or Ctrl+K, a combobox over `GET /search` with the Project filter, people matched here from those hired by `searchWords`, which mirrors the service's; a document picked opens in `DocumentDialog`, held by the top bar as the search closes), and `api/`: one file per service module with its fetch functions and query keys, plus the event stream (`event-stream.ts`) that turns the service's web events into query refreshes; its `subscribeToThread({ threadId, eventTypes, onEvent, onSubscribed })` receives types for one Thread only, the only way to get a thread-scoped type (`thread.sub-agent-messages`, `thread.process-output`), sent again on every connection, `onSubscribed` once per connection when the service confirms it, a type unsubscribed once no subscription to that Thread has it. Each surface has its own map in `surfaces/<surface>/MAP.md`. The Details switch (`shell/conversation/details-store.ts`, its rule in `message-visibility.ts`, with `onlyDetailsWouldShow` for the line a log shows when the switch alone leaves it empty) is one browser setting for every Thread's log. A direct child of `.message-list` lines up with a turn's words by `--turn-gutter`, unless `conversation.css` names it as The Office's own line.

**A person's picture** (`shell/person-avatar.tsx`): `PersonAvatar` draws anyone from the Roles, by Role key since names can repeat, with their Avatar or, without one or when it can't be loaded (`useShownImage`), their initials and tint. The kit's `Avatar` is imported directly only there and by the user's and The Office's marks (`YourAvatar`, `NamedTag`). `shell/image-row.tsx` is the Avatar's row: preview, Upload or Replace, Remove, and the size check. **A Project's images** (`shell/project-image.ts`): `ProjectMark` and `ProjectLogo` draw the Icon and the Logo in the version for the base of the palette shown (`useAppearance().base`: Graphite, Midnight, Mocha, Aubergine, Lagoon and Emerald show the dark version, Paper, Mist, Sage, Lavender, Cobalt and Citrine the light one), or for a `palette` given, as How it looks does; a version is a contracts `ProjectImagePalette`, light or dark, never one of ui's `Palette`s, and `IMAGE_PALETTES` lists the two; `useShownProjectImage` falls back to the other version when that one is missing or fails to load, then to the Logo's or the mark's own fallback. `.palette-stage[data-palette-stage]` (`shell.css`) draws a place in the light or dark version's page colours from the design system's ramps whatever palette is shown. **The density** (`packages/ui`'s `densities/`, chosen in Account › Appearance): every surface reads the ten density aliases (`--pad-card`, `--gap-card`, `--pad-row`, `--pad-page`, `--gap-panel`, `--radius-card`, `--text-item`, `--text-body`, `--control-h`, `--line`) where it draws that part, or a `calc()` step from one: a card pads `--pad-card` and a list row `--pad-row`, whatever its padding was before; spacing inside a part (chips, menus, code, the chrome of panels) stays fixed. The kit's `Card`, `Button`, `IconButton`, `Input`, `Select`, `SegmentedControl` and `DataTable` come from `packages/ui`'s wrappers (`card.tsx`, `sized-controls.tsx`), which size them by the aliases; import them from `@the-office/ui`, never from `design-system/`. The web tests' `vitest.setup.ts` gives jsdom a light system `matchMedia`, which the appearance reads.

**The shared loader** (`shell/block-loader.tsx`, docs/design/loaders.html): `BlockLoader` stands in for a block whose data hasn't arrived for the first time, shaped like what replaces it; only its `rows` shape is built yet (Add a Project's GitHub list). It is a `status` with a hidden label, fades in after 200ms by CSS alone so a quick answer shows no flash, and its bars, the design system's `Skeleton`, hold still with reduced motion through `!important`, as `Skeleton` sets its shimmer inline.

**The chat drawer** (`shell/chat/`, spec §4, `docs/design/chat-drawer.html`): a side panel in the shell's grid, in column 3 under the strip, so it pushes the page aside, over it at 601–900px, filling the window below (`chat-drawer-width.ts`, with its width in this browser's local storage, resized by `packages/ui`'s `SidePanelEdge`). Where it stands lives in the shell, not the address, in `chat-store.ts` through `ChatProvider` and `useChat`, in this tab's session storage, so links, Back and Forward leave it be and a reload keeps it; `?chat=…&thread=…` stays a way in, taken out of the address as it opens. It lists direct chats only. `chat-button.tsx` at the top bar's end shows `chatButtonLook`, read from `GET /chats/activity` with the hired people with chat on (`use-chat-people.ts`, which leaves the Thread on screen out, so an answer read as it lands never flashes). `useReportingSeen` tells the service the newest message on screen while the tab is visible. Inside it a Mention of a waiting Decision opens its window (`OpenMentionedDecisionContext`) rather than moving the page. Its composer shows the Open page (`chat/open-page.ts`: `openPageOf` reads the router's matches by their route ids, checked against the router's at compile time, and `useOpenPage` follows navigation), which `ThreadComposer` takes as `openPage` with `onLeaveOutOpenPage` and sends; the drawer is the only place that passes one, from `useChatOpenPage` (`use-chat.tsx`), leaving out the page `chat-store.ts` holds as left out (Leave out), kept for the drawer rather than one composer and cleared by `ChatProvider` as soon as the open page changes, so it stays out across messages, Threads, people and closing the drawer, and returning to the page shows its line again. `shell/open-page-chip.tsx` draws its chip, a Mention's for a Task, Initiative or Idea, and the user's message shows it under its text (`message-list.tsx`). Pages lay themselves out by the `page` container on `.shell-main` (`@container page`, each width the window's less the 56px rail), so the open drawer folds them; only what is on the body keeps `@media`, and `shell/use-narrow-page.ts` is the same rule for the conversation's drawer.

**Attachments** (`shell/attachments/`): a chip opens an image in a new tab, a document in `DocumentDialog`, rendered as Markdown, any other text file there as plain text with line numbers (`isPlainTextFile`, `PlainTextFile`), each its first MB at most (`attachmentQueries.text`, `SHOWN_TEXT_LIMIT`) with a line saying the rest is in the download, an HTML file in `HtmlPreviewDialog`, a sandboxed frame, and any other file as a download, so every place chips show gets the preview. Every file Attachment can be saved under its own name through `AttachmentDownloadLink` (`attachment-download-link.tsx`, a same-origin `download` link, so the content's `inline` disposition doesn't matter): a document's window and the HTML preview have it in their bar, the image viewer beside Open the original, and another file's chip is one. A Gate run's Attachments are `attachmentsOfGateRun`: what no earlier Gate run on the Task showed; a skipped or never-started run shows nothing and hides nothing.

**A session's Sub-agents and Processes** (`shell/sub-agents-and-processes/`, spec 2.9, docs/design/sub-agents-and-processes.html): `ThreadComposer` draws `SubAgentsAndProcessesLine` right above the message input (or the read-only note, where `person-tab.tsx`, `timeline-foot.tsx` and `run-details.tsx` draw one themselves; `SubAgentsAndProcessesLineOf` for a Thread known by its id), once the session has had any, its words in `sub-agents-and-processes-words.ts`; pressing it opens `SubAgentsAndProcessesWindow`, a large `Dialog` that keeps one height, unless the place gives its own `onShow` (the Stage history's run switches to its tab). `SubAgentsAndProcessesView` is the list and details, laid out by its own width (`@container`, stacked under 640px with `data-pane` and "‹ All sub-agents and processes"); a Sub-agent's messages are mapped to the Thread's message shape and drawn by `MessageList` with the Details switch, a Process's output follows its end until the reader scrolls up. Nothing in it stops anything. The list is `threadQueries.subAgentsAndProcesses`, under the Thread's key so its events read it again (a fresh session takes the old ones away), kept live by `useSubAgentsAndProcesses`: the five start, change and end events subscribed to for that Thread through `useThreadEvents` (`api/event-stream-provider.tsx`, over `subscribeToThread`, nothing received outside a provider, so a test gives `ThreadEventsContext` its own), each put in by `withSubAgentOrProcess`, and read again on every `onSubscribed`. **Traps:** a Process's output and a Sub-agent's messages are caught up by sequence in `catch-up.ts`, a pure rule, through `useCaughtUpStream`: subscribe first, read only once the subscription is in place (`onSubscribed`, also after every reconnect, from the last sequence held), hold what arrives meanwhile and apply only what comes after the read's `lastSequence`; a part that skips ahead reads again. Reading before the subscription is in place would miss what is sent between the two. Those two thread-scoped streams are subscribed to only by the details of the item shown, which are keyed by its `callId`, so they go as it does and the next starts anew. In code a Process is never a variable named `process`. A Decision's `taskId` is null for a call made from a chat (`decisionSchema.kind` `request` among them): its card in the caller's chat has no Needs you link and no copy link, and links to its Consultation, as a Decision put to a Consultant on a Task does, found among the Task's or the callee's chat Threads by `consultation.decisionId` (`LinkToConsultation`); a request reads "Asked Nina to: …" with no options; a Consultation's own lines are `consultation-line` messages, The Office's.

**The live dot** (`.live-dot`, `shell/shell.css`) marks something running now: a working mark on the boards, a Stage on the Pipeline rail, a conversation tab, a Sub-agent or Process, the workstation. Restyle it only through its variables (`--live-dot-size`, `--live-dot-color`, `--live-dot-gap`). **Trap:** anything that animates forever (a pulse, a spinner) runs on `transform` and `opacity` alone, in a box as big as it grows with `contain: paint`; unbounded, the browser gives what is painted after it layers of their own, a board of dots came to over a hundred, and they lagged behind the page while it scrolled. `.shell-main` stays opaque, so the page scrolls on the compositor rather than repainting every step. Reduced motion stops the animation, and nothing listens to scrolling to hide a lag.

**Signing in** (spec §2.10): every `/api` request and the WebSocket need a signed-in device, whose cookie is `HttpOnly`, so the web learns it is signed out only from a 401. `api/api-client.ts` throws `SignedOut` (an `ApiError` of 401) on one, as `readShownText` does for an Attachment's text; `signed-out.ts`'s `officeQueryClient` sends every query's and change's `SignedOut` to `sendToSignIn`, which replaces the address with `/sign-in?returnTo=<path and query>`, staying put on the sign-in page itself. The root route's component, `shell/root-layout.tsx`'s `RootLayout`, draws the sign-in route bare and every other page in the `Shell`, chosen by the matches shown, never the location, which changes as a navigation starts and would show a shell page outside the shell for a moment; existing routes stay the root's children, as `shell/chat/open-page.ts`'s route ids expect. The shell shows only once `GET /account` (`userQueries.account`) has answered, and only then connects the event stream: `EventStreamProvider` (in `app.tsx`, so its contexts are everywhere) starts nothing itself, `useConnectedEventStream` held by the shell starts and stops it, so no WebSocket opens before signing in; the service's close code 4401 (`SIGNED_OUT_CLOSE_CODE`) stops it for good and calls `onSignedOut`, `sendToSignIn` again. The top bar's user menu (`shell/user-menu.tsx`: "User menu: <name>", Account and Sign out) and the Account page's Sign out share `shell/use-sign-out.ts`; signing out this device lands on `/sign-in`, and signing in clears every cached query and reads the account before returning (`surfaces/sign-in/use-signed-in.ts`). Passkeys (`api/passkeys.ts`, `@simplewebauthn/browser`) sign in on the sign-in page and are added on the account; why they don't work at an address, where they do and where each passkey works are worded once, in `shell/passkey-words.ts`, for both. **Appearance is per user:** `packages/ui`'s appearance store keeps the palette and density in local storage only as this browser's cache of the last signed-in user's, which the inline script paints before the first paint; `shell/account-appearance.tsx`'s `AccountAppearance`, in the shell, adopts the account's (`GET /account`'s `appearance`) before the shell's first paint and saves each choice made here (Account › Appearance or the rail's Theme menu) with `PUT /account/appearance`, setting the account query from the latest answer after cancelling any read begun before it, so a refetch never undoes a fresh choice; the store adopts nothing while a save is pending. Contracts' `PALETTE_IDS` and `DENSITY_IDS` are held equal to `packages/ui`'s `PALETTES` and `DENSITIES` by `api/appearance-ids.test.ts`, since `packages/ui` doesn't depend on the contracts. `App` takes a router (the same route tree on a memory history) and a WebSocket for its test, `app.test.tsx`; `shell/page.fixtures.tsx` opens a page in a small router of its own with the service stubbed, for the surfaces' tests.

**Talks to:** the service only through `api/` and `@the-office/contracts`; components come from `@the-office/ui` (the design system). The layout is enforced by `tools/lint-rules/src/web-layers.ts`. The status strip shows "Update scheduled", with how many things it waits for, from `GET /office-update` while one is scheduled; a Notification pointing at `office-update` opens Settings › Updates.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `app.tsx`: App
- `main.tsx`
- `router.tsx`: OverPageSearch, SignInSearch, IdeasSearch, InitiativeSearch, TaskSearch, HireSearch, OfficeIdentitySearch, router, OfficeRouter
- `signed-out.ts`: officeQueryClient, sendToSignIn
- Tests: app.test.tsx

### api/

- `api-client.ts`: ApiError, SignedOut, RefusedAs, shouldRetry, getFromApi, sendToApi, deleteFromApiReturning, sendFileToApi, sendToApiWithNoAnswer, sendToApiRefusedAs, deleteFromApi
- `conversations.ts`: threadQueries, readSubAgentMessages, readProcessOutput, sizeThresholdQuery, changeSizeThreshold, officeInstructionsQuery, changeOfficeInstructions, decisionQueries, proposalQueries, applyProposal, declineProposal, fireAlarmLiftsQuery, liftTheAlarm, takeTheLiftBack, startChatThread, openPersonsThread, sendMessage, renameThread, chooseContextOverride, allowChanges, markThreadSeen, switchChangesOff, answerDecision, threadEventInvalidations, threadEventCacheUpdates, homeThreadsQuery
- `engine.ts`: engineSettingsQuery, changeEngineSettings, engineRemovalQuery, removeEngine, engineAccountQuery, startEngineSignIn, enterEngineSignInCode, pasteEngineToken, signOutOfEngine, engineEventInvalidations
- `event-stream-provider.tsx`: EventInvalidations, EventCacheUpdates, ThreadEvents, ThreadEventsContext, EventStreamProvider, useThreadEvents, useConnectedEventStream, useEventStreamStatus
- `event-stream.ts`: EventStreamStatus, EventStreamOptions, ThreadSubscription, SIGNED_OUT_CLOSE_CODE, RECONNECT_DELAYS_MS, EventStream
- `github.ts`: gitHubQueries, gitHubAppManifestForm, startGitHubSignIn, signOutOfGitHub, gitHubEventInvalidations
- `mcp-servers.ts`: mcpServerQueries, addMcpServer, readPastedConfig, changeMcpServer, changeMcpServerState, assignMcpServer, removeMcpServer, mcpServerEventInvalidations
- `notifications.ts`: nowQueries, notificationQueries, setTiming, setRoutingChannel, resetRouting, reportActivity, notificationEventCacheUpdates
- `office-identity.ts`: officeIdentityQueries, regenerateSshKey, scanHost, confirmFingerprint
- `office-updates.ts`: officeUpdateQueries, checkForUpdates, scheduleOfficeUpdate, cancelOfficeUpdate, OFFICE_UPDATE_LOG_URL, officeUpdateEventInvalidations
- `passkeys.ts`: PASSKEYS, passkeyQueries, startAddingPasskey, addPasskey, renamePasskey, removePasskey, startPasskeySignIn, signInWithPasskey
- `people.ts`: ENGINE_CASCADE, roleQueries, roleCardQueries, hire, changeRoleCard, filledRoleKeys, letGoOfPerson, hirePersonBack, uploadAvatar, removeAvatar, avatarAddress, addMemoryNote, deleteMemoryNote, clearMemory, roleEventInvalidations
- `pipelines.ts`: pipelineQueries, projectPipelineQueries, stageTemplateQueries, addPipeline, duplicatePipeline, savePipeline, removePipeline, addProjectPipeline, saveProjectPipeline, removeProjectPipeline, addStageTemplate, saveStageTemplate, removeStageTemplate, editTaskStages, continueAtGate, sendBackFromGate, dropAtGate, pipelineEventInvalidations
- `projects.ts`: REMOTE_NEEDS, RUN_ENVIRONMENTS, projectQueries, taskChangesKey, addProject, startRepositoryClone, changeInstallCommand, addCommand, changeCommand, removeCommand, changeInstallInputs, startEnvironmentCheck, changePublishingMode, changeRunEnvironment, setUpRunEnvironment, changeMark, changeProjectLimit, ProjectImageVersion, uploadProjectImage, chooseProjectImage, removeProjectImage, projectImageAddress, changeDefaultPipeline, changeProjectDefault, changeUseForEveryRole, changeRoleOverride, changeUseProjectSkills, changeProjectSkillUse, changeProjectServerValues, projectEventInvalidations, repositoryCloneEventInvalidations
- `run-environments.ts`: runEnvironmentOfficeLimitsQuery, changeRunEnvironmentOfficeLimits, runEnvironmentEventInvalidations
- `skills.ts`: skillQueries, writeSkill, uploadSkill, editSkill, uploadSkillVersion, changeSkillState, changeSkillEveryone, assignSkill, removeSkill, skillEventInvalidations, skillEventCacheUpdates
- `users.ts`: ACCOUNT, USERS, userQueries, userEventInvalidations, addUser, newOneTimePassword, removeUser, setFirstPassword, changeProfile, changePassword, saveAppearance, createFirstUser, signInWithPassword, signOut, signOutDevice, SIGN_IN_PATH, returnPathOf
- `work.ts`: TASKS, FIRE_ALARM, ideaQueries, ArchivedInitiativesAsked, initiativeQueries, officeWideLimitQuery, changeOfficeWideLimit, archivePeriodQuery, changeArchivePeriod, autoModeQuery, usageSettingsQuery, changeUsageSettings, soundTheAlarm, giveTheAllClear, savedViewsQuery, saveView, removeView, searchQuery, taskQueries, onboardingsQuery, attachmentQueries, SHOWN_TEXT_LIMIT, ShownText, captureIdea, shapeIdea, planIdea, shapeIntoInitiative, startShapingThread, planInitiative, startReadyTasks, confirmInitiative, pauseInitiative, resumeInitiative, dropInitiative, archiveInitiative, restoreInitiative, writeInitiativeOutcome, chooseInitiativePipeline, writeShortName, addTaskToInitiative, dropIdea, restoreIdea, createTask, changePriority, changeTags, placeTask, changeDescription, planTask, makeAPlan, PlanSaving, savePlan, confirmPlan, saveDefinitionOfDone, confirmDefinitionOfDone, setPipeline, addDependency, removeDependency, markReady, startTask, takeOutOfQueue, moveUpInQueue, moveToTopOfQueue, pauseTask, stopTask, resumeTask, moveTask, dropTask, archiveTask, restoreTask, addLink, addFile, removeAttachment, attachmentContentUrl, workEventInvalidations
- `workstation.ts`: WORKSTATION_REFRESH_MS, workstationQueries
- Tests: api-client.test.ts, appearance-ids.test.ts, conversations.full.test.ts, event-stream.full.test.ts, skills.full.test.ts, users.full.test.ts

### shell/

- `account-appearance.tsx`: adoptAccountAppearance, AccountAppearance
- `ask-devops.tsx`: AskDevopsButton, useDevops, useAskDevops
- `block-loader.tsx`: BlockLoaderShape, BlockLoader
- `brand-tone.ts`: useBrandTone
- `copy-record-link.ts`: useCopyRecordLink
- `copy-text.ts`: CopyWords, useCopyText
- `desk.tsx`: Desk, PanelHeadingProps, Panel, PanelHeading, Feed
- `engine-model-fields.tsx`: OfferedEngine, EngineModelFields
- `engine-words.ts`: EFFORT_LABELS, modelLabel
- `floating-menu.tsx`: FloatingMenu
- `image-row.tsx`: IMAGE_LIMIT_IN_MB, ImageChanging, ImageRow, ImageRowEmpty
- `item-card.tsx`: CardEdge, ItemCard, EmptyCard
- `mark-colours.ts`: markLabelColour
- `markdown-copy-blocks.tsx`: CopyableCodeBlock, CopyableQuote
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
- `project-logo.tsx`: ProjectLogo
- `project-mark.tsx`: ProjectMark
- `project-words.ts`: publishingLabel, INSTALL_LABEL, COMMAND_KINDS, COMMAND_KIND_LABELS, STARTING_COMMANDS, INSTALL_INPUTS_LABEL, installInputsLine
- `rail-item.tsx`: RailItemFace, RailItemTooltip
- `rail-store.ts`: RAIL_EXPANDED_STORAGE_KEY, RailStore, createRailStore, RailExpansion, useRailExpansion
- `rail.tsx`: Rail
- `record-mention.tsx`: OpenMentionedDecisionContext, RecordMention
- `refusal-alert.tsx`: RefusalAlert
- `role-card-words.ts`: CapabilityInfo, CAPABILITIES, missingCapabilitiesWords, SESSION_DEFAULTS, HARD_SWITCH_LABELS, ENFORCEMENT_LABELS, ASKS_YOU_UNTIL_HIRED, RUN_LABELS, RoleTitles, roleTitlesOf, FieldValueNames, worksWithText, ENGINE_CASCADE_LEVEL_WORDS, engineInCascadeText, taskLimitLabel, taskLimitShort, hardSwitchValueLabel, hardSwitchChoiceOf, hardSwitchValueOf, hardSwitchChoices, editLabel, webLabel, mcpToolKey, mcpToolSettingLines, permissionProfileLines, RoleCardFieldChange, fieldLabel, changeLine, proposedFieldChanges, skillsChangeLine, fieldValueText
- `root-layout.tsx`: RootLayout
- `run-environment-words.ts`: RUN_ENVIRONMENT_QUESTION, RUN_ENVIRONMENT_QUESTION_HINT, RUN_ENVIRONMENT_ANSWER_LABELS, RUN_ENVIRONMENT_ANSWERS, settingChosenWords, setUpWords
- `secret-value-input.tsx`: SecretValueInput
- `secret-value.ts`: SecretOnSave, secretOnSave, SECRET_ON_SAVE_WORDS
- `section-layout.tsx`: MenuSection, SectionLayout
- `shell.tsx`: Shell
- `shown-image.ts`: ShownImage, useShownImage
- `skill-chip.tsx`: SkillChip
- `skill-update-diff.tsx`: SkillUpdateDiff
- `skill-uses.ts`: skillUsesLabel
- `skill-words.ts`: pinnedVersionLabel, samePinnedVersion, sourceLabel
- `ssh-host-name.ts`: sshHostName
- `status-strip.tsx`: StatusStrip
- `theme-menu.tsx`: ThemeMenu
- `time.ts`: dayOf, dayAndClockOf, clockOf, sameDay, dayLineWords, momentWords, durationWords, shortDurationWords
- `toasts.tsx`: Notice, Notices, ToastProvider, useToast, useNotices
- `token-count.tsx`: TokenCount, TokenFigure, TokenMeter
- `token-words.ts`: NO_TOKENS, sumTokens, tokenKindLines
- `top-bar.tsx`: TopBar
- `unified-diff-view.tsx`: UnifiedDiffView
- `unified-diff.ts`: DiffLineKind, DiffLine, diffLines
- `usage-figure.tsx`: UsageFigure
- `usage-window-words.ts`: pausedByUsageWindowWords, usageWindowUsedUpWords
- `use-clock.ts`: useClock
- `use-closed-from-outside.ts`: useClosedFromOutside
- `use-engine-name.ts`: useEngineName
- `use-hired.ts`: useHired
- `use-narrow-page.ts`: useNarrowPage
- `use-placed-list.ts`: usePlacedList
- `use-sign-out.ts`: SignOutOf, useSignOut
- `use-tab-visible.ts`: useTabVisible
- `user-activity.ts`: pageAt, useReportingActivity
- `user-menu.tsx`: UserMenu
- Tests: engine-words.full.test.ts, mark-colours.full.test.ts, markdown-text.full.test.tsx, markdown-text.test.tsx, menu-placement.full.test.ts, office-mark.test.tsx, person-avatar.full.test.tsx, project-mark.full.test.tsx, rail-store.full.test.ts, role-card-words.full.test.ts, secret-value.test.ts, skill-uses.full.test.ts, status-strip.full.test.tsx, time.full.test.ts, token-words.full.test.ts, unified-diff.full.test.ts, usage-window-words.test.ts, user-activity.full.test.ts, user-menu.test.tsx

### shell/attachments/

- `add-attachment-dialog.tsx`: AddAttachmentDialog
- `attachment-chips.tsx`: AttachmentChips, DocumentDialog
- `attachment-download-link.tsx`: AttachmentDownloadLink
- `attachment-gallery.tsx`: AttachmentGallery
- `attachment-picker.tsx`: AttachmentPicker
- `attachment-rounds.ts`: AttachmentRound, attachmentRounds, attachmentsOfGateRun, oneRound, roundName
- `attachment-viewer.tsx`: ViewedImage, AttachmentViewer
- `html-preview-dialog.tsx`: HtmlPreviewDialog
- `pending-attachment.ts`: PendingAttachment, attach, pendingName
- `plain-text-file.tsx`: PlainTextFile
- Tests: attachment-chips.test.tsx, attachment-rounds.full.test.ts

### shell/chat/

- `ask-in-chat.tsx`: AskInChat, useAskInChat, AskInChatButton
- `chat-button.tsx`: CHAT_BUTTON_ELEMENT_ID, ChatButton
- `chat-drawer-width.ts`: CHAT_DRAWER_WIDTH_STORAGE_KEY, CHAT_DRAWER_WIDTHS, ChatDrawerPlace, ChatDrawerLayout, showChatDrawerWidth, rememberChatDrawerWidth, chatDrawerLayout, useChatDrawerLayout
- `chat-drawer.tsx`: ChatDrawer
- `chat-store.ts`: ChatPlace, CHAT_STORAGE_KEY, ChatStore, tabStorage, createChatStore
- `chat-words.ts`: PersonActivity, ChatPerson, ChatStanding, chatStanding, ChatButtonLook, chatButtonLook, chatButtonWords, withoutThreadShown
- `open-page.ts`: MatchedRoute, openPageOf, useOpenPage
- `use-chat-people.ts`: useChatPeople, useThreadShown
- `use-chat.tsx`: ChatControls, ChatProvider, useChat, ChatOpenPage, useChatOpenPage
- Tests: chat-drawer-width.full.test.ts, chat-store.full.test.ts, chat-words.full.test.ts, open-page.full.test.ts

### shell/conversation/

- `allow-changes.tsx`: AllowChangesBar
- `cache-mark.tsx`: useCacheState, CacheMark
- `composer.tsx`: PrefilledNote, Composer
- `context-bar.tsx`: ContextBar
- `context-words.ts`: MOVE_WORDS, ContextChoice, CONTEXT_CHOICES, overrideOf, contextChoiceOf, CacheState, cacheStateAt, startsASessionWords, offersAChoice, contextChoiceWords, tokensShort, contextDetail, contextLabel
- `decision-card.tsx`: DecisionCard, DecisionCardProps, useNamedAttachments, DecisionInThread, bringDecisionCardIntoView, decisionCardElementId, DecisionCardLinkContext, DecisionFrame, DecisionHeading, DecisionDetail, ConsultationNote, Recommendation, FollowUpsHint, AnswerRefused, ReachesAtTurnEndHint, stillAnsweringHint, useAnswering
- `decision-on-task.tsx`: useDecisionThread, DecisionOnTask, MentionedDecisionWindow
- `decision-words.ts`: answerWords, namedAttachments, decisionDetailsWords
- `details-store.ts`: DETAILS_STORAGE_KEY, DetailsStore, createDetailsStore, Details, useDetails
- `details-switch.tsx`: DetailsSwitch
- `devops-proposal-changes.tsx`: ProposedCommandChanges, commandWords, ProposedStageChanges, ProposedStageFieldChanges, ProposedProjectPipelineFields, ProposedSkillInstallFields, ProposedSkillUpdateFields
- `handover-notes.tsx`: HandoverNote, HandoverNotes, HandoverNotesProvider, useHandoverNotes
- `idea-card.tsx`: IdeaCard
- `link-card-words.ts`: personStatus
- `link-card.tsx`: LinkCard
- `message-field.tsx`: MessageField
- `message-groups.ts`: TurnMessage, ToolCall, MessageGroup, LogLine, LogPiece, withLogLines, withDayLines, groupedMessages
- `message-list.tsx`: HandoverNoteReader, MessageList
- `message-visibility.ts`: visibleMessages, onlyDetailsWouldShow, latestToolCall
- `office-status-card.tsx`: OfficeStatusCard
- `office-status-words.ts`: waitingWords, pausedWords
- `proposal-card.tsx`: ProposalCard
- `thread-composer.tsx`: ThreadComposer, ReadOnlyNote
- `thread-drafts.tsx`: ThreadDrafts, ThreadDraftsProvider, useThreadDrafts
- `thread-link.tsx`: ThreadLink
- `thread-title.ts`: threadTitle
- `thread-view.tsx`: ThreadView, ThreadLog, ThreadTitle
- `thread-writing.ts`: takesMessages
- Tests: context-words.full.test.ts, decision-card.full.test.tsx, decision-words.full.test.ts, details-store.full.test.ts, devops-proposal-changes.full.test.tsx, link-card-words.full.test.ts, message-field.full.test.tsx, message-groups.full.test.ts, message-list-kinds.full.test.tsx, message-list.full.test.tsx, message-visibility.full.test.ts, office-status-words.full.test.ts, proposal-card.full.test.tsx, thread-drafts.test.tsx, thread-title.full.test.ts

### shell/fire-alarm/

- `alarm-button.tsx`: AlarmButton
- `alarm-note.tsx`: AlarmNote
- `fire-alarm-review.tsx`: FireAlarmReview, FireAlarmReviewProvider, useFireAlarmReview
- `fire-alarm-words.ts`: AllClearChoice, ALL_CLEAR_CHOICES, ResumePill, ResumeWords, resumeWords, allClearSummary, alarmStateWords, PAUSED_BY_THE_ALARM

### shell/mentions/

- `mention-field.tsx`: MentionField
- `mention-picker.tsx`: Mentions, useMentions
- `mention-words.ts`: MENTION_KINDS, MentionKind, Mentionable, MentionQuery, MENTIONS_SHOWN, mentionQueryAt, mentionables, matchingMentionables, withMentionLinks
- Tests: mention-words.full.test.ts

### shell/notifications/

- `desktop-channel.ts`: DesktopPermission, desktopPermission, askForDesktopPermission, DesktopChannel
- `in-app-channel.tsx`: useInAppChannel
- `needs-you-feed.tsx`: NeedsYouFeed
- `needs-you-panel.tsx`: NeedsYouPanel
- `notification-channel.ts`: NotificationPerson, ShownNotification, NotificationChannel
- `notification-channels.ts`: useNotificationChannels, NotificationChannels
- `notification-words.ts`: OFFICE_TITLE, NotificationTarget, targetOf, serviceDown, titleWithUnread, personOf, aboutLine, unreadCount
- `now-words.ts`: OUTCOME_NAMES, OUTCOME_TONES, OUTCOME_EDGES, needsYouWords, desksWords, sinceWords, inStageWords, resetWords, resetMomentWords, doneSinceYouLeft, UsageWindows, UsageWindow, NamedUsageWindows, namedUsageWindows, fiveHourWindowName, percentWords, UsageFigurePart, usageFigureWords, usageFigureLabel
- `office-notifications-figure.tsx`: OfficeNotificationsFigure
- `unread-badge.ts`: useUnreadBadge
- `use-needs-you-panel.ts`: NeedsYouPanelControls, useNeedsYouPanel
- `use-needs-you.ts`: useNeedsYou
- `use-usage-windows.ts`: useUsageWindows
- Tests: notification-channels.full.test.tsx, notification-words.full.test.ts, now-words.full.test.ts

### shell/pipelines/

- `library-commands.ts`: useLibraryCommands, projectCommandsOf
- `pipeline-choices.ts`: PipelineChoice, PipelineChoiceGroup, ChoosingProject, taskPipelineChoices, defaultPipelineChoices, choiceById, brokenWords
- `pipeline-picker.tsx`: PipelinePicker
- `pipeline-use-words.ts`: pipelineUseLine, projectPipelineUseLine
- `pipeline-words.ts`: PUBLISH_TARGET_NAMES, AFTER_CONFLICT_NAMES, StageFieldChange, stageFieldChanges, stagesLine, whoWorks, stageDetailsLine, thousands, StageChange, stageChanges, stageChangeLine, sameStageChange
- `remove-pipeline-dialog.tsx`: RemovePipelineDialog
- `stage-change-edits.ts`: StageField, STAGE_FIELDS, StageChangeRow, NotApplyingFix, NotApplying, StageChangesShown, BuiltRows, stageChangesShown, stageChangeOf, withStageEdited, stageDrafted, withFieldSetBack, fieldsDiffering, withoutStageChangeOf, withoutStageChange, InsertPlace, insertPlace, newStageAmong, withStageInserted, withStageReplaced, withStageRemoved, withStageChangeAppliedTo, withOwnKey, withInsertPlaced, insertPlaces
- `stage-change-words.ts`: counted, STAGE_FIELD_LABELS, STAGE_CHANGE_KIND_NAMES, OriginWords, originWords, changedFieldsWords, undoWords, stageChangeLine, FieldWordsContext, fieldWords, getsLine, projectPipelineLine, builtOnByWords
- `stage-changes-view.tsx`: StageChangesViewProps, StageChangesView
- `stage-check-alerts.tsx`: StageCheckAlerts
- `stage-commands.ts`: PUBLISH_COMMAND, ANOTHER_KEY, StageCommandSource, StageCommandChoice, commandChoices, commandWords, namedCommands, commandKeysOf
- `stage-editor.tsx`: StageEditorProps, StageEditor
- `stage-edits.ts`: StageKind, AgentStage, ScriptStage, StageCommand, STAGE_KIND_NAMES, STAGE_KIND_ICONS, addStage, addStageFrom, withoutFailureRule, AddedStage, keyAmong, standaloneStage, removeStage, canMove, moveStage, replaceStage, withRole, withCommand, canContinue, failureTargets
- `stage-form.tsx`: StageFormProps, StageForm
- `stage-permission-fields.tsx`: StagePermissionFields
- `stage-permissions.ts`: narrowerRuns, narrowerSettings, withPermissions, withMcpToolSetting, withCommands
- `stages-check.ts`: StagesCheckState, checkAwaited
- `use-pipelines.ts`: useEveryPipeline, useProjectPipelineChoices, asPipeline
- Tests: pipeline-choices.test.ts, pipeline-use-words.full.test.ts, pipeline-words.full.test.ts, stage-change-edits.full.test.ts, stage-change-edits.test.ts, stage-change-words.full.test.ts, stage-changes-view.full.test.tsx, stage-commands.test.ts, stage-edits.full.test.ts, stage-permission-fields.test.tsx, stage-permissions.full.test.ts, stages-check.full.test.ts

### shell/project-filter/

- `in-other-projects-note.tsx`: InOtherProjectsNote
- `project-filter-choices.ts`: knownProjectFilter, showsProject, withProjectToggled, onlyProjectShown, onlyProject, projectFilterLabel, inOtherProjectsWords, Narrowed, narrowed
- `project-filter-menu.tsx`: ProjectFilterMenu
- `project-filter-store.ts`: PROJECT_FILTER_STORAGE_KEY, ProjectFilterStore, createProjectFilterStore
- `use-project-filter.ts`: ProjectFilterControls, useProjectFilter
- Tests: project-filter-choices.full.test.ts, project-filter-store.full.test.ts

### shell/repository-files/

- `repository-file-browser.tsx`: RepositoryFile, RepositoryFileBrowser
- `repository-file-window.tsx`: RepositoryFileWindow
- Tests: repository-file-window.full.test.tsx

### shell/search/

- `search-options.ts`: searchWords, peopleMatching, SearchPick, SearchOption, SearchGroup, searchGroups, matchesInOtherProjects
- `top-bar-search.tsx`: TopBarSearch
- Tests: search-options.full.test.ts

### shell/sub-agents-and-processes/

- `catch-up.ts`: Sequenced, CaughtUp, CatchUpStep, startingToRead, readingAgain, withPart, withRead
- `sub-agents-and-processes-line.tsx`: SubAgentsAndProcessesLine, SubAgentsAndProcessesLineOf
- `sub-agents-and-processes-view.tsx`: SubAgentsAndProcessesView
- `sub-agents-and-processes-window.tsx`: SubAgentsAndProcessesWindow
- `sub-agents-and-processes-words.ts`: LinePiece, LineWords, lineWords, lineText, listGroups, itemTitle, kindWords, STATE_WORDS, stateWords, secondLine, ranFor, ranWords, startedByWords, factWords, EndingTone, endingStrip, earlierOutputWords, earlierMessagesWords, sizeWords, whereWords
- `sub-agents-and-processes.fixtures.ts`: THREAD_ID, STARTED_AT, aSubAgent, aProcess, endedAfter, TestThreadEvents, TestService, outputEvent, messagesEvent, itemEvent
- `use-caught-up.ts`: StreamRead, CaughtUpStream, useCaughtUpStream
- `use-sub-agents-and-processes.ts`: useSubAgentsAndProcesses, listWithEvent
- Tests: catch-up.full.test.ts, sub-agents-and-processes-line.full.test.tsx, sub-agents-and-processes-view.full.test.tsx, sub-agents-and-processes-words.full.test.ts, use-sub-agents-and-processes.full.test.ts

### shell/work/

- `capture-idea-dialog.tsx`: CaptureIdeaDialog
- `drop-task-dialog.tsx`: DropTaskDialog, useDroppingTask, WhatDroppingDoes
- `gate-actions.tsx`: ContinueRefused, SendingBack, useSendingBack, SendBackFields, useContinuingAtGate
- `gate-card-words.ts`: gateQuestion, gateHeading, linesChanged, testsBeforeGate, testsFact, definitionOfDoneFact, gateFactsLine, attachmentsOfThisRound
- `gate-card.tsx`: GateCard
- `gate-window.tsx`: GateWindow
- `gate-words.ts`: WaitingGate, waitingGateOf, defaultSendBackTarget, SEND_BACK_WITH_NOTES, sendBackWords, continueLabel
- `needs-you-list.tsx`: NeedsYouList
- `new-task-dialog.tsx`: NewTaskDialog
- `record-tab.ts`: RecordTab, RECORD_ELEMENT_ID, recordTabOf
- `shape-idea-dialog.tsx`: ShapeIdeaDialog
- `tag-words.ts`: tagOf, withTag, tagsInUse
- `tags-input.tsx`: TagsInput
- `task-state-badge.tsx`: TaskStateBadge, PriorityIcon
- `usage-estimate-line.tsx`: UsageEstimateLine, useUsageEstimate
- `usage-estimate-words.ts`: MEASURES, MEASURE_LABELS, usageEstimateWords
- `use-cto.ts`: CTO_ROLE_KEY, useCto
- `use-idea-planning.ts`: useIdeaPlanning, useOnPlanned
- `use-planner.ts`: PLANNER_ROLE_KEY, usePlanner
- `waiting-on-you.ts`: waitsOnYou, waitsOnYouInItsState, useWaitingOnYou, useWaitingOnYouInItsState
- `work-words.ts`: TASK_STATE_NAMES, STOPPED, PausedHold, taskStateWords, Archived, isArchived, canBeArchived, NOT_STARTED, TASK_STATE_TONES, PRIORITY_NAMES, PRIORITY_ICONS, authorName, reportedMetCount, projectIdsOfIdea
- Tests: gate-card-words.full.test.ts, gate-words.full.test.ts, tag-words.full.test.ts, usage-estimate-words.full.test.ts, waiting-on-you.full.test.ts, work-words.full.test.ts

### shell/workstation/

- `workstation-figure.tsx`: WorkstationFigure
- `workstation-history.ts`: HISTORY_LENGTH, WorkstationRead, withRead, readOf, useWorkstationHistory
- `workstation-panel.tsx`: WorkstationPanel
- `workstation-sparkline.tsx`: WorkstationSparkline
- `workstation-words.ts`: MEASURING, percentWords, cpuUseWords, coresWords, bytesWords, speedWords, loadAverageWords, uptimeWords, LoadLevel, loadLevel, shareOf
- Tests: workstation-figure.full.test.tsx, workstation-history.full.test.ts, workstation-words.full.test.ts
