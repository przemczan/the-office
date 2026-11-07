# Settings surface: map

**Owns:** Settings: Pipelines (the library, `packages/ui`'s `PickList` with a row per Pipeline as a link to its address, beside the open Pipeline: New Pipeline in the list's head, Duplicate the open one in its foot, its name, description and Stages in the shared Stage editor with Save and Discard, Remove with the service's reasons, and who uses it; Settings opens here), Skills (the library, with an installed skill's Source and pinned version, Review, and Add a skill: "Install from a source", which asks Devops in their chat with the source drafted or says installing needs someone with the Devops Role, Upload and Write; an update found at an installed skill's Source shows as "→ version" on its row and in the banner, and "Review the update" asks Devops for the update Proposal or shows their open one, with its notes and diff, to apply), MCP servers (the library from `GET /mcp-servers`, each row with how it runs, its Server values and the required ones not set Office-wide, who has it and On or Off; "Add an MCP server" by the form or by pasting a JSON config, which `POST /mcp-servers/pasted-config` reads into the form for the user to check before adding, nothing kept until then; Edit, whose save turns a server off when what runs changed, opening its review; Review, a test connection showing how it runs, its values and the tools it lists, those named too long flagged, or why it couldn't connect, with Turn it on against its `reviewDigest`, Turn it off and Remove it; a secret's Office-wide value is never sent back, so the form leaves it out, keeping it, unless the user types one or removes it, as an API endpoint's key, in the shell's `secret-value-input.tsx`, which a Project's Server values share; `mcp-servers/`), Engines (the Defaults card above the list of engines beside the selected one, as Pipelines: `defaults-card.tsx`, the Office default, an engine saved and still listed and one of its models, picking an engine filling in its default model, beside the Search endpoint; the list, `engine-list.tsx`, a `PickList` as Pipelines' is, a row per engine, the Claude Code engines first, as Save sends them, with its kind as an icon (`ENGINE_KIND_ICONS`, the kind's label its tooltip and, for screen readers, the start of its line), its name and a line (`engine-list-words.ts`: a Claude Code engine signed in or out from its account, or "Signed in once saved", and its default model; an API endpoint's number of models), the Office default's engine marked, and a warning mark on one whose price holds Save or an API endpoint without a model; "Add an engine" in the list's head, a menu with one entry per kind, `ENGINE_KIND_LABELS`, selects the one added; the note on the kinds sits under the list, and an empty list says how to add one; the selection is page state, a kind and a place in the draft, since a new engine has no id yet, and a removal or a Discard shows its neighbour, `shownSelection`; the detail, `engine-detail.tsx`, the engine's name with Remove and tabs: Settings (a Claude Code engine's name, default model, a Claude model as `GET` prices them, and the -p fallback switch, `claude-code-engine-fields.tsx`; an API endpoint of the OpenAI-compatible API's name, base URL, key and default model, kept while it lists it, else its first, `api-endpoint-fields.tsx`), a Claude Code engine's Account, once saved, `claude-code-engine-account.tsx`: the line from `GET …/:engineId/account` (`engine-account-words.ts`: the email and plan, "A pasted token signs it in" or "Signed out"), Sign in giving its sign-in page as a link and a Code box with Finish, "Paste a token instead" (a password box, "Save the token", the service's words on a refusal, emptied once saved), Sign out on a signed-in engine, read again on each success and on `engine.account-changed`; what is typed there stays out of the draft, so a token never rides along in a Save; and Models and prices, `engine-prices.tsx`: a Claude Code engine's the Claude models' four prices, engine id null, as `GET` lists them, shared by every Claude Code engine and saying so; an API endpoint's models with their context windows, Add a model and Remove, each with its four prices, by the id Save will give it, from contracts' `engineIdFor`, never a saved engine's id, given in Save's order across both kinds (`draftedEngines`), none while a new one has no name; prices held as text, all four or none, `model-price-fields.ts`; an engine not saved yet, of either kind, leaves the draft by its Remove, while a saved one's Remove opens `remove-engine-dialog.tsx`, since a Save leaving a saved engine out is refused: the replacement among the other engines (the Office default's suggested, `engine-removal-words.ts`), what moves from `GET …/:engineId/removal` (each level, from → to, a let-go person marked), its problems holding Remove, or the warning that the only engine moves everything to none; Remove sends `DELETE /settings/engines/:engineId?replacement=`, takes the settings left as a Save does, discarding unsaved changes, and refreshes Roles and Projects; everything is edited as one draft with Save and Discard and sent whole by `PUT /settings/engines`, refused with every reason, and while a price on a tab out of sight holds Save the Save bar names its engine, with Show it; the key never comes back, so the draft leaves it out, keeping it, unless the user types one or removes it with "Remove the key"; a save refreshes the Role card options, `engines/`), Office identity (`office-identity/`, spec §5.5 Defaults; no click-through screen: Sign in with GitHub from `GET /github`: "Register the GitHub App" fetches the manifest form and has the browser itself post it to GitHub, which comes back to `/settings/office-identity`; signed out with the reason The Office gave, Sign in sends the browser to GitHub's authorize page; signed in as the login with Sign out; the App's install page as a link; `registrationFailed` and `signInFailed` in the address shown until each is dismissed, refreshed by `github.changed`; the Office ssh key's public half, masked until Show, with Copy (the whole key either way) and Regenerate… (`RegenerateSshKeyDialog`, enabled once its consequences are acknowledged); the Unconfirmed hosts, each scanned for its keys with Confirm fingerprint, and the Trusted hosts with their fingerprints, GitHub's marked From GitHub, read again on focus since no event says a host became unconfirmed) and Office limits (the desks, from Work; Usage, from Work's `GET`/`PUT /settings/usage`: the measures a Usage estimate is given in as checkboxes, each engine's caps under its name, in the engines list's order: Window caps on a Claude Code engine only, with its own 5-hour window's use and reset from Now, and Daily caps, as text, empty being off, `usage-settings-draft.ts`, one draft with Save and Discard, refreshed by `usage-settings.changed`; and the Context policy's size threshold, from Conversations), Office instructions (`office-instructions/`, from Conversations' `GET`/`PUT /settings/office-instructions`; no click-through screen: who gets them and when, one text box, Save and Discard; only what the user typed is held, so an untouched text follows `office-instructions.changed` and typing survives it; compared and counted trimmed, as the service does, with no `maxLength`, a text over the limit holding Save), Notifications ("What goes where": the kinds tree × In-app, Desktop and Phone from `GET /notifications/routing`, each cell set on its row or inherited from its group, a click setting it and Reset giving a kind back; the rows and their words in `routing-words.ts`; "At the desk" and "Quiet hours and batching" from `GET /notifications/timing`, each change sent whole by `PUT`, one at a time, `timing-cards.tsx`) and Appearance (the palette, or following the system, kept in this browser by `useAppearance` from `packages/ui`). It reads the service through `src/api/` (see [the web app's map](../../MAP.md)). Updates (`updates/`): the version The Office runs, Check for updates, "Update available" with the commits behind and Update, a scheduled update with what it waits for and Cancel, a refusal's reason and the last result with its log, refreshed by `office-update.changed`.

**Traps:** each read of an MCP server's review starts the server or calls it, so its query (`mcpServerQueries.review`) sits outside the library's key, is read once per open review and is dropped when the review closes; only `mcp-server.changed` refreshes an open one. The grid's rows are levels of the service's kinds tree, keyed as the service keys them: a kind added there needs its row here. The library's check (`POST /pipelines/check`) gives problems, which hold Save, and flags (a Role nobody fills), which don't; each list item runs its own check for its warning mark.

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `settings-card-parts.tsx`: SettingsCardTitle, SettingsProblem
- `settings-page.tsx`: SettingsPage

### appearance/

- `appearance-section.tsx`: AppearanceSection

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
- Tests: engine-account-words.test.ts, engine-list-words.test.ts, engine-removal-words.test.ts, engine-settings-draft.test.ts, model-price-fields.test.ts

### mcp-servers/

- `add-mcp-server-dialog.tsx`: AddMcpServerDialog
- `edit-mcp-server-dialog.tsx`: EditMcpServerDialog
- `mcp-server-draft.ts`: McpServerDraft, NEW_MCP_SERVER, NEW_SERVER_VALUE, draftOfServer, draftOfPasted, newMcpServerOf, mcpServerEditOf, withSecret, withSecretValue, secretValueSet, connectionLine, serverValuesLine
- `mcp-server-fields.tsx`: McpServerFields
- `mcp-servers-section.tsx`: McpServerDialog, McpServersSection
- `review-mcp-server-dialog.tsx`: ReviewMcpServerDialog
- Tests: mcp-server-draft.test.ts

### notifications/

- `notifications-section.tsx`: NotificationsSection
- `routing-card.tsx`: RoutingCard
- `routing-words.ts`: RoutingRow, RoutingGroup, ROUTING_GROUPS, RoutingColumn, ROUTING_COLUMNS, columnNote, isSetHere, cellTitle
- `timing-cards.tsx`: TimingCards
- Tests: routing-words.test.ts

### office-identity/

- `github-card.tsx`: GitHubCard
- `hosts-cards.tsx`: HostsCards
- `office-identity-section.tsx`: OfficeIdentitySection
- `regenerate-ssh-key-dialog.tsx`: RegenerateSshKeyDialog
- `ssh-key-words.ts`: maskedPublicKey
- Tests: ssh-key-words.test.ts

### office-instructions/

- `office-instructions-section.tsx`: OfficeInstructionsSection
- Tests: office-instructions-section.test.tsx

### office-limits/

- `office-limits-section.tsx`: OfficeLimitsSection
- `stepper.tsx`: StepperProps, Stepper
- `usage-card.tsx`: UsageCard
- `usage-settings-draft.ts`: CapKind, CapsText, UsageSettingsDraft, draftOf, withMeasure, capTextOf, withCapText, capFieldProblem, usageSettingsOf, draftChanged
- Tests: usage-settings-draft.test.ts

### pipelines/

- `library-pipeline-form.tsx`: LibraryPipelineForm
- `pipeline-use-words.ts`: pipelineUseLine
- `pipelines-section.tsx`: PipelinesSection
- Tests: pipeline-use-words.test.ts

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

### updates/

- `updates-section.tsx`: UpdatesSection
- `updates-words.ts`: lastResultWords, waitingWords
- Tests: updates-words.test.ts
