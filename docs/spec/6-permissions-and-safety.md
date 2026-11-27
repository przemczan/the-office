# 6 Permissions and safety

Covers: threat models, stored hashes, the two layers, language servers, Authority (Hard switches, MCP tools), the trust anchor, the user's alone, tool areas, Project settings by Agents, no bypass, refusals, default profiles, what a record made in a Thread links to, reading records, a person's Office tools, Consultations' permissions and their one exception (the run environment definition), chats, the Caretaker with Allow changes on, secrets, Secret variables, test instances, Connected devices and Project devices, Actions, build rules, Authority by role.

## Threat model

- The rules guard against an Agent's mistakes and keep the user in charge of what leaves the workstation; they do not contain a hostile Agent.
- Native Windows has no command sandbox.
- The Claude Code, Copilot CLI and OpenAI-compatible API engines run under the same rules on Linux so they behave alike.
- The Codex engine keeps its commands to the worktree in its own sandbox ([5.4](5.4-the-engine.md#defaults)).

## Threat model for signing in

- Signing in ([2.10](2.10-users-and-signing-in.md)) protects The Office against other people on the local network, who reach its address but have no account.
- It protects against other pages in the user's browser, which the `Host` and `Origin` checks ([5.1](5.1-shape.md)) and the `SameSite` cookie keep out.
- It protects against a stolen cookie, which its user ends by signing that device out from their account.
- It protects against a copy of the database, which holds no password, sign-in token or recovery code, only their hashes, so it signs nobody in.
- It leaves out processes on the host, which can read The Office's data and run the recovery command anyway, and a hostile reverse proxy, which sees every request.
- On a local network over plain HTTP a password and a cookie cross the network unencrypted, which the user accepts by using that address on a trusted network; the public address is HTTPS.

## Only hashes are stored

- Passwords, one-time passwords and recovery codes are stored as Node's `scrypt` with a random salt, its parameters kept with the hash so they can rise, compared in constant time.
- Sign-in tokens, being 32 random bytes, are stored as SHA-256.
- An authenticator's key and a Google OAuth client's and an OpenID Connect provider's secret must be read back, so they are kept in the database as the GitHub App's client secret is, read by Office code only and never by an Agent.
- An authenticator's key without its user's password signs nobody in.

## Two layers

- **Layer one, the permission profile:** what the session's shell and file tools may touch (read, edit, run, web), data on the Role card and edited there.
- **Layer two, Authority:** what a person may do with Office tools, and when, one authority setting per tool area, group or tool on the Role card ([Authority](#authority)).
- A Stage may narrow either layer, and which of the Project's commands it runs ([2.3.1](2.3.1-stages.md)), never widen it.
- **Office rules in code** sit beneath both layers, and neither loosens them: Agents never change git (read-only `status`, `diff`, `log`, `show` only, every Stage; the one exception is the Caretaker with Allow changes on); the HEAD and branch check; worktree restore after tests; the secrets refusal; the [no-bypass](#no-bypass) refusal; one `PreToolUse` hook that sees every call the engine's own input validation lets through, before any rule decides.
- The Office sets no path-scoped deny rule, which would refuse before the hook; validation refusals show only in `result.permission_denials` and are logged from there.

## Language servers run Project code

- They run outside the hook.
- An LSP call is judged as a read of its file, so each profile's read fence covers it, but the server it starts runs on its own.
- Reading a Project may run its Gradle build scripts or tsconfig plugins, in read-only sessions too (a Planner's Thread, a chat).
- The hook sees the LSP call, never what the server does.
- The threat model accepts this.

## Authority

- Authority is what a person may do with Office tools, and when, set on the Role card ([2.2](2.2-people.md#authority-and-hard-switches)).
- **Authority settings:**
  - **Allowed:** the call runs.
  - **Consult _person_:** the call waits on that person's approval.
  - **Ask me:** the call waits on the user's approval.
  - **Proposal:** the call drafts a Proposal, which the user applies.
  - **Never:** the tool isn't offered ([Tool areas](#tool-areas)).
- **One setting per tool area:** an area shows one value; a group or a single tool inside it shows only where its value differs from its area's, or where a cap or a domain rule applies to it ([the groups](#tool-areas)).
- The card's Authority lists one row per area, with its groups and the single tools that differ, then the followed groups ([Hard switches](#hard-switches)) and the row Approve held calls and apply Proposals ([the trust anchor](#the-trust-anchor)); then, in the MCP servers group right after it, each MCP tool's setting ([MCP tools](#mcp-tools)); how the card shows them is in [People › Role card tab](screens/people.md#role-card-tab).
- **Own work:** for one person, the Tasks, Ideas and Initiatives they created, every Task they worked a Stage of, the Stage running now included, and every Initiative they have a shaping Thread on; a planning Thread doesn't count.
- In the Work, Initiatives and Ideas areas a value can differ on own work and on others' work.
- **One ruling step:** every Office tool call is ruled once by its setting, before its handler runs, as [5.4.1 One ruling step](5.4.1-engine-kinds.md#one-ruling-step) says; held calls cover every Office tool, and their cards and Proposals are in [2.4.2](2.4.2-decisions.md#proposals-and-approvals).
- Approvals by colleagues show on the Task, in the Stage log and as one line in Since you left; never a Notification.
- A Decision never grants "always"; widening Authority is a Role card change.
- **Ask me and Proposal grant the same reach:** both need the user's click, so moving a setting between them grants nothing and takes nothing away.
  - Ask me: the Agent waits, then repeats the call, which runs straight after Allow once, in the person's name with the approving user recorded; it fits actions the Agent's work goes on from (start a Task, install).
  - Proposal: the Agent goes on at once, and the change runs when the user applies it, in the applying user's name; it fits changes the user reviews whole (cards, settings, Pipelines).
- **A domain rule is the floor:** what nobody may do stays a refusal in the handler for every setting, Allowed included (an Agent never Drops work that has started); a setting never lifts a domain rule.
- **Authority isn't written in words:** the Role's instructions carry the job's guidance, never "decide alone, consult first, ask the user", and no tool description reminds the Agent to follow its authority; the setting says it and The Office enforces it.
- **The preset's default or set:** each setting either follows its preset's default or is set, which stays as it is ([2.2](2.2-people.md#presets)); the defaults are in [Authority by role](#authority-by-role).
- Each Office action declares its area, its group and its default authority, which the Authority by role table is built from ([5.4.1](5.4.1-engine-kinds.md#office-actions)).

### Hard switches

- The Hard switches are four named groups of authority settings:

  | Hard switch | Where it sits | Holds | Enforced |
  |---|---|---|---|
  | Run installs | Followed | Installs that change the machine outside the worktree; `run_environment_check` | Followed by the Agent; by The Office on `run_environment_check` ([5.5](5.5-git-and-isolation.md#the-environment-check-tool)) |
  | Publish outside the Pipeline | Followed | Pushing, opening a pull request, releasing, deploying, outside a Publish Stage | Followed by the Agent |
  | Change Roles | People and Roles, in the [trust anchor](#the-trust-anchor) | Hiring, changing a Role card (its authority settings, profile, capabilities and MCP tool settings included), letting a Role go, hiring one back | By The Office |
  | Change Project settings | Projects and settings | The sections of `change_project_settings` ([below](#project-settings-by-agents)) | By The Office |

- The two followed groups have no Office tool, so they sit in no area.
- The card marks each followed group as followed by the Agent ([People › Role card tab](screens/people.md#role-card-tab)); The Office enforces every other row.
- The Office stays agnostic of each Project's stack, so the brief states the followed ones in plain words ("Before you install anything that changes the machine outside the worktree, consult Devops; adding or updating the Project's own dependencies is a code change") and the Agent asks through the consult tool first.
- **Moving the cards to Authority:** one update moves every Role card, adding a Role card version "Authority from the Hard switches and duties" with no proposer.
  - Run installs, Publish outside the Pipeline and Change Project settings keep their values in their groups.
  - Change Roles maps into the trust anchor: Allowed and Consult _person_ become Ask me, the one deliberate loss of reach, as the [cap](#the-trust-anchor) allows neither; Ask me stays Ask me, so the Office Manager's becomes set: Ask me; Never becomes Proposal for a person who drafts Roles (the holder of Default person to talk to, and the Caretaker) and stays Never for everyone else.
  - A Change Project settings value missing from a card reads as [A missing authority value](#a-missing-authority-value) says.
  - Otherwise nobody gains or loses reach: every other group gets the most permissive path the person had: Allowed for a duty's direct tools, Proposal for its `propose_*` tools; own work Allowed and others' work Ask me for records they could create; Allowed for a capability's tools; no path, Never.
  - Ask me and Proposal count as equal: only where a group has both a Proposal path and an Ask me path does the preset's default decide between them.
  - A migrated value equal to the preset's default becomes the preset's default; any other is set.
  - A tool added after the update starts at its preset's default on cards of that preset, and at the default for Roles from scratch on other cards.
  - The Hard switch columns stay and are read until a later release, as migrations keep the previous release working ([AGENTS.md](../../AGENTS.md#project-layout-and-defaults)).

### MCP tools

- Each tool of a Role's MCP servers ([5.4](5.4-the-engine.md#defaults)) has its own authority setting, listed in the Role card's MCP servers group, right after its Authority.
- It is set to Allowed, Consult a person, Ask me or Never.
- It starts at Consult the holder of Default Consultant for MCP tool hard switches, judged when the call is held, the user being asked while nobody holds it.
- A Stage may narrow it, never widen it.
- A held call waits as any held call does ([Authority](#authority)).
- Enforced by The Office: the hook judges every MCP tool call.

## The trust anchor

- The trust anchor is the Office tools that change the rules binding Agents.
- **The cap:** its settings are settable only to Proposal or Ask me, or Never (not offered); never Allowed or Consult a person. The Office enforces the cap.
- Consult a person is left out because a colleague's Allow once would let one Agent loosen the rules that bind another.
- The card marks a capped row, linking to its reason: the trust anchor, or [The user's alone](#the-users-alone) for Publishing settings ([People › Role card tab](screens/people.md#role-card-tab)).
- **Role cards and their authority settings:** the Change Roles group, which covers hiring, every field of a card (its authority settings, Hard switches, profile, capabilities and MCP tool settings among them), letting a Role go and hiring one back.
- **Hard switches:** they are authority settings on the card, so the Change Roles group covers them.
- **Approve held calls and apply Proposals:** answering an approval for the user (`answer_decision` on an approval), and applying or declining a Proposal.
  - It is one row of its own, in no area, shown after the areas beside the followed groups ([Tool areas](#tool-areas)).
  - Ask me and Proposal here amount to putting the same thing to the user, so every preset leaves it at Never.
- **Continue at a Gate on the person's own work:** Continue at a Gate of a Task the person created or worked a Stage of ([own work](#authority)); Send back and Drop at a Gate aren't passing the Gate, so they follow the Gates and runs group.
- **Secret values:** the values of a Project's Secret variables and of an MCP server's secret Server values, which the card, an approval card and a Proposal show by name only.

## The user's alone

- The user's alone is the one list of actions no Agent takes, each with its reason: the [trust anchor](#the-trust-anchor)'s cap, and the actions below, which have no Office tool at all.
- The write-route register's `usersAlone` entries cite this section; until an entry moves here, the heading it cites stays.
- **The user's own account** (profile, password, appearance, authenticator, recovery codes, passkeys, linked identities, signed-in devices, notification settings): each user's own ([2.10](2.10-users-and-signing-in.md#per-user-and-shared)); a person is never a user.
- **Signing in and out, in every way:** a person is never a user ([2.10](2.10-users-and-signing-in.md#users)).
- **Users** (add, one-time password, remove) and closing First-run setup: signing in guards The Office against people without an account ([Threat model for signing in](#threat-model-for-signing-in)).
- **Credentials** (an engine's sign-in, code, token or API key; GitHub sign-in; the Google client; the OpenID Connect provider; the Office identity's ssh key; known hosts): they sign The Office in somewhere, or decide whom it trusts, and are refused to Agents ([Secrets](#secrets)).
- **The fire alarm's all clear, a lift and dropping a lift:** the fire alarm is the user's stop ([2.8](2.8-fire-alarm.md)).
- **Deleting a Task's or an Initiative's branch:** deleting work isn't an Agent's call ([5.5](5.5-git-and-isolation.md#deleting-by-hand)).
- **Starting or stopping an Action run:** no Agent starts an Action; one that leaves the workstation would need a Hard switch of its own ([2.15](2.15-actions.md#who-starts-an-action), [Actions](#actions)).
- **Merging a pull request:** merging into the base is publishing, which a Publish Stage does ([2.3.4](2.3.4-publish.md)).
- **Allow changes on a Caretaker Thread:** a Thread switch with no Office tool, which would widen the Caretaker's reach past Office tools, left out of scope; the user turns it on in the Thread ([2.4.1](2.4.1-threads.md#allow-changes)).
- **Not the user's alone:** these are in Authority, each with a preset default ([Authority by role](#authority-by-role)):
  - Reopen a Dropped Task, Restart from a Stage (Skip a Stage among it) and Start over: Work › Gates and runs;
  - a Gate's Continue on others' work, and Send back and Drop at a Gate: Work › Gates and runs;
  - scheduling or cancelling an Office update or restart: Operations › Updates and restarts;
  - closing a pull request: Projects and settings › Project upkeep;
  - saved views: Work › Moving work;
  - the Publishing mode, Before and After publishing, Delete branches once merged, GitHub issues write-back and Actions that leave the workstation: Projects and settings › Publishing settings, under [the trust anchor's cap](#the-trust-anchor), as they decide what leaves the workstation;
  - Server values that aren't secret, the Engine, the Default Pipeline and Project Pipelines: Projects and settings › Project settings.

## Tool areas

- A tool area is the Office tools of one part of The Office: what a session loads together, and a section of the Role card's Authority.
- The nine areas and the groups and single tools each shows:

  | Area | Groups and single tools inside it |
  |---|---|
  | Work | Task records; Moving work; Gates and runs; Continue at a Gate on own work (a single tool, [trust anchor](#the-trust-anchor)) |
  | Initiatives | Initiative records; Running an Initiative |
  | Ideas | Ideas; `capture_idea` (a single row; the tool loads with Core) |
  | Projects and settings | Change Project settings (a Hard switch); Publishing settings (capped); Project settings; Project upkeep; Secret values (trust anchor) |
  | People and Roles | Change Roles (a Hard switch, trust anchor); Memory and Avatar |
  | Library | Skills; MCP servers (their Secret values in the trust anchor); Pipelines and Stage templates; Prompt templates |
  | Office settings | Office settings |
  | Test instances and devices | Test instances; Project devices |
  | Operations | Fire alarm; Checks; Updates and restarts |
  | Followed (no area) | Run installs; Publish outside the Pipeline ([Hard switches](#hard-switches)) |
  | No area | Approve held calls and apply Proposals ([trust anchor](#the-trust-anchor)) |

- **Core** is loaded in every session from the start; it isn't an area and isn't one settable group:
  - the reading tools (`read_*`, `list_*`, `read_attachment`, `read_stage_history`, `read_threads`);
  - `consult`, `answer_consultation` in a Consultation, and `open_decision` where the Thread opens Decisions;
  - `answer_decision`, offered to everyone on a Decision waiting on the user in a Thread the user talks in, never on an approval or a Proposal ([A person's Office tools](#a-persons-office-tools));
  - `remember`, offered while the card's Shared memory is on, which is its setting ([2.2](2.2-people.md#shared-memory));
  - `capture_idea`, whose setting is its single row in Ideas;
  - the Thread's or the Stage's own job tools: for an Agent Stage `run_project_command`, `update_branch`, `choose_route`, `propose_bug_task` and the Stage's tools ([2.3.1](2.3.1-stages.md#an-agent-stages-office-tools)); for a planning Thread its planning tools.
- Reading and `consult` are always on; the rest of Core follows the settings above, or comes with its Thread or Stage.
- **Loading:** a session loads Core and its home's areas from the start, and each other area its Authority allows when the Agent loads it, on each engine as [5.4.1 Loading by area](5.4.1-engine-kinds.md#loading-by-area) says; a tool at Never is never offered.
- The Brief names each loaded area, and lists each other area with its allowed tools' names ([2.5](2.5-context-policy.md#the-brief)).

## Project settings by Agents

- **Change Project settings** is a group in Projects and settings, one of the [Hard switches](#hard-switches), holding one Office tool, `change_project_settings`, which changes a Project's everyday settings by the Project page's rules, in optional sections, at least one per call:
  - environment variables: plain variables, Variables to remove and Folders in front of PATH; Secret variables are refused and kept as they are;
  - install and Install inputs;
  - commands: add, change by key, remove; Before and After publishing are refused;
  - test targets: add, change by key or remove; Secret variables by name only, a value already set kept;
  - Actions: add, change by key or remove; one marked Leaves the workstation is refused, pointing to `propose_actions`;
  - Run environment: On or Off, with no check of the base branch's `.devcontainer/` ([2.3.1](2.3.1-stages.md#script-stages-in-the-run-environment)).
- The sections apply in that order, Run environment last, each through the Projects method and Project setting change the Project page's save uses; a section refused leaves the ones before it applied, and the answer names them.
- Every refusal that needs no section applied is made by the tool's check before the call is held, and again on its repeat after Allow once, so no approval is spent on a call refused up front ([5.4.1 One ruling step](5.4.1-engine-kinds.md#one-ruling-step)).
- **The ruling:** one call is one held call, ruled by the one ruling step with the Project as its subject: Allowed applies it at once with no card; Consult _person_ and Ask me hold it on one approval card listing every change, Secret variables by name only; Proposal drafts it as one Proposal ([Authority](#authority)).
- **Who gets it:** every Thread the user talks to the person in, a chat included, and their Agent Stages, unless the setting is Never ([2.2](2.2-people.md#setting-a-project-up)); a Stage's list never adds a tool the person's Authority doesn't give.
- In a Consultation, a held call is put as [A Consultation's permissions](#a-consultations-permissions) says.
- **Settings outside the group:** the Publishing mode, Before and After publishing, Delete branches once merged, GitHub issues write-back and Actions that leave the workstation are Publishing settings, capped ([The user's alone](#the-users-alone)); Server values, the Engine, the Default Pipeline and Project Pipelines are Project settings; Secret variables' values are in the [trust anchor](#the-trust-anchor).
- The Proposal tools (`propose_project_commands`, `propose_test_targets`, `propose_actions`) draft those settings, and the group's for a person whose setting is Never, until the Project setting actions take their place, ruled Proposal.
- **The record:** every change of a Project's commands, test targets, Actions, environment or Run environment is kept as a Project setting change, in the same transaction as the change, by the Project page's saves, an applied Proposal and `change_project_settings` alike.
  - It holds the Project, the setting, a short summary naming what changed by name only (never a Secret variable's value), who made it and when.
  - Who made it is a user; a Proposal a user applied, with the person who proposed it; or a person by Role, name and title, with the Task (none from a chat), the user who asked beside them and, for a call held at Ask me or Consult _person_, the user who allowed it, as History names them ([2.1.3](2.1.3-tasks.md#history)).
  - The "Set up the run environment" Task's Done turning Run environment On ([2.1.3](2.1.3-tasks.md#setting-up-the-run-environment)) records nothing.
  - It is kept with the Project and removed with it.
  - `GET /api/projects/:id/setting-changes` answers the newest ([Defaults](#project-setting-changes-listed)), which the Project page's Recent activity lists ([project-page.md](screens/project-page.md#recent-activity-tile)).

## No bypass

- Agents change Office state only through Office tools.
- **The boundary is sign-in and the credentials kept from sessions**, which close the API and the database to Agents:
  - every `/api` request and every WebSocket needs a signed-in device, from `localhost` too ([2.10](2.10-users-and-signing-in.md#what-every-request-needs)); an Agent has no sign-in token, browser profiles are secret paths, and tokens are stored only as hashes;
  - every session's environment is stripped of The Office's own variables, `DATABASE_URL` among them, and of the engine's and the container runtime's;
  - The Office's `.env`, `identity/` and the engines' folder are refused to everyone, and the rest of The Office's data to every session but the Caretaker's with Allow changes on ([Secrets](#secrets));
  - the Codex `office` MCP server sits behind a per-session bearer token that is in no environment, and the `-p` hook's token reaches only its own session's hook, which judges by that session's rules.
- **The hook rule** is a clear refusal on top of the boundary, not the boundary itself: `office-reach-commands`, in the `PreToolUse` hook beside the container runtime rule.
- It refuses a shell command whose words name the running Office's address on loopback (`localhost`, `127.0.0.0/8`, `::1` or `0.0.0.0`) together with the exact port the service listens on.
- It refuses one whose words name the running Office's database: its full `DATABASE_URL`, or its database name together with its exact host and port, as the service's `DATABASE_URL` has them.
- A command naming the database with no host or port isn't matched: the stripped credentials are the boundary, and a bare name could be the dev instance's database.
- It never matches a default port or a host name alone: The Office is also a Project, and its dev service, its service start check (port 4392) and its run environment's own Postgres are never refused.
- It leaves out the public address and the host's name, as matching them is fragile and the reverse proxy needs a sign-in anyway.
- `/api/health` is allowed: it reads only whether the database is up and whether this is a test instance.
- It judges the session's own shell, on the host; a command run in the Task's run environment (`run_project_command`) isn't matched, as loopback there is the run environment's own.
- The refusal reads: "Not allowed: this reaches The Office's own <API | database>. Change Office state with your Office tools; load an area with <how>."
- **Accepted limit,** as for the container runtime: the hook sees the command, not what it runs, so an npm script that calls the API isn't seen.
- It binds every session, the Caretaker's with Allow changes on included, which narrows nothing real, as that Caretaker can neither sign in nor read the database's password.
- **The accepted remainder:** the Caretaker with Allow changes on still edits files in The Office's data folder (the skills library, a Task's worktree), its reach by design, which the threat model accepts.

## Other refusals

- They are immediate, with a reason the Agent reads ("Not allowed for a Reviewer: editing files. Open a Decision if you need it."), logged on the Thread.

## The knowledge base

- The knowledge base is this spec, `docs/spec/` with its index `docs/spec/README.md`, and the [glossary](../../GLOSSARY.md) it links to.
- A release carries it at the checkout's paths, so the direct install's release folder and the Compose image (`/opt/the-office/docs/spec/`) hold it; a checkout's is the checkout's own.
- The service finds it from its own install, as it finds the web app, with no setting; an install without it logs that once and goes on, its Briefs not naming it ([2.5](2.5-context-policy.md#the-brief)).
- Every session, on every engine, reads it where it is on the host, never in a Task's run environment, and never changes it: the hook allows Read, Grep, Glob and LSP there and refuses an edit or a command writing there.

## Reading records

- Everyone also reads their session's skills folder, the [knowledge base](#the-knowledge-base) and the engine's output of their own background commands, and uses the Office tools.
- Every session, Agent Stages included, can read every record with the Office tools: Projects, people, Tasks, Ideas, Initiatives, the links between them and all their Attachments, each by what it holds (`read_attachment`).
- Every session also reads the Pipelines, office-wide and Project Pipelines, all or one by its id (`list_pipelines`), and the Stage templates (`list_stage_templates`), each Stage whole: its brief, duty, session, budget and routes.
- `read_attachment` reads a text file, a document among them, and a PDF's text by numbered lines, in slices, a search for a phrase, and a line too long for one answer read on from a character.
- It gives an image as a picture on an engine that shows pictures (Claude Code), up to the size its answer passes, else in words saying why it isn't shown.
- It unzips a zip (by its media type or a `.zip` name) as it reads it, in memory, never to disk: the files it holds by path and size, read as lines are, and one of them, by its path (`entry`), as that file would be read as an Attachment of its own, up to 50 MB unpacked; a zip in a zip, an encrypted file or a broken zip isn't read.
- It gives any other file by its name, kind and size, saying it can't be read, and a link by its address.
- Every Thread the user talks to a person in ([A person's Office tools](#a-persons-office-tools)), and every Agent Stage, also read a Task's Stage history, from its Stage run records and, for one Agent Stage's run, its Stage Thread's messages, from The Office's log alone ([2.4.6](2.4.6-reading-records.md)).
- Every Thread the user talks to a person in also reads the Threads' messages with `read_threads`, from The Office's log alone; an Agent Stage doesn't.

## A person's Office tools

- Whoever the user talks to is the same person wherever they talk: each person has one set of Office tools, the same in every Thread the user talks to them in.
- Those Threads are their chat, their Thread on a Task, the Planner's Planning Thread, an Initiative's shaping and planning Threads, and a Consultation ([2.4.1](2.4.1-threads.md#what-each-thread-adds)).
- **The set comes from their Authority alone:** every Office tool it doesn't set at Never, loaded by area ([Tool areas](#tool-areas)), each call ruled by its setting ([Authority](#authority)).
- **Duties don't grant tools:** a duty says who does a job and who is asked first, never which Office tools a person has ([2.2](2.2-people.md#duty)).
- Everyone:
  - reads every record and Attachment, a Task's Stage history and the Threads (`read_stage_history`, `read_threads`; [Reading records](#reading-records));
  - calls someone (`consult`) when the user asks, or their Authority holds a call on that person's approval ([2.2](2.2-people.md#calls)).
- `answer_decision`, in [Core](#tool-areas), answers a Decision waiting on the user for them when the user asks, in a Thread the user talks in, never an approval of a held call or a Proposal, which are in the [trust anchor](#the-trust-anchor) and stay the user's own click ([2.4.2](2.4.2-decisions.md)).
- The holder of Default person to talk to points to whoever plans rather than creating a Task, and redirects with a Link card ([2.2](2.2-people.md#office-manager)).
- The Caretaker has a fixed Authority of its own ([2.2](2.2-people.md#caretaker)).
- None of these changes a file: a record and a Proposal aren't file changes, so a read-only Thread stays read-only with them.
- No Thread gains file edits or changing commands from them; the Caretaker's [Allow changes](#the-caretaker-with-allow-changes-on) stays the one exception.
- A card the tools post (an Idea's card, a Link card, the Office status) is logged in whichever Thread the user talks in, never in a Stage's Thread.
- A Task created or an Idea captured in a person's Thread on a Task is found while working on that Task, unless the person or the user says otherwise ([2.1.3](2.1.3-tasks.md#found-while-working-on); [Defaults](#what-a-record-made-in-a-thread-links-to)).
- Each kind of Thread adds only its own tools to the set ([2.4.1](2.4.1-threads.md#what-each-thread-adds)).
- **An Agent Stage** works with its Stage's tools, as [2.3.1 An Agent Stage's Office tools](2.3.1-stages.md#an-agent-stages-office-tools) says.

## A Consultation's permissions

- A Consultation works with its callee's own permissions, never the caller's, so a read-only Thread can't get a change made by calling someone.
- Its session is the Consultant's own, built from them alone: their Role card's permission profile and Authority, Hard switches and MCP tool settings among it, and their [Office tools](#a-persons-office-tools) but `answer_decision`, with `answer_consultation` for their answer.
- It opens no Decision of its own, and calls someone only while the chain of calls allows one more ([2.2](2.2-people.md#chains-of-calls)).
- A call it holds is still put, as [2.4.3 The callee's own permissions](2.4.3-consultations.md#the-callees-own-permissions) says.
- It only reads, as its home does (a Task's worktree on a Task, every Project's base branch in a chat), with no `change_role`, no Allow changes and no write access, so all a call can set up is a record, a Proposal the user applies, a Project setting the Consultant's Change Project settings allows ([Project settings by Agents](#project-settings-by-agents)), or the one exception below.
- A Stage that can write lends none of it to its callee.

### The one exception: the run environment definition

- In a Consultation on a Task, a Consultant whose Role card has the Run environment capability ([2.2](2.2-people.md)) writes the run environment definition with `write_run_environment_definition`, as an Agent Stage does ([5.5](5.5-git-and-isolation.md#writing-the-run-environment-definition)).
- No other write is lent to a Consultation, and a chat, a Planning Thread or a Consultation off a Task never gets the tool.
- The Office checks the definition, writes `.devcontainer/` into the Task's worktree, and commits only `.devcontainer/` on the Task's branch, "Run environment definition, by <name> (<Role>)"; nothing else staged or unstaged goes into the commit or changes.
- It refuses, writing nothing:
  - when `.devcontainer/` has changes not committed yet;
  - while a Stage of the Task runs other than the one whose Stage Thread waits on the Consultation, a Gate's or a Script Stage's run counting.
- The commit becomes the asking Stage run's expected head, so the Stage resumes on it rather than asking about a moved branch ([2.3.1](2.3.1-stages.md#a-branch-moved-outside-the-office)).
- The asking Thread logs The Office's line "Run environment definition, by <name> (<Role>): commit <short commit>, <paths>.", which the Stage history shows.

## Chats only read

- A chat session reads every Project's base branch, searches the web and uses its person's [Office tools](#a-persons-office-tools).
- A Thread on an Initiative with a Pipeline reads its Initiative's branch in the Projects it spans instead ([2.4.1](2.4.1-threads.md)).
- No edits, read-only commands only, though a language server its LSP calls start may run Project code.
- The one exception is a Caretaker Thread with Allow changes on ([2.4.1](2.4.1-threads.md)).
- The Caretaker's chat drafts Proposals of the Office settings, Role cards, Prompt templates, Pipelines and Stage templates with Allow changes on or off, since a Proposal changes nothing until the user applies it ([2.2](2.2-people.md#caretaker)).

## The Caretaker with Allow changes on

- It works on the whole workstation: its working folder is the user's home folder.
- It reads and edits anywhere (The Office's data folder, `.git`, `.claude` and `.mcp.json` included) and runs any command, `git push` too.
- Only the secrets refusal still holds, for reads and changes alike.
- The no-bypass hook rule binds it too; its edits in The Office's data folder are the accepted remainder ([No bypass](#no-bypass)).
- The fire alarm still holds every call: it is the user's stop.
- With it off, the Caretaker is refused as any chat is.

## Secrets

- The hook refuses reads, by file tools or in command text, of: `~/.ssh`; `~/.config/gh`; `~/.aws`; browser profiles (where each lives on Windows and on Linux is the platform layer's); the Office identity's folder, `<office-data>/identity/`, which holds its ssh key; the database credentials (The Office's `.env`); and the Claude credentials.
- The Claude credentials are `~/.claude/.credentials.json` and each Claude Code engine's account folder in the Office data, `<office-data>/engines/`.
- A token pasted for an engine is written there as the folder's credentials file, sits in no environment, and is refused to Agents as the folder is.
- The engines' folder stays secret but for each engine's session transcripts, `<office-data>/engines/<id>/projects/`, which the Caretaker's Threads read, raw and nothing hidden, with Allow changes on or off.
- That is an allow-list: the account files (`.credentials.json`, `.claude.json`, `settings.json`) and whatever else Claude Code keeps there stay refused, as do the engines' folder and an engine's folder named whole and a `..` path out of `projects/`.
- The API engine's conversation files, `<office-data>/sessions/<id>/conversation.json`, stay refused.
- The list is kept apart from The Office's own files: every session but the Caretaker's with Allow changes on is refused The Office's own data as well; that one is refused the secrets only, and the Caretaker's read-only Thread reads the engines' transcripts besides.
- A `.env` inside the worktree stays readable.
- The clones of Projects added by Repository URL, in `<office-data>/repositories/`, are left out of The Office's own data, so a cloned Project's folder reads as a path-added one's does.

## Secret variables

- A Project's Secret variables ([5.5](5.5-git-and-isolation.md#secret-variables)) reach its commands, its Tasks' sessions and its run environments' install, never a command line, an image layer or the web.
- They are hidden as `[secret NAME]` in the output The Office keeps and shows and in a Thread's messages.
- This guards against mistakes, not a hostile Agent: an Agent can use a value, and one that prints it reads it in the tool's result.

## Test instances

- A test instance ([2.12](2.12-test-instances.md#safety)) runs the Project's code from an Initiative's branch, which an Agent wrote, so it is kept from everything real.
- It gets only its test target's own variables, test values, never the Project's environment or Secret variables, and never The Office's own environment.
- Nothing from the host is mounted into it but its checkout: no Docker socket, no `identity/`, `engines/` or `repositories/`, no worktree.
- So a test instance of The Office starts empty, with its own Postgres and its own data directory, and holds no real Project, credential or engine.
- **Second layer, `OFFICE_TEST_INSTANCE=true`:** The Office sets it in every test instance, and a service started with it refuses, on the server:
  - pushing a branch or a commit, before each push in Projects' publishing, so its Publish fails in those words;
  - opening, merging and closing a pull request, in Projects where each is asked of the code host;
  - starting or resuming an engine session, and reading an engine's usage windows, in Engine, so no session runs, no model is called and no account is reached.
  - starting an Action, in Actions ([2.15](2.15-actions.md#in-a-test-instance-of-the-office)).
- Each refusal names `OFFICE_TEST_INSTANCE` ("A test instance of The Office (OFFICE_TEST_INSTANCE) doesn't push."), and each is proven by a test.
  - Projects refuses with `TestInstanceRefused`, answered `409` over HTTP; Engine with `EngineRefused`, before a session starts or resumes and before a usage window check.
- `/api/health` answers `{ "database", "testInstance" }`, so the web knows without a sign-in.
- Its UI shows the [Test instance banner](screens/shell.md#test-instance-banner) on every page, Sign in included.

## Connected devices

- Connecting a device ([2.13](2.13-connected-devices.md)) needs a signed-in session in the browser, as every request does ([2.10](2.10-users-and-signing-in.md#what-every-request-needs)); the relay's WebSocket is the signed-in one.
- Over USB, the browser's own device picker asks the user which device to connect, so a page can't reach a device the user didn't pick.
- A device is reachable only from the run environment it is connected to: the Office device helper listens inside the container, and no port is published.
- A Project device is held by one environment at a time and is reached only by the environment holding it ([2.13](2.13-connected-devices.md#one-environment-at-a-time)).
- A Project device's address (its IP address and Port) is never shown to Agents ([2.13](2.13-connected-devices.md#a-projects-device)).
- The helper is mounted read-only, so a command in the run environment can't change it.
- It runs as the checks' user; only its serial mode runs as the container's root, to make the serial path, and it hands the pseudo-terminal to the checks' user (mode 0660), so the Project's commands never need root to reach the board.
- The Project's adb key is kept as Secret variables are, and never sent to the web, logged or put in a Handover note.
- A Project device pairs and connects with that same key, the one The Office keeps for the Project ([2.13](2.13-connected-devices.md#the-adb-key)); no other key is made or kept for it.
- A pairing code for wireless debugging is used once and never kept: it goes only to `adb pair`'s standard input in the run environment, never into a record, a log, a response, a web event, a command line, a variable or a frame to the helper.
- A phone over wireless debugging is reached by adb in the run environment alone, over its own network ([2.13](2.13-connected-devices.md#the-run-environments-network)); no port is published for it.
- The address typed for it is refused when the run environment can't reach a phone there ([2.13](2.13-connected-devices.md#android-phone-over-wireless-debugging)):
  - loopback (`127.0.0.0/8`, `::1`), which reaches the run environment itself;
  - unspecified (`0.0.0.0/8`, `::`);
  - multicast (`224.0.0.0/4`, `ff00::/8`);
  - link-local (`169.254.0.0/16`, `fe80::/10`);
  - an IPv4-mapped IPv6 address (`::ffff:a.b.c.d`), weighed as its IPv4 one.

## Actions

- An Action marked Leaves the workstation ([2.15](2.15-actions.md#leaves-the-workstation)) runs from the base branch only; a start on any other branch, Task or Initiative is refused, naming it.
- Its start has a confirm step naming the Action, the base branch and the short commit it will run.
- The service runs that commit only, and refuses the start when the branch moved since ([2.15](2.15-actions.md#implementation-notes)).
- No Agent starts an Action: no Office tool does ([2.15](2.15-actions.md#who-starts-an-action), [The user's alone](#the-users-alone)), so no Hard switch covers one.
- No later build lets an Agent start an Action that leaves the workstation without a Hard switch of its own.
- `start_workflow` ([2.1.6](2.1.6-board-and-search.md#the-ci-tab), [5.4.1](5.4.1-engine-kinds.md#office-actions)) refuses a Workflow file that a Leaves the workstation Action of the Project starts, naming the Action, so an Agent can't start a release around the Action; the file is refused whatever its inputs, a dry run's among them.
- Work › CI's Start a workflow, by a user, refuses such a file too, pointing to the Action: "<file> is started by the Action <name>, from <Project>'s Actions.", so the base branch and the confirm step can't be gone around.
- Both refuse such a file only while the Project's Actions are switched on.
- While they are switched off, the guard is lifted for everyone: Start a workflow and `start_workflow` start the file as any other ([2.15](2.15-actions.md#the-actions-feature-switch)).
- The Action's own run starts its Workflow past the guard: the Action is the guard.
- A Project command run never gets The Office's own credentials ([2.15](2.15-actions.md#where-a-run-runs)).
- A test instance of The Office refuses every Action start ([Test instances](#test-instances)).

## Build rules

- Runtime decisions (holding, refusing with a reason) are made in hooks: `permissionPrompts: 'none'` skips `canUseTool`, and refuses whatever would prompt, so the Office tools are allowed by rule.
- Path decisions (secrets, protected paths, what lies outside the worktree) are made in the hook, never in path-scoped deny rules.
- Command decisions on what a command reaches are made in the hook too: the container runtime rule refuses a command driving a container runtime ([container-runtime.md](../container-runtime.md)), and beside it the `office-reach-commands` rule refuses one naming The Office's own address or database ([No bypass](#no-bypass)).
- Refusals are logged from the hook's own decisions, `permission_denied` messages and `result.permission_denials`; the `PermissionDenied` hook is not relied on, since it fires for none of them.
- Every shell rule has a PowerShell twin on Windows: a Bash rule does not reach the PowerShell tool (with the engine's default tool set a Bash deny rule alone would turn PowerShell off instead).
- On Linux the Bash rules apply alone.
- The hook alone fences Read, Grep, Glob and LSP to the session's folders (the worktree, or the base branches in chat) and its skills folder, and lets a session read the engine's output files of its own background commands (the engine's temporary folder, then the working folder's name, the session id and `tasks`).
- `permissions.blockReadsOutsideWorkingDirectories` is off: under it the engine also judges every shell command and refuses, past the hook's allow, any it can't show reads only inside (a variable in braces, another folder named), with no approval surface to ask (the engine check's `permissions.read-fence-off`).
- Shell reads outside run wherever the profile allows the command, and are accepted under the threat model.
- Without the fence the engine loads the instruction files (`CLAUDE.md`, `CLAUDE.local.md`, `.claude/CLAUDE.md`, `.claude/rules/`) of every folder above the session's as the Project's own, the user's `~/.claude/CLAUDE.md` among them when the Office data directory is under their home folder, so `claudeMdExcludes` names each of them; a Project's own instructions, inside the worktree, still load.
- The Office ends a session's leftover processes (dev servers, watchers) when its Stage ends.
- `.git`, `.claude` and `.mcp.json` are protected paths: the hook refuses Agents' writes there first (but the Caretaker's with Allow changes on), with a clear reason.
- `.gemini/settings.json`, anywhere in the worktree, is a protected path too, refused the same way on every engine; the rest of `.gemini/` stays writable ([why](5.4.7-gemini-cli-engine.md#gemini-cli-the-repositorys-gemini-settings)).
- The engine's own protection of those paths (it never auto-approves them, and its refusal reads like any other prompt refusal) stays as a backstop; it still refuses a Claude Code engine's Edit and Write there for the Caretaker too, who changes those paths by commands instead.
- The Office's own writes there go through Office code, not Agents.
- `.devcontainer/`, the repository's run environment definition ([5.5](5.5-git-and-isolation.md)), is written only through The Office: the hook refuses Agents' Write and Edit there, with a reason naming `write_run_environment_definition`, the Office tool an Agent Stage, or a Consultation on a Task, of a Role with the Run environment capability gets ([2.2](2.2-people.md)).
- The tool takes devcontainer.json and its compose files whole, checks them as The Office reads the definition, and writes them into the Task's worktree only when it is valid; otherwise it writes nothing and answers every problem found.
- Who else gets the tool, and who never does, is in [the one exception](#the-one-exception-the-run-environment-definition).
- No allow rule lifts the engine's own protection of `.devcontainer/`, which refuses a Write there past a hook `allow` (the engine check's `permissions.devcontainer`) and stays as the backstop on every other session.

## Defaults

### Authority by role

- The settings each preset starts with, at the preset's default ([2.2](2.2-people.md#presets)); "Own · Others'" gives the value on own work and on others' work, and a capped row is under [the trust anchor's cap](#the-trust-anchor).

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

- **Duty tools** (a duty's direct tools, such as the planning tools for Plans) follow the job, not the table: they start at Allowed on the holder's card when the duty is assigned ([2.2](2.2-people.md#duty)).
- **The Caretaker** has its own fixed Authority ([2.2](2.2-people.md#caretaker)).
- The Change Project settings, Run installs and Publish outside the Pipeline rows are the values the Hard switches had; the Planner and the Reviewer keep Never for Change Project settings.
- The Office Manager's Change Roles is Proposal, equal in reach to Ask me ([Authority](#authority)), and it keeps "never alone" on starting, stopping and moving work as Ask me.
- Devops keeps CI re-runs and Workflow starts (Project upkeep, Allowed) and its Pipeline, command, test target and Action Proposals.
- A Role hired from scratch starts every group at Ask me, except Library › Skills at Proposal and `capture_idea` at Allowed, and every capped row at Never; "From scratch" is The Office's default, which a set value overrides.

### A missing authority value

- A Change Project settings value missing from a card reads as Ask me, the Caretaker's as Never, including on a card a rollback saved before the update ran.

### Project setting changes listed

- `GET /api/projects/:id/setting-changes` answers a Project's newest 20 Project setting changes, newest first; every one is kept until the Project is removed.

### What a record made in a Thread links to

- A Task created or an Idea captured in a person's Thread on a Task is found while working on that Task; the tool's `taskId` given as null makes it link to nothing.
- One made in a chat or in a Thread on an Initiative links to nothing.
- A Task created with `create_task` is never part of an Initiative: the shaping Thread's `add_task` (the Add a Task route's action), or joining ([2.1.3](2.1.3-tasks.md#joining-and-leaving-an-initiative)), makes one part of it, since that brings the Initiative's branch and Pipeline.

### Default profiles

|                                                          | Read                                    | Edit                                        | Run commands                                                                             | Web              |
| -------------------------------------------------------- | --------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| Planner (planning on a Task, chat)                       | The worktree; the base branches in chat | No (a language server may run Project code) | Read-only git                                                                            | Search and fetch |
| Developer (Implement, Review & fix)                      | The worktree                            | The worktree                                | Anything in the worktree except git changes; installs and publishing follow the switches | Search and fetch |
| Reviewer (optional independent review)                   | The worktree                            | No                                          | The Project's own commands and read-only git                                             | Search and fetch |
| Caretaker (fixed; with Allow changes on, else as a chat) | Anything but secrets                    | Anything but secrets                        | Anything, every git command included                                                     | Search and fetch |
