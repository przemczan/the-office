# People surface: map

**Owns:** the People grid (the built-in Caretaker pinned first with a "Built in" mark, `people-order.ts`) and a person's page: Overview, Work, Conversations, Role card (with "proposed by" in its changes), with its Avatar block (`avatar-block.tsx`, the shell's `ImageRow`, without its buttons for someone let go), and hiring: from a preset (`hire-dialog.tsx`), from scratch, or from a Proposal's card edited first (`/hire?proposal=…`, "Edit the proposed Role", saved by applying the Proposal: an old `hire` Proposal, or a generic `hire_role` or `change_role_card` one whose `editableCard` fills the form, the latter on the changed Role's own card and preset defaults). It reads the service through `src/api/` (see [the web app's map](../../MAP.md)); the Role card's words live in the shell (`shell/role-card-words.ts`), since a chat's Proposal card shows them too. Its Conversations tab and Work tab read the service a page at a time with "Show more" (`ShowMore`, `api/pages.ts`), their headings and filter counts the service's totals: the chat's Threads and the Threads on Tasks as summaries (`threadQueries.inChat`, `onTasksWith`, each row on a Task named with its Task and Project by the service), and the person's Tasks with their part, filtered and counted by the service (`taskQueries.ofPerson`, `GET /roles/:roleKey/tasks`, under the Tasks' key and read again as Threads start or rename); `person-tasks.ts` keeps only the Work filters' words. The Memory tab names a note written on a Task by the `taskTitle` the service gives with it ("Written by <name> on <Task title>", or "a Task" once the Task is gone), loading no Task itself.

Duties (`shell/duty-words.ts`, from `dutyQueries.list()`): the Role card view's Identity group shows the duties the person holds, or None with a link to Settings › Duties (none for someone let go; the Caretaker holds none and is the one to talk to while Default person to talk to is unheld); they are set in Settings, not on the card or in its form. People reads the list once and gives each tile a `PlainMark` "N duties" naming each on hover and focus.

While nobody is hired (`isNobodyHired`, `people-order.ts`: no Role but the Caretaker filled by someone not let go), the Hire tile gives way to the set-up hint (`office-setup-hint.tsx`), a whole row under the Caretaker's card: each preset with the duties it suits (`GET /presets`' `duties`, by their labels from the duties list), its capabilities and its Task limit, how an unheld duty falls back, and Hire a Role, Start from scratch and "Set up The Office with <Caretaker>" (`useAskInChat`: a new Caretaker Thread with a draft in its composer, nothing sent). The Hire dialog's presets say "Suits: …" (`suitsWords`, `shell/duty-words.ts`) before the Task limit. The Caretaker's `office-setup` Proposal is a chat card (`shell/conversation/office-setup-changes.tsx`): each hire, linked once applied, and every duty's holder after it.

The Role card's Engine group (spec §5.4.5 "The model and effort cascade") holds the person's model and effort for each engine type (`engineSettings`, a type left out being the engine's default). The form's `EngineFields` (`role-card-form.tsx`) and the view's "Works with" table both lay out `engineTypeRows` (`engine-type-rows.ts`): each type `/role-card-options`' `engineTypes` lists, in Settings › Engines' order, then each type the person sets with none listed ("No <type> engine is listed", Clear in the form); a type set back to "Engine's default" for both is dropped from the card, and a type taking no effort has no Effort. The Overview and a Proposal's card say it through the shell's `worksWithLines`. The view's "Runs on" (`EngineThatApplies`, for a Role someone fills) says the model and effort on the engine the cascade gives outside any Project, with what that engine can't do, and lists the Projects where another engine, model or effort applies, naming a Project's setting or force (`roleQueries.engineCascade`, under its own `ENGINE_CASCADE` key, invalidated by `role.card-changed`, the Projects' engine events and a Settings › Engines save).

The Role card's MCP servers (`role-card-mcp-server-fields.tsx`, `role-mcp-servers.ts`): the form ticks the library's servers and sets each tool of a ticked server that is on, its names too long for sessions left out (the library's `toolsTooLong`); the view shows the Role's `mcpServers`, on with each tool's setting, or off.

The Role card's Authority (spec §6 › Authority, `role-card-authority.tsx`) replaces the four Hard switches: `/role-card-options`' `authority` gives the areas and rows in the card's order (each row's values, its cap, whether it is a record's own-and-others row, followed, and what enforces it), and the card keeps only its set rows (`card.authority`), a row left out standing at `role.presetAuthority` (a new Role's `options.fromScratchAuthority`). The view (`AuthorityView`) shows each area's value (the one most of its groups share, a tie to its first, `areaSetting` in `shell/role-card-words.ts`), inside it the rows that differ or are capped, then the followed rows and the approvals row; a value at the default reads muted "Preset default (…)". The form (`AuthorityFields`) has a select per row (Own and Others' for a record's row), Reset beside a set row; picking the default, or Reset, removes the row from `card.authority`, and a pair picked equal is kept as one value. A Proposal's card always comes with its Authority: the service makes it from the Hard switches of one drafted before Authority. The card still carries `hardSwitches` as it has them; the service ignores them once `authority` is sent.

People's Authority tab (`/authority`, `authority-tab.tsx`, outside `people/` as `/hire` is, with `people-tabs.tsx` giving People and Authority their tab strip) lays `/role-card-options`' Authority rows down the side and every person not let go across, the Caretaker first (`authority-table.ts`: columns, the value in effect per cell, how many people have each value, the "only rows where people differ" filter, which cards changed). Edit Authority turns every cell but the Caretaker's into the Role card form's selects (`AuthorityRowSelects`, and the rule that a row at the preset's default leaves the card, `withAuthorityRow`, both in `authority-row-parts.tsx` with the notes the view and the form share) and saves each changed person's card with `PUT /roles/:key/card`, one request each: a refusal names the people not saved and keeps their edits, and leaving with unsaved edits asks first (`useBlocker`).

The Caretaker (`role.builtIn`) has no Let go action, and its card's capabilities, permission profile's edit, run and web, Authority and Task limit show disabled in the form and noted in the view (`FixedForTheCaretaker`), as the service refuses a change to them (its Authority reads plainly, as no preset gives it); its MCP servers and their tool settings stay editable.

**Traps:** the MCP servers module keeps a Role's servers, so Save sends the card (only when it changed, as an unchanged one would add an empty version) and then `PUT /mcp-servers/:name/roles` for each server whose tick changed, with the library's Roles plus or minus this one; hiring assigns after, with the new key. The card keeps only the tool settings the user set: choosing the options' `mcpToolDefault` removes the key, and unticking a server drops its tools' keys. An MCP tool may consult the card's own Role only when the default names it (Devops' card).

<!-- Generated by `npm run maps` from the code; edit only above this line. -->

## Files

### ./

- `authority-row-parts.tsx`: withAuthorityRow, asksYouUntilHired, SettingText, CappedNote, FollowedMark, AuthorityRowSelects
- `authority-tab.tsx`: AuthorityTab
- `authority-table.ts`: AuthorityEdits, authorityColumns, authorityOf, settingInEffect, atPresetDefault, isChanged, ValueCount, valueCounts, valueCountWords, areasWhereTheyDiffer, changedCards
- `avatar-block.tsx`: AvatarBlock
- `blank-role-card.ts`: blankRoleCard
- `conversations-tab.tsx`: ConversationsTab
- `engine-type-rows.ts`: EngineTypeRow, engineTypeRows, noEngineListedWords
- `hire-dialog.tsx`: HireDialog
- `let-go-dialog.tsx`: LetGoDialog
- `memory-groups.ts`: MemoryGroup, ALL_PROJECTS, memoryGroups
- `memory-tab.tsx`: MemoryTab
- `office-setup-hint.tsx`: OfficeSetupHint
- `overview-tab.tsx`: OverviewTab
- `people-order.ts`: inGridOrder, isNobodyHired
- `people-page.tsx`: PeoplePage
- `people-tabs.tsx`: PeopleTabs
- `person-page.tsx`: PersonPage
- `person-tasks.ts`: WORK_FILTERS
- `role-card-authority.tsx`: AuthorityView, AuthorityFields
- `role-card-form.tsx`: RoleCardEditPage, HireFromScratchPage, EngineFields
- `role-card-layout.tsx`: ROLE_CARD_GROUPS, RoleCardGroup, RoleCardValue, FixedForTheCaretaker, PersonBlock
- `role-card-mcp-server-fields.tsx`: McpServerFields
- `role-card-tab.tsx`: RoleCardTab
- `role-card-view.tsx`: RoleCardView
- `role-mcp-servers.ts`: assignedMcpServersOf, mcpServerAssignments, sessionToolsOf, mcpToolSettingOf, withMcpToolSetting, withoutServerToolSettings
- `session-skills.ts`: sessionSkillsOf
- `work-tab.tsx`: WorkTab
- Tests: authority-tab.full.test.tsx, authority-table.full.test.ts, conversations-tab.full.test.tsx, memory-groups.full.test.ts, memory-tab.full.test.tsx, people-order.full.test.ts, role-card-authority.full.test.tsx, role-card-engine.full.test.tsx, role-mcp-servers.full.test.ts
