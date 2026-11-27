# Who can do what, and when

Design notes of 2026-11-25 for the Task "Design: who can do what, and when", step 3 of the roadmap in the Initiative's analysis, its attachment "agent-parity.md" (the Initiative "Agents-follow principle"). Once approved, the spec is the source of truth: these notes record the options weighed and why each one was chosen, and they are not kept up to date afterwards.

The spec pages that carry each decision are named under it. The CTO settled the two architecture calls, [No bypass](#6-no-bypass) and [Tool loading](#7-tool-loading-by-area), in a Consultation on this Task.

## What is fixed before this design

The Initiative's outcome fixes these, so they are not weighed again here:

- **Every user action has an Office tool:** it runs the same handler as the user's click, or it is on one written list of the user's alone, with its reason.
- **One setting per tool:** whether a person may use a tool right now is one setting per tool on the Role card: Allowed, Consult someone, Ask me, Proposal or Never.
- **The trust anchor:** the rules that bind Agents are held to the trust anchor's cap ([Terms](#terms)), never Allowed:
  - Role cards and their authority settings;
  - Hard switches;
  - approving held calls;
  - passing a Gate on one's own work;
  - Secret values.
- **The Caretaker:** it keeps at least the reach it has today. Widening it is left for later.
- **No bypass:** Agents change Office state only through Office tools.
- **Tool loading:** a session loads Office tools by area, and sees only the tools its Role allows.

## Terms

These terms are new or widened. The [glossary](../../GLOSSARY.md) carries them once the design is approved.

- **Authority:** what a person may do with Office tools, and when. It is set on the Role card, one authority setting per tool or group.
- **Authority setting:** the value of one tool or group:
  - **Allowed:** the call runs.
  - **Consult _person_:** the call waits on that person's approval.
  - **Ask me:** the call waits on the user's approval.
  - **Proposal:** the call drafts a Proposal, which the user applies.
  - **Never:** the tool isn't offered.
- **Tool area:** the Office tools of one part of The Office, such as Work or Library. An area is both what a session loads together and a section of the Role card's Authority.
- **Core:** the Office tools every session has loaded from the start. Core is not an area. Core as a whole has no setting: reading, `consult` and `answer_decision` (never on an approval or a Proposal) are always on; `remember` follows Shared memory and `capture_idea` has its row in Ideas.
- **Hard switch:** one of four named groups of authority settings: Run installs, Publish outside the Pipeline, Change Roles and Change Project settings. Two of them hold Office tools. The other two are followed by the Agent, because no Office tool exists for them yet.
- **Own work:** for one person, a Task they created or worked a Stage of, an Idea or an Initiative they created, and an Initiative they have a shaping Thread on (a planning Thread doesn't count).
- **Trust anchor:** the tools that change the rules binding Agents. Their setting is held to the trust anchor's cap, and The Office enforces it.
- **The trust anchor's cap:** a trust-anchor item can be set only to Proposal or Ask me, or Never (not offered); never Allowed or Consult a person.
- **The user's alone:** the one list of actions no Agent takes, each with its reason. It holds the reasons for the caps (the trust anchor's, and Publishing settings', which take the same values) and the actions that have no Office tool at all.

## 1. Authority per tool

### The question

Today seven mechanisms decide whether a person may use an Office tool:

- the Thread kind;
- the duties held;
- the preset's key;
- a capability;
- a Hard switch;
- being a record's creator;
- authority written in words.

Office actions are bound only by the words. Agents read the words, but nothing enforces them.

### Options

**A. Keep the words, add Hard switches as risks appear.**
- Nothing to build.
- Each new risky action needs a new switch, a migration and a new column in the defaults table.
- What the words say stays unenforced: the Office Manager's "never alone on starting work" holds today only because no tool exists to start work.

**B. One setting per tool, every tool listed.**
- Exact.
- About two hundred rows on the card: nobody reads them, and every new tool adds a row to every card.

**C. One setting per tool area, with groups and single tools inside an area only where they differ.** This is the MCP tool settings, widened.
- It uses the same card section, the same rulings, the same held calls and the same approval cards as today.
- An area shows one value. A group or a single tool shows only where its value differs from its area's, or where a cap or domain rule applies to it.

### Recommendation: C

**The card's Authority section:**
- one row per area;
- inside an area, the named groups (two of them are Hard switches) and the single tools that differ;
- then the Hard switches that are followed by the Agent, and beside them the row Approve held calls and apply Proposals, which belongs to no area;
- then the MCP servers' tools, as today.

**Groups each area shows.** The defaults are in [Authority by role](#authority-by-role).

| Area | Groups and single tools inside it |
|---|---|
| Core (not an area, no row on the card) | Reading, `consult` and `answer_decision`, always on; `remember`, offered while the card's Shared memory is on, which is its setting; `capture_idea`, loaded with Core, its setting the single row in Ideas |
| Work | Task records; Moving work; Gates and runs; Continue at a Gate on own work (a single tool, trust anchor) |
| Initiatives | Initiative records; Running an Initiative |
| Ideas | Ideas; `capture_idea` (a single tool) |
| Projects and settings | Change Project settings (a Hard switch); Publishing settings (capped, for its reason in The user's alone); Project settings; Project upkeep; Secret values (trust anchor) |
| People and Roles | Change Roles (a Hard switch, trust anchor); Memory and Avatar |
| Library | Skills; MCP servers (their Secret values: trust anchor); Pipelines and Stage templates; Prompt templates |
| Office settings | Office settings |
| Test instances and devices | Test instances; Project devices |
| Operations | Fire alarm; Checks; Updates and restarts |
| Followed by the Agent | Run installs; Publish outside the Pipeline (the two Hard switches with no Office tool) |
| No area | Approve held calls and apply Proposals (trust anchor), shown after the areas beside the followed groups |

- **The card shows at most 28 rows** besides the MCP servers' tools, as [Authority by role](#authority-by-role) lists them: 23 groups and 2 single tools in the nine areas, the 2 followed groups, and the approvals row.
- A group or a single tool in an area shows its own row only where its value differs from its area's, or where a cap applies to it. An area whose groups all share one value shows as one row.

**Own work and others' work.**
- In the Work, Initiatives and Ideas areas, a value can differ on the person's own work and on others' work.
- The card then shows "Own: Allowed · Others': Ask me" on one row.
- This replaces the words in today's presets: decide alone on one's own records, ask the user before Dropping somebody else's.

**Rulings are enforced in one place.**
- Every Office tool call goes through one ruling step, in the registry, before its handler runs. `HeldCalls` widens to cover it.
- Allowed runs the call.
- Consult and Ask me hold it.
- Proposal drafts it.
- Never: the tool is never offered (see [7](#7-tool-loading-by-area)).
- The descriptions' reminder to follow one's authority (`FOLLOW_YOUR_AUTHORITY`) is removed.

**Authority in words goes.**
- The Role's instructions keep the job's guidance.
- They no longer carry "decide alone, consult first, ask the user". A setting says that and enforces it.

**Proposal and Ask me both exist for the same tool.** We weighed keeping only one of them. Both need the user's click, so neither gives more reach than the other. What differs is when the change runs and in whose name:

| | Ask me | Proposal |
|---|---|---|
| The Agent | waits, then repeats the call, which runs once | goes on at once; the call drafts a card |
| Runs | straight after Allow once | when the user applies, possibly days later |
| In whose name | the person's, with the approving user recorded | the applying user's, with the proposing person recorded |
| Fits | actions the Agent's work goes on from (start a Task, install) | changes the user reviews whole (cards, settings, Pipelines) |

- Because the reach is the same, moving a setting between Ask me and Proposal grants nothing and takes nothing away. The migration relies on that.

**A declaration's default cover becomes preset defaults.**
- An Office action's declaration replaces its one cover (duties, or a record's creators) with its **area**, its **group** and its **default authority**:
  - the setting it starts at for each preset;
  - the setting it starts at for a Role hired from scratch;
  - any cap that applies to it.
- The presets' column of the [Authority by role](#authority-by-role) table is built from those declarations.
- A test fails for a declaration without an area.

**A domain rule stays the floor.**
- What nobody may do stays a refusal in the handler, for every setting, Allowed included. For example, an Agent never Drops work that has started.
- A setting never lifts a domain rule.

**Spec pages:**
- [6 › Authority](../spec/6-permissions-and-safety.md#authority) (the setting values, the areas table and the rules);
- [2.2 › Role card and Authority and Hard switches](../spec/2.2-people.md#authority-and-hard-switches);
- [5.4.1 › Office actions](../spec/5.4.1-engine-kinds.md#office-actions) (the registry and its ruling step);
- [screens/people.md › Role card tab](../spec/screens/people.md#role-card-tab).

## 2. Hard switches become named groups

### Options

**A. Drop the Hard switches.** Spread their tools over the areas.
- Fewest concepts.
- But Run installs and Publish outside the Pipeline have no Office tool, so they would have nowhere to live. Every card would also lose four names users already know.

**B. Keep them as named groups inside the authority model.**
- Each is a group with one setting.
- It sits in its area when it holds Office tools, and among the followed groups when it holds none.

### Recommendation: B

| Hard switch | Becomes | Holds | Enforced |
|---|---|---|---|
| Run installs | A followed group | Installs that change the machine outside the worktree; `run_environment_check` | Followed by the Agent; enforced on `run_environment_check` |
| Publish outside the Pipeline | A followed group | Pushing, opening a pull request, releasing, deploying, outside a Publish Stage | Followed by the Agent |
| Change Roles | A group in People and Roles, part of the trust anchor | Hiring, changing a Role card (its authority settings, profile, capabilities and MCP tool settings included), letting a Role go, hiring one back | By The Office |
| Change Project settings | A group in Projects and settings | The sections of `change_project_settings`: environment, install, commands, test targets, Actions that stay on the workstation, Run environment (Actions that leave it are in Publishing settings) | By The Office |

**The card's marks.**
- A followed group carries the badge "Followed by the Agent", and Run installs adds "enforced on run_environment_check".
- Every other row carries no badge, since The Office enforces them all.
- A row whose setting is capped carries "Proposal, Ask me or Never", with a link to its reason: the trust anchor, or The user's alone for Publishing settings.

**Migration: today's values on every card.** These rules move each card to the new model:
- **Today's four values:**
  - Run installs, Publish outside the Pipeline and Change Project settings keep their values in their groups.
  - Change Roles maps into the trust anchor, by these rules alone:
    - Allowed and Consult _person_ become Ask me;
    - Ask me stays Ask me, so the Office Manager's Change Roles migrates to "set: Ask me", though its preset's default is Proposal;
    - Never becomes Proposal for a person who drafts Roles today (the holder of Default person to talk to), and stays Never for everyone else.
  - The Caretaker's card takes its fixed Authority instead ([5](#5-the-caretakers-exception)).
- **A missing value:** a Change Project settings value missing from a card reads as Ask me, the Caretaker's as Never, including on a card a rollback saved before the update ran. No other value can be missing on a card today.
- **The trust anchor's cap is the one deliberate loss:** a Change Roles value of Allowed or Consult _person_ becomes Ask me. Otherwise nobody gains or loses reach on the migration. Every other group gets the most permissive of the paths the person has today:
  - a duty's tools: Allowed for a duty's direct tools, Proposal for its `propose_*` tools;
  - being a record's creator: own work Allowed, others' work Ask me, from the presets' words;
  - a capability;
  - Ask me and Proposal count as equal;
  - with no path at all, Never.
- **Where the person has both a Proposal path and an Ask me path for one tool,** the preset's default decides between them. Only then.
- **New tools start at the preset's default.** A tool that comes in after the migration starts at its preset's default on cards of that preset, and at the default for Roles from scratch on other cards.
- **A one-time update.** The migration is one update of the Role cards, which adds a Role card version "Authority from the Hard switches and duties" with no proposer.
- **The old columns stay.** The Hard switch columns are read until a later release, per the rule that migrations keep the previous release working ([AGENTS.md](../../AGENTS.md)).

**Preset updates leave the user's fields alone.** We weighed three ways:
- A hire copies its preset, as today, so a release's change to a preset reaches only new hires.
  - Rejected: a new tool would reach no hired card, and its row would be blank.
- A release rewrites every card.
  - Rejected: it overwrites what the user chose.
- **Recommended:** every authority setting is either **the preset's default** or **set**, as a Model is "Engine's default" unless set.
  - A setting at the preset's default follows the preset, so a release's new default reaches it at the next session start.
  - A setting the user set, or that an applied Proposal or an approved call set, stays as it is.
  - The card shows "Preset default (Ask me)" in muted text and a set value plainly, and **Reset to the preset's default** puts a set value back.
  - Migrated values equal to the preset's default become the preset's default; others are set.
  - A Role from scratch follows "The Office's default" the same way.
  - The other fields of a card (instructions, profile, capabilities) still copy on hire, as today.

**Defaults.** An [Authority by role](#authority-by-role) table replaces "Hard switches by role" in spec 6 › Defaults.

**Spec pages:**
- [6 › Hard switches](../spec/6-permissions-and-safety.md#hard-switches) and [6 › Defaults](../spec/6-permissions-and-safety.md#authority-by-role);
- [2.2 › Presets](../spec/2.2-people.md#presets).

## 3. Proposal as a ruling

### Options

**A. Keep a `propose_*` tool, an applier and a card for each kind.**
- Each card fits its kind exactly.
- But "by Proposal" costs a new kind every time, and whether an applier calls the route's own method is up to whoever wrote it.

**B. One generic Proposal.**
- A call ruled Proposal drafts one Proposal holding the action's name, its input and the version of what it changes.
- Applying it runs the action's one handler, the same as the user's click, in the applying user's name.

### Recommendation: B

**The generic card.**
- Its title is "Proposal: <action's title>", such as "Proposal: Start a Task".
- It names the subject with a link (the Task, the Project, the Role).
- It lists the change as the approval card of a held call lists it:
  - each field changed, before and after where it reads well;
  - long texts as a diff;
  - Secret values by name only.
- It ends with **Apply change** and **Not now**, as every Proposal card in a Thread does; Not now declines it.
- Where the subject has its own editor (a Role card, a Pipeline), the card adds **Edit before applying**. That opens the page's own form, filled in, and its save applies the Proposal with what the user edited, as "Edit the proposed Role" does today.
- It is one Proposal kind, `office-action`, on the Decision card ([2.4.2](../spec/2.4.2-decisions.md)).

**A subject that changed since the draft.**
- At the draft, the Proposal keeps the version of its subject: a record's version, or a setting's value or version.
- Applying compares that version first.
- If the subject changed, applying is refused with "<subject> changed since <person> drafted this. Ask them to draft it again." The card then reads "Out of date" and offers only Not now.
- As today, applying one Proposal declines every older open one that changes the same subject.

**Folding the per-kind tools in, over time.**
- **New actions:** from Task 4 onward, a new action has no `propose_*` tool. Its Proposal is a ruling.
- **Existing tools:** each `propose_*` tool is replaced by its action ruled Proposal, area by area, in the Tasks that build that area (Task 5, for the areas it moves, and Tasks 10–12):
  - `propose_role` becomes `change_role_card` and `hire_role` at Proposal;
  - `propose_office_setting` becomes the Office setting actions;
  - `propose_project_commands`, `propose_test_targets` and `propose_actions` become the sections of the Project setting actions;
  - `propose_library_pipeline`, `propose_project_pipeline` and `propose_stage_template` become the Pipeline actions;
  - `propose_prompt_template` and its reset become the Prompt template actions;
  - `propose_skill`, `propose_skill_install` and `propose_skill_update` become the skill actions.
- **Open Proposals of an old kind** stay applicable until they are applied or declined. A later release removes the old appliers once no old Proposal is open.
- **What stays its own:**
  - `propose_bug_task`, which is a Decision and not a Proposal;
  - `propose_office_setup`, a bundle of hires and duty assignments applied together;
  - `propose_project`, which adds a Project and starts its Onboard Task.
  - A bundle is weighed again only when a second one is needed.

**Spec pages:**
- [6 › Authority](../spec/6-permissions-and-safety.md#authority);
- [2.4.2 › Proposals and approvals](../spec/2.4.2-decisions.md#proposals-and-approvals);
- [5.4.1 › Office actions](../spec/5.4.1-engine-kinds.md#office-actions) (the registry's ruling step that drafts it).

## 4. The trust anchor and the user's alone

### Options

**A. Leave each exclusion on its own page, as today.**
- Nothing moves.
- But from outside, a deliberate exclusion and a missing tool look the same.
- Several entries have no reason: Reopen, Restart from and Start over.
- The write-route register cites eight different headings.

**B. One section of spec 6, "The user's alone", every item with its reason.**
- The register's `usersAlone` entries cite this section.
- Items with no reason move into the authority model.

### Recommendation: B

**The trust anchor, held to the trust anchor's cap ([Terms](#terms)).**
- Consult is left out because a colleague's Allow once would let one Agent loosen the rules that bind another.
- **Role cards and their authority settings:** the Change Roles group, which covers hiring, every field of a card (its authority settings, Hard switches, profile, capabilities and MCP tool settings among them), letting a Role go and hiring one back.
- **Hard switches:** these are now authority settings on the card, so the Change Roles group covers them.
- **Approve held calls and apply Proposals:** one row of its own, which belongs to no area. The card shows it after the areas, beside the followed groups.
  - answering an approval for the user (`answer_decision` on an approval);
  - applying or declining a Proposal.
  - Ask me and Proposal here amount to putting the same thing to the user, so every preset leaves it at Never.
- **Passing a Gate on one's own work:** Continue at a Gate of a Task that is the person's own work, one they created or worked a Stage of. Send back and Drop at a Gate are not passing it, so they follow the Gates and runs group.
- **Secret values:** the values of a Project's Secret variables and of an MCP server's secret Server values. The card shows each by name only.

**No Office tool at all.** The other items on the list have no Office tool, and their routes are `usersAlone` in the register:

| Item | Reason |
|---|---|
| The user's own account: profile, password, appearance, authenticator, recovery codes, passkeys, linked identities, signed-in devices, notification settings | Each user's own ([2.10](../spec/2.10-users-and-signing-in.md#per-user-and-shared)); a person is never a user. |
| Signing in and out, in every way | A person is never a user ([2.10](../spec/2.10-users-and-signing-in.md#users)). |
| Users: add, one-time password, remove; closing First-run setup | Signing in guards The Office against people without an account ([6 › Threat model for signing in](../spec/6-permissions-and-safety.md#threat-model-for-signing-in)). |
| Credentials: an engine's sign-in, code, token or API key; GitHub sign-in; the Google client; the OpenID Connect provider; the Office identity's ssh key; known hosts | They sign The Office in somewhere, or decide whom it trusts, and are refused to Agents ([6 › Secrets](../spec/6-permissions-and-safety.md#secrets)). |
| The fire alarm's all clear, a lift and dropping a lift | The fire alarm is the user's stop ([2.8](../spec/2.8-fire-alarm.md)). |
| Deleting a Task's or an Initiative's branch | Deleting work isn't an Agent's call ([5.5](../spec/5.5-git-and-isolation.md#deleting-by-hand)). |
| Starting or stopping an Action run | No Agent starts an Action; one that leaves the workstation would need a Hard switch of its own ([2.15](../spec/2.15-actions.md#who-starts-an-action)). |
| Merging a pull request | Merging into the base is publishing, which a Publish Stage does ([2.3.4](../spec/2.3.4-publish.md)). |
| Allow changes on a Caretaker Thread | A Thread switch with no Office tool. It widens the Caretaker's reach past Office tools, which this design leaves out of scope ([2.4.1](../spec/2.4.1-threads.md#allow-changes)). |

**These move into the authority model, each with a preset default:**
- Reopen a Dropped Task, Restart from a Stage (Skip a Stage among it), Start over: Work › Gates and runs.
- A Gate's Continue on others' work, and Send back and Drop at a Gate: Work › Gates and runs.
- Scheduling or cancelling an Office update or restart: Operations › Updates and restarts.
- Closing a pull request: Projects and settings › Project upkeep.
- Saved views: Work › Moving work.
- The Project settings that are by Proposal or on the page today (Publishing mode, Before and After publishing, Delete branches once merged, GitHub issues write-back, Actions that leave the workstation): Projects and settings › Publishing settings. They are not in the trust anchor, but take the same values (Proposal, Ask me or Never), for a reason of their own on this list: they decide what leaves the workstation.
- Server values that aren't secret, the Engine, the Default Pipeline and Project Pipelines: Projects and settings › Project settings.

**Spec pages:**
- [6 › The user's alone](../spec/6-permissions-and-safety.md#the-users-alone);
- [6 › The trust anchor](../spec/6-permissions-and-safety.md#the-trust-anchor).

The register's entries move to these headings when Task 4 builds them. Until then the old headings stay, so the register's test still resolves them. The `restart`, `start-over` and `reopen` entries have no reason here: they become Office actions and leave the register as Task 4 builds them.

## 5. The Caretaker's exception

### The question

The Caretaker must keep at least the reach it has today and gain nothing new. Expressing that reach in the new model must not widen it.

### Its reach today, exactly

- **Reading:** the Office instructions, Role cards, Prompt templates, Pipelines, Stage templates, and every record as everyone does.
- **Proposal tools, in every Thread, with Allow changes on or off:**
  - `propose_office_setting` (the Office settings, duty assignments among them);
  - `propose_role`: a new Role, a hire from a preset, or a change to a hired Role's card;
  - `propose_office_setup`, its own tool;
  - `propose_prompt_template` and `propose_prompt_template_reset`;
  - `propose_library_pipeline`, `propose_project_pipeline` and `propose_stage_template`.
- **Everyone's tools:**
  - Core: the reading tools, `consult`, `open_decision` in its chat, and `answer_decision` on a Decision waiting on the user in a Thread the user talks in, never on an approval or a Proposal;
  - `capture_idea`;
  - `create_task`, and the Office actions on Tasks and Ideas, with the presets' words (decide alone on its own, ask the user before Dropping others');
  - `propose_skill`, a new skill only;
  - `remember`, while Shared memory is on.
- **The drafting tools it shares with the Default person to talk to:** `personOfficeTools` gives `propose_role`, `propose_office_setting`, `read_office_instructions` and the prompt templates' tools from the Caretaker's own branch, in every Thread, whoever holds that duty. The Caretaker holds no duty, as no built-in Role does. `post_link_card`, `show_office_status` and `create_initiative` never come with them.
- **Allow changes:** with it on, a Thread on the whole workstation can:
  - read and edit anywhere but the secrets (the Office data folder, `.git`, `.claude` and `.mcp.json` included);
  - run any command, every git command and the container runtime included.
- **Fixed parts:**
  - its capabilities (Chat and Shared memory on, Consultant and Run environment off);
  - its permission profile (edit on, run anything, web on);
  - its Hard switches (Run installs Allowed, Publish outside the Pipeline Allowed, Change Roles Never, Change Project settings Never);
  - a Task limit of none.
- **Editable parts:** its MCP servers and their tool settings.

### Options

**A. Exempt the Caretaker from the authority model.** Its reach stays in code by its key.
- Two models to keep apart forever.
- A new tool's author has to decide again whether the Caretaker gets it.

**B. A built-in, fixed Authority on its card that equals its reach today.**
- Every group it has no path to is Never, and fixed.

### Recommendation: B

**Its fixed Authority:**

It grants nothing new: each row is narrowed to what it drafts today.

| Group | Value |
|---|---|
| Core | As for everyone: reading, `consult` and `answer_decision` (never on an approval or a Proposal); `remember` while Shared memory is on, which is fixed on |
| Work › Task records | Own: Allowed · Others': Ask me |
| Ideas | Own: Allowed · Others': Ask me |
| Ideas › `capture_idea` | Allowed |
| People and Roles › Change Roles | Proposal, `propose_role` only: a new Role, a hire from a preset or a card change; never letting a Role go or hiring one back |
| `propose_office_setup`, its own tool | Proposal |
| Office settings | Proposal (`propose_office_setting`) |
| Library › Skills | Proposal, a new skill only (`propose_skill`) |
| Library › Pipelines and Stage templates | Proposal, the drafts only: `propose_library_pipeline` and `propose_stage_template` |
| Projects and settings › Project settings | Proposal, a Project Pipeline's draft only (`propose_project_pipeline`) |
| Library › Prompt templates | Proposal (`propose_prompt_template` and `propose_prompt_template_reset`) |
| Run installs | Allowed |
| Publish outside the Pipeline | Allowed |
| Every other group and tool | Never |

- **The three Pipeline drafts** are the two Library rows' and the Project settings row's: `propose_library_pipeline`, `propose_stage_template` and `propose_project_pipeline`, and nothing else of those groups.
- **The drafting tools it shares with the Default person to talk to** come from its own fixed Authority, in every Thread, whoever holds that duty, as they do today. `post_link_card`, `show_office_status` and `create_initiative` never come with them.
- **Allow changes on its Thread** stays the user's alone ([4](#4-the-trust-anchor-and-the-users-alone)): the user turns it on in the Thread, as today.
- **Fixed like its profile:** the card shows its Authority as "Built in: fixed for the Caretaker". A change is refused.
- **A new tool is Never on its card** until a later Task decides otherwise on purpose. Widening is out of scope here.
- **Allow changes and the new hook rule:** Allow changes keeps its reach. The one new hook rule ([6](#6-no-bypass)) binds the Caretaker too. That narrows nothing it can do today, because it can neither sign in to `/api` nor read the database's password.

**Spec page:** [2.2 › Caretaker](../spec/2.2-people.md#caretaker).

## 6. No bypass

### What already holds

The boundary is sign-in and the credentials kept from sessions. Together they already close the API and the database to Agents:

- **The API:** every `/api` request and every WebSocket needs a signed-in device, from `localhost` too ([2.10](../spec/2.10-users-and-signing-in.md#what-every-request-needs)).
  - An Agent has no sign-in token.
  - Browser profiles are secret paths.
  - Tokens are stored only as hashes.
- **The session's variables:** `sessionEnvironment` strips The Office's own variables from every session, `DATABASE_URL` among them, as well as the engine's and the container runtime's (`engine/adapters/claude-code/session-settings.ts`).
- **The secrets:** The Office's `.env`, `identity/` and the engines' folder are refused to everyone, the Caretaker with Allow changes on included. The rest of The Office's data is refused to every session but that one (`engine/domain/secret-paths.ts`).
- **The tool servers:**
  - The Codex `office` MCP server sits behind a per-session bearer token that is in no environment.
  - The `-p` hook's token reaches only its own session's hook, which judges by that session's rules.

### Options

**A. Write down what holds, and add nothing.** It is enough under the threat model. But an Agent that read the spec's routes and tries `curl` gets a 401, and one that tries `psql` gets a password failure. Neither says "use the Office tool".

**B. Add a hook rule that refuses commands naming The Office's own address or database.** It works beside the container runtime rule. It is a clear refusal on top of the boundary, not the boundary itself.

**C. As B, and also refuse database client programs (`psql`, `pg_dump`) outright.** Rejected: Projects have Postgres of their own, The Office's own tests among them.

### Recommendation: B (CTO, Consultation on this Task)

**The rule** is `office-reach-commands.ts` in the engine module's domain, applied in the `PreToolUse` hook.
- **It refuses a shell command whose words name either of these:**
  - **The running Office's address on loopback:** `localhost`, `127.0.0.0/8`, `::1` or `0.0.0.0`, together with the exact port this service listens on.
  - **The running Office's database:** the service's full `DATABASE_URL`, or its database name together with its exact host and port, as `DATABASE_URL` has them.
- **A command naming no host or port isn't matched.** The stripped credentials are the boundary, and a bare database name could be the dev instance's database.
- **It never matches a default port or a host name alone.** The Office is also a Project here: its dev service, its service start check (port 4392) and its run environment's own Postgres are never refused.
- **It leaves out the public address and the host's name.** Matching them is fragile, and the reverse proxy needs a sign-in anyway.
- **`/api/health` is allowed.** It reads only whether the database is up and whether this is a test instance.
- **Where it judges:** it judges the session's own shell, which runs on the host. A command run in the Task's run environment (`run_project_command`) isn't matched, since loopback there is the run environment's own.
- **The refusal reads:** "Not allowed: this reaches The Office's own <API | database>. Change Office state with your Office tools; load an area with <how>."
- **Accepted limit,** as for the container runtime: the hook sees the command, not what it runs, so an npm script that calls the API isn't seen.
- **It binds every session,** the Caretaker with Allow changes on included. The Caretaker can't sign in or read the database's password today, so this narrows nothing real.
- **The accepted remainder:** the Caretaker with Allow changes on still edits files in The Office's data folder (for example, the skills library or a Task's worktree). That is its reach today. It is named in spec 6 as accepted.

**Spec pages:**
- [6 › No bypass](../spec/6-permissions-and-safety.md#no-bypass);
- [6 › Build rules](../spec/6-permissions-and-safety.md#build-rules) (the hook).

## 7. Tool loading by area

### The question

- **Today:** every Office tool of a session is `alwaysLoad` (`engine/adapters/agent-sdk/sdk-options.ts`, and `_meta['anthropic/alwaysLoad']` on the `-p` server). The tools come from fixed lists in `conversations/domain/session-instructions.ts` and `AGENT_STAGE_OFFICE_TOOLS`.
- **The problem:** with every user action an Office tool, about two hundred schemas would sit in every session's context.

### The areas

They are the Role card's areas ([1](#1-authority-per-tool)):
- Work;
- Initiatives;
- Ideas;
- Projects and settings;
- People and Roles;
- Library;
- Office settings;
- Test instances and devices;
- Operations.

**Core is loaded in every session from the start.** It is not one settable group:
- the reading tools (`read_*`, `list_*`, `read_attachment`, `read_stage_history`, `read_threads`);
- `consult`, `answer_consultation` in a Consultation, and `open_decision` where the Thread opens Decisions;
- `answer_decision`, offered to everyone, on a Decision waiting on the user in a Thread the user talks in; never in a Stage Thread or a Consultation, and never on an approval or a Proposal, which is the approvals row's ([4](#4-the-trust-anchor-and-the-users-alone));
- `remember`, offered while the card's Shared memory is on, which is its setting;
- `capture_idea`, loaded with Core, its setting the single row in Ideas;
- the Thread's or the Stage's own job tools: for an Agent Stage, `run_project_command`, `update_branch`, `choose_route`, `propose_bug_task` and the Stage's tools ([10](#10-a-stages-fixed-tool-list)); for a planning Thread, its planning tools.
- Reading, `consult` and `answer_decision` are always on where they apply. `remember` and `capture_idea` follow their settings.

### Options

**A. The engine's tool search over deferred Office tools.**
- Only Core is `alwaysLoad`. The rest of what the person's Authority allows is served deferred.
- The engine lists their names, and the Agent loads a tool with the engine's own search.
- Deferred tools don't change the cached prefix, so the prompt cache holds.

**B. `load_office_tools(area)`, with MCP `tools/list_changed`.**
- It changes the tool list mid-session, which breaks the cache ([5.4.1 › Cache breakers](../spec/5.4.1-engine-kinds.md#cache-breakers)).
- Support for it on the Codex app-server, the Copilot SDK's `defineTool` and the Gemini CLI is unknown. Rejected.

**C. A pair of Core tools on every engine.**
- `list_office_tools(area)` answers each allowed tool's name, description and input schema.
- `call_office_tool(name, input)` runs one.
- It works everywhere and never changes the tool list, but every call is one level removed from a typed tool.

### Recommendation: A on Claude Code, C on engines without tool search (CTO, Consultation on this Task)

- **Claude Code (the SDK and `-p`):**
  - Core is `alwaysLoad`, and so are the areas the session's home starts with: an Agent Stage's own tools; Work in a Thread on a Task; Work and Initiatives in an Initiative's Threads.
  - Every other allowed tool is deferred.
  - The Brief names each loaded area, and lists each other area with its allowed tools' names, so the Agent loads one with `ToolSearch` ("select:<names>").
- **Codex, Copilot CLI, Gemini CLI and the OpenAI-compatible API:**
  - Core and the home's areas are offered directly.
  - The rest is reached through `list_office_tools` and `call_office_tool`, which are in Core on these engines only.
- **`call_office_tool` is the same tool, not a side door:**
  - It is validated and ruled by the same registry and the same ruling as the direct tool.
  - A held call's approval card, a Proposal and the History name the real action and its input, never `call_office_tool`.
- **Never is never offered:**
  - A tool ruled Never is in no loaded set, no deferred list, no `list_office_tools` answer and no Brief.
  - A call naming it is refused as an unknown tool.
- **Fixed for the session:**
  - The allowed set is fixed when the session starts, as its MCP servers are.
  - A Role card change reaches the next session start.
- **Before we rely on it:**
  - The engine check proves deferral on both the SDK's in-process server and the `-p` server (new items `office-tools.deferred` and `office-tools.deferred-p`).
  - It also proves that the cache holds across a load.
  - Until both pass, Claude Code serves every allowed tool loaded, as today.

**Spec pages:**
- [6 › Tool areas](../spec/6-permissions-and-safety.md#tool-areas) (the areas table and the rules);
- [5.4.1 › Office actions](../spec/5.4.1-engine-kinds.md#office-actions) (the registry and the loading mechanics);
- [2.5 › The Brief](../spec/2.5-context-policy.md#the-brief) (the areas it names).

## 8. Duties back to jobs

### Options

**A. Keep duties as permissions.** Reassigning a duty silently moves tools: "Onboards and repairs Projects" grants CI re-runs, Workflow starts and Pipeline Proposals, none of which are onboarding.

**B. A duty says only who does a job and who is asked first.** Authority comes from the card alone. When a duty is assigned, The Office offers that job's settings as a Role card change.

### Recommendation: B

**A duty decides:**
- who a Stage naming it runs as;
- who is asked first (Asked first when a Stage runs out of tries, Default Consultant for MCP tool hard switches);
- who the buttons naming it point to;
- its fallback while nobody holds it.

It no longer adds or removes an Office tool.

**Assigning a duty:**
- When a duty moves to a new holder, Settings › Duties shows the job's settings that differ on the new holder's card ("This job needs: Projects and settings › Project upkeep Allowed, …"), with **Give <name> these settings** beside them.
- Pressing it is a Role card change by the user, which is part of the trust anchor.
- Moving a duty away removes nothing. Settings › Duties says "<name> keeps the authority on their card".
- The duty's job settings are part of each duty's declaration, next to its default holder ([2.2 › Duties](../spec/2.2-people.md#duties)).

**The migration** gives each card the settings its duties grant today ([2](#2-hard-switches-become-named-groups)), so nobody loses reach but by the trust anchor's cap on Change Roles.

**Spec pages:**
- [2.2 › Duty and Defaults › Duties](../spec/2.2-people.md#duty);
- [2.2 › Office Manager](../spec/2.2-people.md#office-manager).

## 9. Which user asked

### Options

**A. Record the person only, as today.** With several users, "the person in the Role cto" doesn't say whose request it was.

**B. Record the user who asked beside the person, on every direct change by a person.**

### Recommendation: B

**Who asked, by where the call is made:**
- **In a Thread a user talks in:** the user who wrote the message the person is answering. That is the newest user message in the Thread before the call's turn.
- **In a Consultation:** the user the chain started from, when it started from a user's message. Otherwise none.
- **In an Agent Stage:** no user asked. The record names the Stage run ("in a Stage of <Pipeline>").
- **A call held at Ask me** also records the user who allowed it.
- **An applied Proposal** keeps the applying user and "proposed by <person>", as today.

**How it reads:**
- History: "by the person in the Role cto, asked by Przemysław Telążka".
- A Project setting change, a Role card version and an Office setting version record it the same way.

**Spec pages:**
- [2.1.3 › History](../spec/2.1.3-tasks.md#history), for Tasks, and through it Ideas and Initiatives;
- [6 › Project settings by Agents](../spec/6-permissions-and-safety.md#project-settings-by-agents) (the record).

## 10. A Stage's fixed tool list

### Options

**A. A Stage keeps its fixed list, outside the authority model.** One person would then have two sets of rules: in a Stage `change_project_settings` follows the switch, but `write_commit_message` follows nothing.

**B. The Stage's list is the capability, intersected with the person's authority.**
- A Stage gets its job tools, each ruled by the person's setting.
- A Stage may narrow a setting, never widen it.

**C. A Stage takes the person's whole Authority.** Rejected: an Agent Stage does its Stage's work only, and a Developer's Stage must not start other Tasks because its card allows it in chat.

### Recommendation: B

**The Stage's tool list:**
- An Agent Stage's tools are its Stage's list: today's `AGENT_STAGE_OFFICE_TOOLS`, kept as the list every Agent Stage has.
- Each tool on it is offered only where the person's Authority isn't Never, and each call is ruled by that setting.
- In a Stage, Ask me and Consult hold the call on a Decision or a Consultation, as today.

**What a Stage may and may not change:**
- A Stage may narrow a setting (Allowed to Ask me, say), as it narrows the permission profile ([2.3.1](../spec/2.3.1-stages.md)).
- It never gains a tool or a value the person's card doesn't give.
- The person's other areas aren't loaded in a Stage.

**The presets** put the Stage's own tools on own work at Allowed for the Roles that work Stages: attachments, the commit message and the Bug Task. For example, the Developer's own Task's attachments and commit message are Allowed.

**Spec pages:**
- [2.3.1 › Stages](../spec/2.3.1-stages.md);
- [6 › A person's Office tools](../spec/6-permissions-and-safety.md#a-persons-office-tools).

## 11. A Consultation and Ask me

### Options

**A. Refuse, as today:** a Consultation opens no Decision of its own, so a call held at Ask me is refused. The same setting rules one way in a Stage and another in a Consultation.

**B. Read Ask me as Consult the user.** The call is held on an approval put to the user, as a missing person falls back to the user today ([2.2 › Escalation](../spec/2.2-people.md#escalation)).

### Recommendation: B

- **Where the approval shows:** in the place a Consultation's question to the user shows:
  - on a Task, in Needs you and on the Task;
  - from a chat, inline in the caller's chat.
- **It is one approval card,** Allow once or Deny, and the Consultation waits on it.
- **The user isn't a person in the chain of calls,** so it doesn't count against the two people asked.
- **Consult _person_ in a Consultation** goes to that person while the chain allows one more, and to the user once it doesn't, as today.

**Spec pages:**
- [2.4.3 › The callee's own permissions](../spec/2.4.3-consultations.md#the-callees-own-permissions);
- [6 › A Consultation's permissions](../spec/6-permissions-and-safety.md#a-consultations-permissions).

## Authority by role

The defaults each preset starts with, at the preset's default ([2](#2-hard-switches-become-named-groups)).
- "Own · Others'" gives the value on own work and on others' work.
- A capped row is held to the trust anchor's cap ([Terms](#terms)); Publishing settings takes the same values for its own reason, in The user's alone.
- Approve held calls and apply Proposals is a row of its own, in no area, shown beside the followed groups. It is Never on every preset.
- Spec 6 › Defaults carries this table.

| Group | Planner | Developer | Reviewer | CTO | Devops | Office Manager | From scratch |
|---|---|---|---|---|---|---|---|
| **Work** › Task records | Allowed · Ask me | Allowed · Ask me | Allowed · Never | Allowed · Ask me | Allowed · Ask me | Never | Ask me |
| Work › Moving work | Ask me | Never | Never | Ask me | Never | Ask me | Ask me |
| Work › Gates and runs | Never | Never | Never | Ask me | Never | Ask me | Ask me |
| Work › Continue at a Gate on own work (capped) | Never | Never | Never | Ask me | Never | Never | Never |
| **Initiatives** › Initiative records | Never | Never | Never | Allowed · Ask me | Never | Allowed · Ask me | Ask me |
| Initiatives › Running an Initiative | Never | Never | Never | Ask me | Never | Ask me | Ask me |
| **Ideas** | Allowed · Ask me | Allowed · Ask me | Allowed · Never | Allowed · Ask me | Allowed · Ask me | Allowed · Ask me | Ask me |
| Ideas › `capture_idea` | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed | Allowed |
| **Projects and settings** › Change Project settings | Never | Consult Devops | Never | Consult Devops | Allowed | Never | Ask me |
| Projects and settings › Publishing settings (capped) | Never | Never | Never | Never | Proposal | Never | Never |
| Projects and settings › Project settings | Never | Never | Never | Never | Proposal | Never | Ask me |
| Projects and settings › Project upkeep | Never | Never | Never | Never | Allowed | Never | Ask me |
| Projects and settings › Secret values (capped) | Never | Never | Never | Never | Never | Never | Never |
| **People and Roles** › Change Roles (capped) | Never | Never | Never | Never | Never | Proposal | Never |
| People and Roles › Memory and Avatar | Ask me | Never | Never | Ask me | Ask me | Ask me | Ask me |
| **Library** › Skills | Proposal | Proposal | Proposal | Proposal | Proposal | Proposal | Proposal |
| Library › MCP servers | Never | Never | Never | Never | Proposal | Never | Ask me |
| Library › Pipelines and Stage templates | Never | Never | Never | Never | Proposal | Never | Ask me |
| Library › Prompt templates | Never | Never | Never | Never | Never | Proposal | Ask me |
| **Office settings** | Never | Never | Never | Never | Never | Proposal | Ask me |
| **Test instances and devices** › Test instances | Never | Allowed | Allowed | Allowed | Allowed | Never | Ask me |
| Test instances and devices › Project devices | Never | Ask me | Never | Never | Ask me | Never | Ask me |
| **Operations** › Fire alarm | Never | Never | Never | Allowed | Allowed | Allowed | Ask me |
| Operations › Checks | Never | Never | Never | Allowed | Allowed | Allowed | Ask me |
| Operations › Updates and restarts | Never | Never | Never | Never | Ask me | Ask me | Ask me |
| **Followed** › Run installs | Consult Devops | Consult Devops | Consult Devops | Consult Devops | Allowed | Never | Ask me |
| Followed › Publish outside the Pipeline | Never | Consult CTO | Never | Ask me | Consult CTO | Never | Ask me |
| **No area** › Approve held calls and apply Proposals (capped) | Never | Never | Never | Never | Never | Never | Never |

**Notes:**
- **Duty tools** (a duty's direct tools, such as the planning tools for Plans) follow the job, not the table: their default is Allowed on the holder's card when the duty is assigned ([8](#8-duties-back-to-jobs)).
- **The Caretaker** has its own fixed Authority ([5](#5-the-caretakers-exception)).
- **Today's values kept:**
  - The Change Project settings, Run installs and Publish outside the Pipeline columns keep today's Hard switch values.
  - The Planner and the Reviewer, at Never for Change Project settings, keep it.
- **Office Manager:**
  - Its Change Roles is Proposal, which equals today's Ask me in reach ([1](#1-authority-per-tool)). A card hired before the update migrates to "set: Ask me" ([2](#2-hard-switches-become-named-groups)).
  - It keeps "never alone" on starting, stopping and moving work, as Ask me.
- **Devops:** it keeps CI re-runs and Workflow starts (Project upkeep, Allowed) and its Pipeline, command, test target and Action Proposals.
- **Roles hired from scratch:**
  - Every group starts at Ask me, as Change Project settings does today, and every capped row at Never.
  - Two rows differ, as everyone has them today: Library › Skills starts at Proposal (`propose_skill`) and `capture_idea` at Allowed.
  - "From scratch" is The Office's default, which a set value overrides.

## 12. Consequences for the Initiative's Tasks

The new wording for Task 4 and Tasks 6–14. Once the design is approved, the Planner, or the CTO as their creator, copies these into the Tasks' Descriptions. Task 5 changes only in its last sentence, given below. A Stage can't edit other Tasks.

### Task 4: Office actions beyond records

Built to docs/design/who-can-do-what.md and spec 6 › Authority. Large: split at planning into "Authority on the Role card" and "Office actions beyond records" if needed.

- **Authority on the Role card:**
  - one authority setting per tool area, group or single tool (Allowed, Consult a person, Ask me, Proposal, Never), with own and others' values in Work, Initiatives and Ideas;
  - the Hard switches as named groups;
  - the trust anchor's cap, enforced;
  - each setting at the preset's default or set, with Reset to the preset's default;
  - the migration from the four Hard switch values, the duties and the creators' cover, with no reach gained or lost but the trust anchor's cap on Change Roles (Allowed and Consult become Ask me);
  - the Caretaker's fixed Authority;
  - the Role card's Authority section, as screens/people.md describes it.
- **Office actions beyond records:**
  - widen `officeAction()` to every subject a user changes: Projects and their settings, Roles, skills, MCP servers, Pipelines, Stage templates, Office settings and test instances;
  - each declaration gives its area, group and default authority in place of its cover.
- **One ruling step in the registry for every Office tool call:**
  - held calls through `HeldCalls` for Consult and Ask me;
  - the generic `office-action` Proposal, which runs the same handler when applied and is refused when its subject changed since the draft;
  - Ask me in a Consultation read as Consult the user.
- **Remove** `FOLLOW_YOUR_AUTHORITY` and the authority words from the presets' instructions.
- **Tool loading by area:**
  - Core and the home's areas loaded;
  - the rest deferred on Claude Code once the engine check's `office-tools.deferred` items pass;
  - `list_office_tools` and `call_office_tool` on the other engines;
  - tools ruled Never never offered.
- **The hook rule** `office-reach-commands.ts`: the running Office's loopback port and its database, exactly as configured.
- **Record the user who asked** beside the person on every direct change.
- **Point the register's `usersAlone` entries** at spec 6 › The user's alone.
- **Restart from, Start over and Reopen** have no reason there: the register's `usersAlone` entries `POST /tasks/:id/restart`, `start-over` and `reopen` become Office actions of Work › Gates and runs, and leave the register as this Task builds them.

### Task 5: Move the parallel paths onto shared handlers

Unchanged but for its last sentence: "…and each `propose_*` tool of those areas is replaced by its action ruled Proposal ([3](#3-proposal-as-a-ruling)); open Proposals of an old kind stay applicable."

### Task 6: One person, one set of tools

- `attach_link`, `attach_file` (for Thread images), `write_commit_message` and `change_project_settings` become Office actions of the Work and Projects and settings areas. Each is offered in every Thread the user talks to the person in, and in their Agent Stages, ruled by their Authority.
- The Developer's and the Reviewer's own Task's attachments and commit message are Allowed by default.
- An Agent Stage's tool list is intersected with the person's Authority, and a Stage may narrow a setting, never widen it ([10](#10-a-stages-fixed-tool-list)).
- Waits for Task 4.

### Task 7: Agents move work

- These become Office actions of Work › Moving work:
  - Mark Ready;
  - confirm the Plan and the Definition of Done;
  - Start, Pause, Stop and Resume;
  - the queue's order and the board's order;
  - choosing the Pipeline and the engine;
  - Move to another Project;
  - Resolve conflicts;
  - saved views;
  - editing a Task's Stages;
  - Switch now to a Stand-in engine.
- Their presets: Planner, CTO and Office Manager at Ask me; Developer, Reviewer and Devops at Never; from scratch at Ask me.

### Task 8: Agents at Gates and Stages

- These become Office actions of Work › Gates and runs: Continue, Send back and Drop at a Gate.
- Restart from a Stage (Skip a Stage among it), Start over and Reopen a Dropped Task are in the same group, built in Task 4, which takes their "user's alone" lines out of the spec and their entries off the register.
- Their presets: CTO and Office Manager at Ask me; the others at Never.
- Continue at a Gate on own work (a Task the person created or worked a Stage of) is in the trust anchor, held to the trust anchor's cap, enforced.

### Task 9: Agents run Initiatives

- These become Office actions of Initiatives › Running an Initiative: Confirm, Back to Shaping, Start Ready Tasks, Pause and Resume.
- These become Office actions of Initiatives › Initiative records: the engine and the short name.
- Shaping an Idea marks it shaped.
- Their presets: CTO and Office Manager at Ask me to run an Initiative.

### Task 10: The rest of a Project's settings for Agents

- These become Office actions of Projects and settings › Project settings:
  - the Project limit, the mark and the feature switches;
  - Use this Project's skills and a skill's use;
  - Icon and Logo from the repository;
  - the Engine, the Default Pipeline and Project Pipelines;
  - Server values that aren't secret;
  - Onboard again, and setting up the run environment.
- These become Office actions of Project upkeep: fetching the base branch, importing GitHub issues and closing a pull request.
- These go in Publishing settings, capped at Proposal, Ask me or Never for its reason in The user's alone: the Publishing mode, Before and After publishing, Delete branches once merged, GitHub issues write-back, and Actions that leave the workstation.
- Secret values sit in the trust anchor, held to the trust anchor's cap, by name only on every card.
- `propose_project_commands`, `propose_test_targets` and `propose_actions` are replaced by these actions ruled Proposal ([3](#3-proposal-as-a-ruling)).

### Task 11: People and Memory for Agents

- These become Office actions of People and Roles › Change Roles (trust anchor, held to the trust anchor's cap):
  - hiring;
  - changing a Role card;
  - letting a Role go and hiring one back.
- `propose_role` is replaced by `change_role_card` and `hire_role` ruled Proposal ([3](#3-proposal-as-a-ruling)).
- Deleting one's own Memory note and the Avatar from a file go in People and Roles › Memory and Avatar.
- Duties stop granting tools.
- Settings › Duties offers the job's settings to the new holder as a Role card change ([8](#8-duties-back-to-jobs)).

### Task 12: The library and Office settings for Agents

- These become Office actions of the Library and Office settings areas, ruled Proposal for their preset holders:
  - skill switches, Roles and delete;
  - MCP servers, with Secret values in the trust anchor and shown by name only;
  - deleting and applying Pipelines and Stage templates;
  - every Office setting, the engines' non-credential settings among them.
- The skills', the Pipelines' (`propose_project_pipeline` among them), the prompt templates' and the Office settings' `propose_*` tools are replaced by these actions ruled Proposal ([3](#3-proposal-as-a-ruling)).
- Engine credentials stay the user's alone.

### Task 13: Test instances and devices for Agents

- These become Office actions of Test instances and devices:
  - start, stop and open a test instance;
  - get a built file's link;
  - lend a Project device to a Task.
- Their presets: Developer, Reviewer, CTO and Devops Allowed for test instances; Developer and Devops Ask me for devices.
- A Project device's address stays hidden from Agents.

### Task 14: Operations for Agents

- These become Office actions of Operations:
  - Fire alarm: sounding it;
  - Checks: checking for updates, checking GitHub permissions, the telemetry checks;
  - Updates and restarts: scheduling or cancelling an Office update or restart, Ask me for Devops and the Office Manager.
- The fire alarm's all clear and its lifts stay the user's alone.
