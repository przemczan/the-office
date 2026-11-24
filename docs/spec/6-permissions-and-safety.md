# 6 Permissions and safety

Covers: threat models, stored hashes, the two layers, language servers, Hard switches, Project settings by Agents, MCP tools, refusals, default profiles, what a record made in a Thread links to, reading records, a person's Office tools, Consultations' permissions and their one exception (the run environment definition), chats, the Caretaker with Allow changes on, secrets, Secret variables, test instances, Connected devices and Project devices, Actions, build rules.

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

- **Office rules in code,** which no profile loosens: Agents never change git (read-only `status`, `diff`, `log`, `show` only, every Stage; the one exception is the Caretaker with Allow changes on); the HEAD and branch check; worktree restore after tests; the enforced Hard switches; the secrets refusal; one `PreToolUse` hook that sees every call the engine's own input validation lets through, before any rule decides.
- The Office sets no path-scoped deny rule, which would refuse before the hook; validation refusals show only in `result.permission_denials` and are logged from there.
- **A permission profile as data on the Role card:** read, edit, run, web; edited on the Role card.
- A Stage may narrow the profile, and which of the Project's commands it runs ([2.3.1](2.3.1-stages.md)), never widen it.

## Language servers run Project code

- They run outside the hook.
- An LSP call is judged as a read of its file, so each profile's read fence covers it, but the server it starts runs on its own.
- Reading a Project may run its Gradle build scripts or tsconfig plugins, in read-only sessions too (a Planner's Thread, a chat).
- The hook sees the LSP call, never what the server does.
- The threat model accepts this.

## Hard switches

- The values are in [Defaults](#hard-switches-by-role).
- They are the presets' values, and Consult names a Role key, not a duty: a Role hired from a preset keeps them whoever holds which duty.
- A Hard switch may consult any hired Role, a preset's or one hired from scratch ([2.2](2.2-people.md#defaults), "Who holds a duty").
- **Enforced by The Office:** change Roles (an Office tool), change Project settings (Office tools, [below](#project-settings-by-agents)) and git.
- **Followed by the Agent:** run installs and publish outside the Pipeline.
  - Run installs is also enforced on one Office tool, `run_environment_check`, which installs ([5.5](5.5-git-and-isolation.md#the-environment-check-tool)).
- The Office stays agnostic of each Project's stack, so the brief states the followed ones in plain words ("Before you install anything that changes the machine outside the worktree, consult Devops; adding or updating the Project's own dependencies is a code change") and the Agent asks through the consult tool first.
- The Role card marks which are enforced and which are followed.
- A held call waits on a Consultation (Consult _person_) or a Decision (Ask me).
- Its approval stays a card of its own, one question answered Allow once or Deny (or Pass on, by a Consultant), never a question in a Decision's form, so it has no comments and no Ask me again.
- Approvals by colleagues show on the Task, in the Stage log and as one line in Since you left; never a Notification.
- A Decision never grants "always"; widening permissions is a Role card change.

## Project settings by Agents

- **Change Project settings** holds one Office tool, `change_project_settings`, which changes a Project's everyday settings by the Project page's rules, in optional sections, at least one per call:
  - environment variables: plain variables, Variables to remove and Folders in front of PATH; Secret variables are refused and kept as they are;
  - install and Install inputs;
  - commands: add, change by key, remove; Before and After publishing are refused;
  - test targets: add, change by key or remove; Secret variables by name only, a value already set kept;
  - Actions: add, change by key or remove; one marked Leaves the workstation is refused, pointing to `propose_actions`;
  - Run environment: On or Off, with no check of the base branch's `.devcontainer/` ([2.3.1](2.3.1-stages.md#script-stages-in-the-run-environment)).
- The sections apply in that order, Run environment last, each through the Projects method and Project setting change the Project page's save uses; a section refused leaves the ones before it applied, and the answer names them.
- Every refusal that needs no section applied is made before the call is held, so no approval is spent on a call refused up front.
- **The ruling:** one call is one held call: Allowed applies it at once with no card; Consult _person_ and Ask me hold it on one approval card listing every change, Secret variables by name only ([Hard switches](#hard-switches)); Never refuses.
- After Allow once, the Agent repeats the same call, with the same input, which then runs once; the input is compared in a canonical form, so the order of its fields doesn't count.
- **Who gets it:** an Agent Stage's session and a Consultation on a Task, unless the switch is Never; a chat, a Planning Thread and a person's Thread on a Task never do.
- A Consultation opens no approval of its own, so there only Allowed changes a setting; a call held by Consult or Ask me is refused.
- **The user's alone,** by Proposal or on the Project page: Secret variables' values, the Publishing mode, Before and After publishing, Delete branches once merged, GitHub issues write-back, Server values, the Engine, Actions that leave the workstation, Project Pipelines and the Default Pipeline.
- The Proposal tools (`propose_project_commands`, `propose_test_targets`, `propose_actions`) stay, for those settings and for a person whose switch is Never.
- **The record:** every change of a Project's commands, test targets, Actions, environment or Run environment is kept as a Project setting change, in the same transaction as the change, by the Project page's saves, an applied Proposal and `change_project_settings` alike.
  - It holds the Project, the setting, a short summary naming what changed by name only (never a Secret variable's value), who made it (a user; a Proposal a user applied; a person by Role, name and title, with the Task) and when.
  - The "Set up the run environment" Task's Done turning Run environment On ([2.1.3](2.1.3-tasks.md#setting-up-the-run-environment)) records nothing.
  - It is kept with the Project and removed with it.
  - `GET /api/projects/:id/setting-changes` answers the newest ([Defaults](#project-setting-changes-listed)), which the Project page's Recent activity lists ([project-page.md](screens/project-page.md#recent-activity-tile)).

## MCP tools

- Each tool of a Role's MCP servers ([5.4](5.4-the-engine.md#defaults)) has its own setting in the Role card's permission profile.
- It is set like a Hard switch to Allowed, Consult a person, Ask me or Never.
- It starts at Consult the holder of Default Consultant for MCP tool hard switches, judged when the call is held, the user being asked while nobody holds it.
- A Stage may narrow it, never widen it.
- A held call waits as a Hard switch's does.
- Enforced by The Office: the hook judges every MCP tool call.

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
- Only their Role card and the duties they hold limit the set ([2.2](2.2-people.md#office-manager)).
- Everyone:
  - reads every record and Attachment, a Task's Stage history and the Threads (`read_stage_history`, `read_threads`; [Reading records](#reading-records));
  - answers a Decision waiting on the user for them when the user asks (`answer_decision`), never an approval of a call past a Hard switch or of an MCP tool at Consult or Ask me, which stays the user's own click ([2.4.2](2.4.2-decisions.md));
  - captures an Idea;
  - creates a Task in Backlog, but for the holder of Default person to talk to, who points to whoever plans instead;
  - drafts a skill as a Proposal, and whatever their duties draft as Proposals;
  - calls someone (`consult`) when the user asks, or their authority says to consult that person first ([2.2](2.2-people.md#calls)).
- The holders of Shapes Initiatives and of Default person to talk to create an Initiative (`create_initiative`), in any of those Threads ([2.1.4](2.1.4-initiatives.md#creating-an-initiative)).
- The holder of Default person to talk to also posts Link cards, shows the Office status, and drafts Roles, Office settings and prompt templates as Proposals.
- The Caretaker also drafts the set-up of The Office, and changes to the Office settings, Role cards, Prompt templates and Pipelines, as Proposals ([2.2](2.2-people.md#caretaker)).
- None of these changes a file: a record and a Proposal aren't file changes, so a read-only Thread stays read-only with them.
- No Thread gains file edits or changing commands from them; the Caretaker's [Allow changes](#the-caretaker-with-allow-changes-on) stays the one exception.
- A card the tools post (an Idea's card, a Link card, the Office status) is logged in whichever Thread the user talks in, never in a Stage's Thread.
- A Task created or an Idea captured in a person's Thread on a Task is found while working on that Task, unless the person or the user says otherwise ([2.1.3](2.1.3-tasks.md#found-while-working-on); [Defaults](#what-a-record-made-in-a-thread-links-to)).
- Each kind of Thread adds only its own tools to the set ([2.4.1](2.4.1-threads.md#what-each-thread-adds)); an Agent Stage works with its Stage's tools instead ([2.3.1](2.3.1-stages.md)).

## A Consultation's permissions

- A Consultation works with its callee's own permissions, never the caller's, so a read-only Thread can't get a change made by calling someone.
- Its session is the Consultant's own, built from them alone: their Role card's permission profile, Hard switches and MCP tool settings, and their [Office tools](#a-persons-office-tools) but `answer_decision`, with `answer_consultation` for their answer.
- It opens no Decision of its own, and calls someone only while the chain of calls allows one more ([2.2](2.2-people.md#chains-of-calls)).
- It only reads, as its home does (a Task's worktree on a Task, every Project's base branch in a chat), with no `change_role`, no Allow changes and no write access, so all a call can set up is a record, a Proposal the user applies, a Project setting the Consultant's Change Project settings allows at once ([Project settings by Agents](#project-settings-by-agents)), or the one exception below.
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
- No Agent starts an Action: no Office tool does ([2.15](2.15-actions.md#who-starts-an-action)), so no Hard switch covers one.
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

### Hard switches by role

|                   | Run installs   | Publish outside the Pipeline | Change Roles | Change Project settings |
| ----------------- | -------------- | ---------------------------- | ------------ | ----------------------- |
| Developer         | Consult Devops | Consult CTO                  | Never        | Consult Devops          |
| Reviewer, Planner | Consult Devops | Never                        | Never        | Never                   |
| Devops            | Allowed        | Consult CTO                  | Never        | Allowed                 |
| CTO               | Consult Devops | Ask me                       | Never        | Consult Devops          |
| Office Manager    | Never          | Never                        | Ask me       | Never                   |
| Caretaker (fixed) | Allowed        | Allowed                      | Never        | Never                   |

- A Role hired from scratch starts with Change Project settings at Ask me.
- A card saved before Change Project settings existed is given it by an update (migration 0212), by its Role's key as above, Ask me for any other Role; one still missing it, as a rollback's save leaves it, reads as Ask me, the Caretaker's as Never.

### Project setting changes listed

- `GET /api/projects/:id/setting-changes` answers a Project's newest 20 Project setting changes, newest first; every one is kept until the Project is removed.

### What a record made in a Thread links to

- A Task created or an Idea captured in a person's Thread on a Task is found while working on that Task; the tool's `taskId` given as null makes it link to nothing.
- One made in a chat or in a Thread on an Initiative links to nothing.
- A Task created with `create_task` is never part of an Initiative: the shaping Thread's `add_task`, or joining ([2.1.3](2.1.3-tasks.md#joining-and-leaving-an-initiative)), makes one part of it, since that brings the Initiative's branch and Pipeline.

### Default profiles

|                                                          | Read                                    | Edit                                        | Run commands                                                                             | Web              |
| -------------------------------------------------------- | --------------------------------------- | ------------------------------------------- | ---------------------------------------------------------------------------------------- | ---------------- |
| Planner (planning on a Task, chat)                       | The worktree; the base branches in chat | No (a language server may run Project code) | Read-only git                                                                            | Search and fetch |
| Developer (Implement, Review & fix)                      | The worktree                            | The worktree                                | Anything in the worktree except git changes; installs and publishing follow the switches | Search and fetch |
| Reviewer (optional independent review)                   | The worktree                            | No                                          | The Project's own commands and read-only git                                             | Search and fetch |
| Caretaker (fixed; with Allow changes on, else as a chat) | Anything but secrets                    | Anything but secrets                        | Anything, every git command included                                                     | Search and fetch |
