# Settings surface: map

**Owns:** Settings: Pipelines (the office-wide Pipelines, `packages/ui`'s `PickList` named "Office-wide Pipelines" with a row per Pipeline as a link to its address, a second line "Built on by N Project Pipelines" and a red count of Broken ones from the list's `builtOnBy`, beside the open Pipeline, its head marked Office-wide and under it the Built on by card, `built-on-by-card.tsx`, a row per Project linking to its Pipelines section; under 1224px the lists or the open item, with "‹ All Pipelines" (`showing-detail`); a draft whose check answers `breaks` shows an inline warning above the bar, and Save opens `breaks-dialog.tsx` (small) listing each Project Pipeline under its Project with why and a link to it on its Project's page, with Save anyway, words in `breaks-words.ts`; Project Pipelines themselves are the Projects surface's; New Pipeline in the list's head, Duplicate the open one in its foot, its name, description and Stages in the shared Stage editor with Save and Discard, Remove with the service's reasons, and who uses it; Settings opens here; under it the Stage templates, a second `PickList` with "New template", a menu of the three kinds, each row a link to `/settings/pipelines/stage-templates/$stageTemplateId` with its kind's icon, who works it or its command, and the warning mark from its own `POST /stage-templates/check`; an open template shows in the detail column instead of a Pipeline, `stage-template-form.tsx`: its one Stage in the shell's `StageForm` with no "On failure", its Project command picked from every Project's keys (`useLibraryCommands`), as the library's Stage editor does, problems holding Save and flags only shown, "Ask Devops" in its head with a draft naming the template, a draft with no changes following the saved template (a Proposal applied in a chat shows at once, saved), Save and Discard, Remove confirming that Pipelines and Tasks that added it keep their copy), Skills (the library, with an installed skill's Source and pinned version, Review, and Add a skill: "Install from a source", which asks Devops in their chat with the source drafted or says installing needs someone with the Devops Role, Upload and Write; an update found at an installed skill's Source shows as "→ version" on its row and in the banner, and "Review the update" asks Devops for the update Proposal or shows their open one, with its notes and diff, to apply; a Uses column gives each skill's Skill uses in the last 7 days from `GET /skills`, its number read in full by the shell's `skillUsesLabel` as its tooltip and accessible name), MCP servers (the library from `GET /mcp-servers`, each row with how it runs, its Server values and the required ones not set Office-wide, who has it and On or Off; "Add an MCP server" by the form or by pasting a JSON config, which `POST /mcp-servers/pasted-config` reads into the form for the user to check before adding, nothing kept until then; Edit, whose save turns a server off when what runs changed, opening its review; Review, a test connection showing how it runs, its values and the tools it lists, those named too long flagged, or why it couldn't connect, with Turn it on against its `reviewDigest`, Turn it off and Remove it; a secret's Office-wide value is never sent back, so the form leaves it out, keeping it, unless the user types one or removes it, as an API endpoint's key, in the shell's `secret-value-input.tsx`, which a Project's Server values share; `mcp-servers/`), Engines (the Defaults card above the list of engines beside the selected one, as Pipelines: `defaults-card.tsx`, the Office default, an engine saved and still listed and one of its models, picking an engine filling in its default model, beside the Search endpoint; the list, `engine-list.tsx`, a `PickList` as Pipelines' is, a row per engine, the Claude Code engines first, as Save sends them, with its kind as an icon (`ENGINE_KIND_ICONS`, the kind's label its tooltip and, for screen readers, the start of its line), its name and a line (`engine-list-words.ts`: a Claude Code engine signed in or out from its account, or "Signed in once saved", and its default model; an API endpoint's number of models), the Office default's engine marked, and a warning mark on one whose price holds Save or an API endpoint without a model; "Add an engine" in the list's head, a menu with one entry per kind, `ENGINE_KIND_LABELS`, selects the one added; the note on the kinds sits under the list, and an empty list says how to add one; the selection is page state, a kind and a place in the draft, since a new engine has no id yet, and a removal or a Discard shows its neighbour, `shownSelection`; the detail, `engine-detail.tsx`, the engine's name with Remove and tabs: Settings (a Claude Code engine's name, default model, a Claude model as `GET` prices them, and the -p fallback switch, `claude-code-engine-fields.tsx`; an API endpoint of the OpenAI-compatible API's name, base URL, key and default model, kept while it lists it, else its first, `api-endpoint-fields.tsx`), a Claude Code engine's Account, once saved, `claude-code-engine-account.tsx`: the line from `GET …/:engineId/account` (`engine-account-words.ts`: the email and plan, "A pasted token signs it in" or "Signed out"), Sign in giving its sign-in page as a link and a Code box with Finish, "Paste a token instead" (a password box, "Save the token", the service's words on a refusal, emptied once saved), Sign out on a signed-in engine, read again on each success and on `engine.account-changed`; what is typed there stays out of the draft, so a token never rides along in a Save; and Models and prices, `engine-prices.tsx`: a Claude Code engine's the Claude models' four prices, engine id null, as `GET` lists them, shared by every Claude Code engine and saying so; an API endpoint's models with their context windows, Add a model and Remove, each with its four prices, by the id Save will give it, from contracts' `engineIdFor`, never a saved engine's id, given in Save's order across both kinds (`draftedEngines`), none while a new one has no name; prices held as text, all four or none, `model-price-fields.ts`; an engine not saved yet, of either kind, leaves the draft by its Remove, while a saved one's Remove opens `remove-engine-dialog.tsx`, since a Save leaving a saved engine out is refused: the replacement among the other engines (the Office default's suggested, `engine-removal-words.ts`), what moves from `GET …/:engineId/removal` (each level, from → to, a let-go person marked), its problems holding Remove, or the warning that the only engine moves everything to none; Remove sends `DELETE /settings/engines/:engineId?replacement=`, takes the settings left as a Save does, discarding unsaved changes, and refreshes Roles and Projects; everything is edited as one draft with Save and Discard and sent whole by `PUT /settings/engines`, refused with every reason, and while a price on a tab out of sight holds Save the Save bar names its engine, with Show it; the key never comes back, so the draft leaves it out, keeping it, unless the user types one or removes it with "Remove the key"; a save refreshes the Role card options, `engines/`), Office identity (`office-identity/`, spec §5.5 Defaults; no click-through screen: Sign in with GitHub from `GET /github`: "Register the GitHub App" fetches the manifest form and has the browser itself post it to GitHub, which comes back to `/settings/office-identity`; signed out with the reason The Office gave, Sign in sends the browser to GitHub's authorize page; signed in as the login with Sign out; the App's install page as a link; once the App is registered, Continue with GitHub's setup (`ContinueWithGitHubSetup`): the callback URLs to add to the App on GitHub, this address's and the public address's from `GET /account/identity-callback-urls/github`, each with Copy, where in the App's settings, at most 10, the private App's note (make it public for others) and the warning not to revoke the App's authorization from the git identity's account; `registrationFailed` and `signInFailed` in the address shown until each is dismissed, refreshed by `github.changed`; the Office ssh key's public half, masked until Show, with Copy (the whole key either way) and Regenerate… (`RegenerateSshKeyDialog`, enabled once its consequences are acknowledged); the Unconfirmed hosts, each scanned for its keys with Confirm fingerprint, and the Trusted hosts with their fingerprints, GitHub's marked From GitHub, read again on focus since no event says a host became unconfirmed) and Office limits (the desks, from Work; Usage, from Work's `GET`/`PUT /settings/usage`: the measures a Usage estimate is given in as checkboxes, each engine's caps under its name, in the engines list's order: Window caps on a Claude Code engine only, with its own 5-hour window's use and reset from Now, and Daily caps, as text, empty being off, `usage-settings-draft.ts`, one draft with Save and Discard, refreshed by `usage-settings.changed`; the Context policy's size threshold, from Conversations; the Archive card's Archive period in days, from Work's `GET`/`PUT /settings/archive-period`; and the Run environments card, `run-environments-card.tsx`, the run environments' Office limits from Run environments' `GET`/`PUT /settings/run-environments`, each change sending the whole set: Run environments at once, the CPU limit (Automatic or Fixed, the fixed number on a `Stepper` up to this computer's cores, what Automatic gives here in its note), Memory per service in GB and Processes per service, each `Stepper` within contracts' bounds; a warning when Run environments at once is below Running Tasks at once (Work's `officeWideLimitQuery`), and that a change applies from each run environment's next start, refreshed by `run-environment-settings.changed`), Duties (`duties/`, from People's `GET /settings/duties` and `PUT /settings/duties/:duty`; no click-through screen, built like Office limits: a row per duty with its label, its line from `shell/duty-words.ts` and a `Select` of Nobody and `holderOptions`, the hired Roles without the Caretaker or anyone let go; a pick saves at once with a toast, no Save or Discard, a refusal shown under its row; under a duty held by nobody its fallback, a holder let go named, and a Consultant-off holder of a Consultant duty said to be passed over), Office instructions (`office-instructions/`, from Conversations' `GET`/`PUT /settings/office-instructions`; no click-through screen: who gets them and when, one text box, Save and Discard; only what the user typed is held, so an untouched text follows `office-instructions.changed` and typing survives it; compared and counted trimmed, as the service does, with no `maxLength`, a text over the limit holding Save), Notifications ("What goes where": the kinds tree × In-app, Desktop and Phone from `GET /notifications/routing`, each cell set on its row or inherited from its group, a click setting it and Reset giving a kind back; the rows and their words in `routing-words.ts`; "At the desk" and "Quiet hours and batching" from `GET /notifications/timing`, each change sent whole by `PUT`, one at a time, `timing-cards.tsx`) and Users (`users/`, spec §2.10: the users from `GET /users` in a `DataTable`, your own row marked "You" and its Remove off with why, a user who hasn't set their own password marked "Waiting for first sign-in", or "One-time password expired" past its 7 days (`users-words.ts`); "Add a user" opens `add-user-dialog.tsx`, name and email, then in the same window the one-time password the answer holds, with Copy and "Shown only once" (`one-time-password-shown.tsx`), never read again; "New one-time password" on a waiting user's row confirms that the old one stops working, then shows the new one the same way; Remove confirms that it signs out all their devices and their name stays on what they did; refreshed by `user.created`, `user.changed` and `user.removed`), Signing in (`signing-in/`, spec §2.10: the Google card, `google-client-card.tsx`, from `GET /settings/google-client` (`api/google-client.ts`): the client ID and a write-only client secret, "Secret set" once one is saved, an empty secret on Save keeping it, Remove after a confirm that linked Google accounts stay linked; under it the redirect URIs to register from `GET /account/identity-callback-urls/google`, localhost's (none when the page is open at an IP address) and the public address's, each with Copy, and the steps in Google Cloud Console and on the OAuth consent screen). Appearance moved to the account (`/settings/appearance` redirects to `/account/appearance`). It reads the service through `src/api/` (see [the web app's map](../../MAP.md)). Updates (`updates/`): the version The Office runs, Check for updates, "Update available" with the commits behind and Update, a scheduled update with what it waits for and Cancel, a refusal's reason and the last result with its log, refreshed by `office-update.changed`.

**Traps:** each read of an MCP server's review starts the server or calls it, so its query (`mcpServerQueries.review`) sits outside the library's key, is read once per open review and is dropped when the review closes; only `mcp-server.changed` refreshes an open one. The grid's rows are levels of the service's kinds tree, keyed as the service keys them: a kind added there needs its row here. The library's check (`POST /pipelines/check`) gives problems, which hold Save, and flags (a Role nobody fills), which don't; each list item runs its own check for its warning mark. A Stage template is copied, never linked: a Stage added from it is the editor's own (`addStageFrom`), so saving or removing a template changes no Pipeline or Task, and nothing here should read a Stage back to its template. `skill.used` refetches the library list alone, as an exact key (`skillEventCacheUpdates`), since `["skills"]` as a prefix would read each open review and update diff again on every use.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `settings-card-parts.tsx`: SettingsCardTitle, SettingsProblem
- `settings-page.tsx`: SettingsPage

### duties/

- `duties-section.tsx`: DutiesSection
- Tests: duties-section.full.test.tsx

### engines/

- `api-endpoint-fields.tsx`: ApiEndpointFields
- `claude-code-engine-account.tsx`: ClaudeCodeEngineAccount
- `claude-code-engine-fields.tsx`: ClaudeCodeEngineFields
- `defaults-card.tsx`: DefaultsCard
- `engine-account-words.ts`: engineAccountLine
- `engine-detail.tsx`: EngineDetail
- `engine-list-words.ts`: EngineSelection, EngineTab, ENGINE_KIND_LABELS, engineSelectionsOf, engineAt, shownSelection, sameSelection, engineTabsOf, ENGINE_TAB_LABELS, engineCalled, claudeCodeEngineSummary, apiEndpointSummary, pricedModelsAt, pricesHoldSave, engineProblem, saveHeldBy
- `engine-list.tsx`: EngineRow, EngineList
- `engine-prices.tsx`: PriceFields, ClaudeModelPrices, ApiEndpointModels
- `engine-removal-words.ts`: movedReferencePlace, movedReferenceChange, suggestedReplacement
- `engine-settings-draft.ts`: EngineSettingsDraft, PricedModel, Drafted, DraftedEndpoint, DraftedEngines, draftOf, savedApiEngines, offeredModelKey, draftedEngines, claudeModelsOf, offeredModelsOf, modelsOf, priceTextIn, engineSettingsEditOf, offeredDefaultModel, newClaudeCodeEngine, OfficeDefaultChoice, officeDefaultChoicesOf, draftChanged, NEW_API_ENDPOINT, KeyOnSave, keyOnSave, KEY_ON_SAVE_WORDS, searchEndpointOf
- `engines-section.tsx`: EnginesSection
- `model-price-fields.ts`: PRICE_KINDS, PriceKind, PRICE_KIND_LABELS, ModelPriceText, NO_PRICE_TEXT, priceTextOf, priceFieldProblem, priceOf
- `remove-engine-dialog.tsx`: RemoveEngineDialog
- Tests: engine-account-words.full.test.ts, engine-list-words.full.test.ts, engine-removal-words.full.test.ts, engine-settings-draft.full.test.ts, model-price-fields.full.test.ts

### mcp-servers/

- `add-mcp-server-dialog.tsx`: AddMcpServerDialog
- `edit-mcp-server-dialog.tsx`: EditMcpServerDialog
- `mcp-server-draft.ts`: McpServerDraft, NEW_MCP_SERVER, NEW_SERVER_VALUE, draftOfServer, draftOfPasted, newMcpServerOf, mcpServerEditOf, withSecret, withSecretValue, secretValueSet, connectionLine, serverValuesLine
- `mcp-server-fields.tsx`: McpServerFields
- `mcp-servers-section.tsx`: McpServerDialog, McpServersSection
- `review-mcp-server-dialog.tsx`: ReviewMcpServerDialog
- Tests: mcp-server-draft.full.test.ts

### notifications/

- `notifications-section.tsx`: NotificationsSection
- `routing-card.tsx`: RoutingCard
- `routing-words.ts`: RoutingRow, RoutingGroup, ROUTING_GROUPS, RoutingColumn, ROUTING_COLUMNS, columnNote, isSetHere, cellTitle
- `timing-cards.tsx`: TimingCards
- Tests: routing-words.full.test.ts

### office-identity/

- `github-card.tsx`: GitHubCard
- `hosts-cards.tsx`: HostsCards
- `office-identity-section.tsx`: OfficeIdentitySection
- `regenerate-ssh-key-dialog.tsx`: RegenerateSshKeyDialog
- `ssh-key-words.ts`: maskedPublicKey
- Tests: github-card.test.tsx, ssh-key-words.full.test.ts

### office-instructions/

- `office-instructions-section.tsx`: OfficeInstructionsSection
- Tests: office-instructions-section.full.test.tsx

### office-limits/

- `office-limits-section.tsx`: OfficeLimitsSection
- `run-environments-card.tsx`: RunEnvironmentsCard
- `usage-card.tsx`: UsageCard
- `usage-settings-draft.ts`: CapKind, CapsText, UsageSettingsDraft, draftOf, withMeasure, capTextOf, withCapText, capFieldProblem, usageSettingsOf, draftChanged
- Tests: usage-settings-draft.full.test.ts

### pipelines/

- `breaks-dialog.tsx`: BreaksDialog
- `breaks-words.ts`: BreaksOfProject, breaksByProject, breaksTitle, breaksSentence
- `built-on-by-card.tsx`: BuiltOnByCard, builtOnByTotal, brokenBuiltOnByTotal
- `library-pipeline-form.tsx`: LibraryPipelineForm
- `pipelines-section.tsx`: PipelinesSection
- `stage-template-form.tsx`: StageTemplateOpened, StageTemplateForm
- Tests: library-pipeline-form.full.test.tsx

### signing-in/

- `google-client-card.tsx`: GoogleClientCard
- `signing-in-section.tsx`: SigningInSection
- Tests: google-client-card.test.tsx

### skills/

- `add-skill-dialog.tsx`: AddSkillDialog
- `edit-skill-dialog.tsx`: EditSkillDialog
- `review-skill-dialog.tsx`: ReviewSkillDialog
- `skill-fields.tsx`: SkillFields, SkillFileInput, useSkillSaved
- `skill-labels.ts`: skillSourceLabel, skillVersionLabel, STATE_BADGES, holdersLabel, updateLabel, offersUpdate, waitingLine, inReviewOrder
- `skills-section.tsx`: SkillDialog, SkillsSection
- `update-skill-dialog.tsx`: UpdateSkillDialog
- `upload-version-dialog.tsx`: UploadVersionDialog
- `who-has-it-dialog.tsx`: WhoHasItDialog
- Tests: skills-section.full.test.tsx

### updates/

- `updates-section.tsx`: UpdatesSection
- `updates-words.ts`: lastResultWords, waitingWords
- Tests: updates-words.full.test.ts

### users/

- `add-user-dialog.tsx`: AddUserDialog
- `new-one-time-password-dialog.tsx`: NewOneTimePasswordDialog
- `one-time-password-shown.tsx`: OneTimePasswordShown
- `remove-user-dialog.tsx`: RemoveUserDialog
- `users-section.tsx`: UsersSection
- `users-words.ts`: UserStanding, standingOf
- Tests: users-section.test.tsx
