# The Office

A single-user workspace, run like an office, where AI agents turn ideas into published changes across the user's projects while the user plans, steers and tunes the work. Always written with "The"; formerly called Software Factory.

## Language

### Work

**Project**:
A repository The Office works on, with its own commands and settings.
_Avoid_: Repo (in the UI), workspace

**Project command**:
One of a Project's named commands, beside its install command: a key, fixed once added, by which Pipelines and Agents name it, a name, a Command kind and a command line. Every Project starts with Build, Lint and Test.

**Command kind**:
What a Project command does: build, lint or test. A run of a test command, under any key, gets the test handling: one re-run on failure, the worktree restored, the files it wrote moved out of it.
_Avoid_: Command type

**Mark**:
A Project's short label on a colour, one of four offered or a custom one, shown with its name, and what any picture of the Project falls back to.
_Avoid_: Avatar, initials

**Icon**:
A Project's image, in a light and a dark version, uploaded or copied from its repository, shown in place of its Mark's label and colour wherever the Mark shows, in the version for the palette shown.
_Avoid_: Avatar, thumbnail

**Logo**:
A Project's image, in a light and a dark version, uploaded or copied from its repository, shown at its own proportions, larger than the Mark, on the Project's page and card, in the version for the palette shown.
_Avoid_: Banner

**Install inputs**:
The files of a Project whose change makes a worktree run the install command again, such as a lockfile.
_Avoid_: Dependency files, install files

**Repository URL**:
The https or ssh git URL a Project was added from; The Office clones it into its data directory. A Project added by path has none.
_Avoid_: Remote, clone URL, Git URL (in the UI)

**Repository file browser**:
The window for picking one file committed on a Project's base branch, read a folder at a time from one commit; the caller says which extensions show.
_Avoid_: File picker, repo browser

**Office identity**:
The only credentials The Office's git uses, shared by every Project and separate from the user's own: Sign in with GitHub and the Office ssh key. Other hosts over https are reached anonymously.
_Avoid_: Machine credentials, service account, bot

**Sign in with GitHub**:
The Office's sign-in to GitHub through a GitHub App the user registers and installs once; its user token, kept fresh by The Office and never seen by Agents, fetches, pushes and opens pull requests for every GitHub Project.
_Avoid_: GitHub login, GitHub token, OAuth (in the UI)

**Office ssh key**:
The ssh key The Office generates and keeps for ssh remotes on any host; the user adds its public half to each host.
_Avoid_: Deploy key, SSH identity

**Trusted host**:
An ssh host whose key The Office's ssh accepts: GitHub's from GitHub's published list, any other once the user confirmed its fingerprint.
_Avoid_: Known host, allowed host, verified host

**Unconfirmed host**:
An ssh host an Office git command was refused for because its key isn't confirmed yet; the user compares its fingerprint with the host's own and confirms it, which makes it a Trusted host.
_Avoid_: Waiting host, pending host, unknown host

**Idea**:
A thought captured quickly and not yet shaped into work; it may become an Initiative or a Task, or be dropped.
_Avoid_: Draft, note, backlog item

**Initiative**:
A multi-task effort toward one outcome, whose Tasks are ordered by dependencies.
_Avoid_: Plan, epic, roadmap, effort

**Task**:
One unit of work in a Project, done when its Definition of Done is met: a published change, an Attachment, or both.
_Avoid_: Job, ticket, issue

**Shaping** (a Task state):
The first state of a Task added to an Initiative still being shaped: off the Work board, and it can't be planned or started until Confirm moves it to Backlog. Dropping the Initiative drops it too.
_Avoid_: Draft, on hold, pending

**Description**:
A Task's optional account, in the user's own words, of what they want; it sits above the Plan, and the Planner plans from it and the title.
_Avoid_: Summary, brief, notes, using "description" for the Plan

**Plan**:
How a Task will be implemented, written by the user or with the Planner before implementation starts.
_Avoid_: Using "plan" for an Initiative or for the Description

**Definition of Done**:
A Task's plain-language statement of what must be true when it is done; the Task ends when it is met.
_Avoid_: Acceptance criteria, DoD (in the UI)

**Save** (a Plan or a Definition of Done):
The user keeping their edit of the part. It never confirms: a change leaves the part Not confirmed, and moves a Ready Task back to Planning, or to Backlog when it was never in Planning; the same words change nothing.
_Avoid_: Save and confirm

**Confirm** (a Plan or a Definition of Done):
The user taking the part as it reads, the user's only way to confirm it (Auto mode confirms on their behalf); a part not confirmed yet shows **Not confirmed**, whoever wrote it.
_Avoid_: Proposed (for a part's badge), approve

**Auto mode** (planning a Task):
The choice, made with a switch beside Make a plan, that once the Planner marks the Task planned (`mark_planned`) with no Decision on it open, The Office confirms the Plan, the Definition of Done and the proposed Pipeline on the user's behalf and marks the Task Ready; the last choice is the remembered default, an Office setting, off until first made.
_Avoid_: Autopilot, auto-accept, autonomous planning

**Plan the Initiative**:
The action on an active Initiative's page that opens one planning Thread with the Planner on the Initiative, who plans its Backlog Tasks in dependency order, moving each to Planning as its turn comes (`start_planning`) and writing its parts by its Task id, in auto mode or not; that Thread counts as the planning Thread of each Task planned in it.
_Avoid_: Bulk planning, plan all, batch planning

**Tag**:
A free-form word on a Task, set by the user or the Planner, to find Tasks by.
_Avoid_: Label, category; "tag" for a Mention

**Archive** (a Task or Initiative):
Taking a Done or Dropped Task or Initiative off its board (the Work board, or the Initiatives tab), by the user or automatically once it has been finished for the Archive period.
_Avoid_: Hide, delete, clean up

**Archive period**:
How many days a Done or Dropped Task or Initiative stays on its board, from when it finished or was last restored, before a daily run archives it; set Office-wide in Settings › Office limits, 30 until changed.
_Avoid_: Retention, expiry, archive delay

**Archived**:
A mark on a Done or Dropped Task or Initiative that is archived; not a state, so it stays Done or Dropped.
_Avoid_: Archived as a Task or Initiative state, closed

**Restore** (an archived Task or Initiative):
Returning an archived Task or Initiative to its board in the state it had; a dropped Idea has a Restore of its own.
_Avoid_: Unarchive, reopen

**Move** (a Task):
Putting a Task in another Project; not a change of state, though it can return the Task to Backlog.
_Avoid_: Transfer, migrate, reassign

**Saved view**:
A named set of the Work board's filters (search, priority, Initiative, Blocked), shown under "Views"; it never holds the Project filter.
_Avoid_: Filter preset, query, perspective

**Project filter**:
The top bar's choice of which Projects every surface shows; Office-wide numbers, the rail badge, the fire alarm and Notifications ignore it.
_Avoid_: Scope, workspace switcher, Project picker (for the choice itself)

**Queue**:
The one Office-wide line of Tasks that Start couldn't run yet because a blocker wasn't Done or Dropped yet, a desk, their Project limit or their person's Task limit wasn't free or a Window cap or Daily cap would be passed, each with its reason; they start by themselves, oldest first, and hold no desk until they do. They stay Ready, and the board shows them in a Queued column of their own.
_Avoid_: Backlog (a Task state), waiting list, pending

**Overlap**:
Two Tasks in one Project whose Plans expect to change some of the same files; Start warns of it before a Task joins one in progress.
_Avoid_: Conflict (git's, found at Publish), collision, clash

**Start Ready Tasks**:
The action on an active Initiative's page that runs Start on each of its Ready Tasks, a blocker inside the Initiative first and the board's order otherwise, every rule of Start applying; a Task that overlaps one already started is queued behind it without asking, one refused doesn't stop the rest, and the page then says what started, what was queued and what was refused.
_Avoid_: Start all, bulk start, launch the Initiative

**Usage estimate**:
What a Ready Task's whole Pipeline is expected to use on each engine it uses, in the measures ticked in Settings › Office limits (tokens, the 5-hour window, the 7-day window, cost); from done Tasks of the same Project and Pipeline, else the Planner's estimate in the Plan.
_Avoid_: Budget (a Stage's token limit), forecast, quota estimate

**Window cap**:
A Claude Code engine's cap, one for each window, on how much of the 5-hour or the 7-day window a Start may bring the window to, with its Usage estimate, before it waits in the Queue for the reset.
_Avoid_: Quota gate, budget, limit (the Office-wide limit, Project limits and Task limits count started Tasks), threshold

**Daily cap**:
An engine's cap on the tokens, or the dollars, used on it in one day; a Start that would pass it, with its Usage estimate, waits in the Queue until midnight. Off unless set.
_Avoid_: Budget, quota, daily limit

**Model price**:
What a model costs per million tokens of each kind (input, output, cache writes, cache reads), set in Settings › Engines: one per Claude model, shared by every Claude Code engine, and one per engine and model on the OpenAI-compatible API; every cost in The Office is priced by it.
_Avoid_: Rate, pricing, price table

**Reading source**:
Where a reading of the usage windows came from: the account's usage endpoint, or the rate-limit headers of the engine's last model reply. The two round differently, so the window % per token a Usage estimate uses is learnt only from successive readings of one source; a reading whose source is unknown is paired with none.
_Avoid_: Full answer, short answer, kind

**Workstation figure**:
The status strip's CPU and memory figures for the computer The Office runs on: the CPU use now and its logical cores, opening a panel with the CPU, the memory, The Office's own memory and the uptime; refreshed every 2 s while the tab is visible.
_Avoid_: System monitor, host stats, machine load

**Files to change**:
The files and folders a Plan expects to change, written by the Planner with the Plan and confirmed with it; a folder covers the files under it. Start weighs an Overlap on them.
_Avoid_: Touch set, affected files, scope

**Resolve**:
The Stage The Office adds before Publish when the Task's branch conflicts with the base: The Office merges the base in, the Task's person edits the conflicted files, then the Project's Test runs, and a Gate if the Publish Stage asks for a review, before Publish again.
_Avoid_: Rebase, merge fix, conflict Stage

**Attachment**:
Anything attached to an Idea, an Initiative or a Task by the user or an Agent, such as a document, a screenshot, a file or a link; it can be a Task's result.
_Avoid_: Artifact, asset, output

**Text file**:
A file Attachment whose bytes are text, a document among them; Agents read it by its lines and it opens in the document window. Its kind stays what it is: a CSS file is a file that is a text file.
_Avoid_: Plain-text file, source file, text document

**Decision**:
A question an Agent puts to the user and waits on before continuing. Asked in an Initiative's planning Thread, it names one of the Initiative's Tasks.
_Avoid_: Approval, prompt, question (as a noun for the record)

**Thread**:
One continuous exchange within a conversation on a Task, an Initiative or a person's chat; a fresh Thread starts without the previous one's context. On a Task, each person has one Thread of their own, in their tab, and each Stage run has its Stage Thread, shown in the Stage history.
_Avoid_: Session, chat (for the record), channel

**Chat drawer**:
The side panel on the right edge where the user talks with a person in their chat, opened from any page; it lists direct chats only. Not the conversation's drawer, which is a Task's or an Initiative's own conversation folded on a narrow page.
_Avoid_: Chat modal, chat window, chat panel

**Turn**:
One author's neighbouring messages in a Thread, shown together under one name.
_Avoid_: Bubble

**Consultation**:
A Thread on a Task in which an Agent asks a Consultant for an answer, or for approval of a call past a Hard switch; the user can read it or take it over, but not join it.
_Avoid_: Delegation, escalation (for this), handoff

**Mention**:
A Task, Initiative, Idea or Decision named in a chat message or in a Task's Description, picked with `@` or pasted as the link to its page; in a chat message the Agent there is given its record with the message, and in a Description the link carries its id for an Agent to read it.
_Avoid_: Reference, tag, attachment (an Attachment is added to a record, not named in a message)

**Open page**:
The Task, Initiative, Idea, person or Project whose page is open beside the chat drawer as the user sends a message there; the person answering is given its record with the message, unless the user leaves it out of that message.
_Avoid_: Current page, page context, focus, selection

**Brief**:
What a new session is given to pick up work: the record of the Task or Initiative, the person's memory when they keep one, the records mentioned in the message it starts on and its Open page's, and the previous Stage's Handover note.
_Avoid_: Prompt, context dump, summary

**Details**:
The switch on a conversation that shows or hides tool activity and the context lines with their Brief.
_Avoid_: Verbose, debug, show tools

**Handover note**:
A few lines written for whoever continues: by an Agent at the end of a Stage (where it is, what is left, what to watch), or by the Office Manager when it points the user to someone else.
_Avoid_: Summary, transcript, report

**Memory**:
What a person with the Shared memory capability keeps across Tasks and conversations: a list of Memory notes, only ever added to, read into the Brief of each new session. Shown on the Memory tab of the person's page.
_Avoid_: Knowledge base, history, context

**Memory note**:
One short entry in a Memory, with its date and where it came from (an Agent's Thread, or the user). Written by an Agent with the `remember` tool or by the user; deleted one at a time or all together, never edited.
_Avoid_: Fact, memo, entry (note alone means nothing: an Idea is not a note)

**Fire alarm**:
The one Office-wide switch that pauses all automated work until the user gives the all clear; talking to Agents stays possible while it is on.
_Avoid_: Emergency stop, kill switch, global pause

**Sound the alarm**:
The user's act that turns the Fire alarm on: every Stage, waiting Task and Consultation stops at its next safe point.
_Avoid_: Trigger, panic, stop all

**All clear**:
The user's act that turns the Fire alarm off, after seeing on Now what will resume, how and at what cost, with Resume, Hold or Drop per Task.
_Avoid_: Lift, reset, unpause

**Office update**:
Moving The Office itself to the newest commit of its own checkout's upstream: found by its daily check, scheduled by the user's Update in Settings › Updates, held until nothing is busy, then installed by the launcher as The Office restarts. Not a Skill's Update.
_Avoid_: Upgrade, self-update, release, deploy

**Launcher**:
What `npm start` runs: it starts The Office's service, and when the service stops for an Office update, installs the update and starts it again.
_Avoid_: Supervisor, wrapper, runner

**Notification**:
A signal outside the page the user is on that something waits for them or has happened; it opens that thing and is cleared by handling it, never by reading the Notification itself.
_Avoid_: Alert, inbox item, notice

**Quiet hours**:
A daily window, off until the user sets it, in which no Notification goes to the desktop or the phone except "an Agent engine down"; one summary comes when it ends.
_Avoid_: Do not disturb, silent mode, mute

**Pipeline**:
A named, ordered set of Stages that a Task's work follows.
_Avoid_: Workflow, flow, process (a Process is a session's background command)

**Pipeline library**:
The Office-wide set of Pipelines that Projects and Tasks choose from, with the Stage templates beside them, edited in Settings or changed by Devops' Proposals.
_Avoid_: Pipeline catalog, Pipeline templates

**Onboarding**:
Making a Project build and test in a fresh worktree on the workstation, done by Devops in the Project's Onboard Task.
_Avoid_: Setup, initialization, provisioning

**Run environment**:
A Project's containers, defined by its repository's `.devcontainer/` (devcontainer.json and the compose files it names), that its checks run in when the Project's Run environment setting is On. The setting is "Not decided yet" until the user picks On or Off, the checks running on the workstation meanwhile, and On needs a valid definition on the base branch. "Set up run environment" turns it On at once when there is one, else adds the Project's "Set up the run environment" Task, in which Devops writes it with The Office's `write_run_environment_definition`, which checks it first, and its Done turns the setting On.
_Avoid_: dev container, sandbox

**CPU limit**:
The CPUs each service of a run environment may use, set Office-wide in Settings › Office limits: Automatic (the default) follows this computer's cores, the checks' service getting all but 2 and every other service 2; Fixed gives every service one number. A change applies from each run environment's next start. Beside it in the same card, Settings edits Memory per service and Processes per service, which apply the same way.
_Avoid_: CPU cap, CPU quota, cpus

**Run environments at once**:
How many run environments may be running together across The Office, 2 by default, set in Settings › Office limits' Run environments card. A Stage past it shows "Waiting for a run environment" until one stops; raising it lets a waiting Stage start at once, lowering it stops none.
_Avoid_: run environment slots, concurrency limit

**Stage**:
One step of a Pipeline: work by an Agent in a Role, a Project command run without an Agent, or a Gate.
_Avoid_: Phase, step (as a noun for the record)

**Stage template**:
A Stage kept in the Pipeline library to add to a Pipeline or a Task's Stages as a copy; made from scratch or saved from a Stage, the built-in Stages among them.
_Avoid_: Stage preset, Stage blueprint

**Gate**:
A Stage at which the Task waits for the user to look at the work so far and let it continue.
_Avoid_: Checkpoint, approval step

**Pipeline rail**:
The full-width line on the Task page that shows every Stage of the Task and where the Task is.
_Avoid_: Timeline, progress bar, stepper

**Stage history**:
The window that opens when a Stage is selected on the Pipeline rail: the Pipeline in small to move between Stages, the Stage's runs as a list, and the run picked with its Summary (outcome and Handover note) and its Thread, or a Project command's output.
_Avoid_: Run log, Stage details

**Reported met**:
A Definition of Done statement that the last Agent to report on it says is met; an Agent's word, which nobody verified, and a later run can take it back.
_Avoid_: Checked, verified, done

**Out of reach**:
A Definition of Done statement the last Agent to report says it can't verify where it works, with why, such as a live check on the user's workstation; the user checks it, as another round of the Stage can't.
_Avoid_: Unverifiable, manual check, skipped

**Before Ready**:
The read-only card on a Task page that lists what Ready needs (Plan confirmed, Definition of Done confirmed, Pipeline chosen, No Decision open), each unmet line linking to where it is settled; it takes Needs you's place when nothing waits, and is not part of Needs you.
_Avoid_: To confirm, checklist

### Agents

**Role**:
A job the user hires for, filled by one named person: its responsibilities, instructions, tools and authority.
_Avoid_: Persona, profile, agent type

**Role card**:
Everything that defines a Role: its person's name and title, responsibilities, instructions, effort, Role override, capabilities (shared memory, chat, Consultant, Run environment: in an Agent Stage, writing a Project's run environment definition through The Office's `write_run_environment_definition`), permission profile, authority, Task limit and Skills.
_Avoid_: Role config, definition, settings

**Avatar**:
A person's own picture, uploaded on their Overview tab, which shows in place of their initials wherever they are drawn. It is not part of the Role card: changing it adds no card version, and Agents never see it.
_Avoid_: Profile picture, photo

**Office instructions**:
The one text of general guidelines the user writes in Settings, which every person's session gets with their Role's instructions; a Role's instructions and a Project's `CLAUDE.md` win where they disagree.
_Avoid_: Global instructions, guidelines, house rules, agents.md

**Engine**:
What a session runs on, listed by the user in Settings › Engines with a name and a default model: a Claude Code account, signed in in its own folder, with the `-p` fallback as its switch, or an API endpoint of the OpenAI-compatible API. Caps and usage are kept per Engine. The one a session runs on comes from the cascade of the Office default, the Project default and the Role overrides.
_Avoid_: Provider, backend, account (as the thing picked), engine id

**Office default**:
The Engine and model every session runs on unless a more specific level names another; set in Settings › Engines.
_Avoid_: Global engine, default engine setting

**Project default**:
The Engine and model a Project's sessions run on, set in the Project page's Engine block; with "Use for every Role" it applies to every Role in the Project over their Office-wide Role overrides.
_Avoid_: Project engine, project override

**Role override**:
An Engine and model a Role runs on in place of the default: Office-wide on the Role card, or a Project's own in the Project page's Engine block, which wins in that Project. With none, the Role card reads "Office default".
_Avoid_: Role engine, model override, Stage model

**OpenAI-compatible API**:
The API that an Engine of this kind works on, a model served on it such as a local LLM; The Office runs the agent loop itself.
_Avoid_: API engine, local engine, LLM provider

**API endpoint**:
A server on the OpenAI-compatible API, added in Settings → Engines as an Engine of its own: its name, base URL, key and models.
_Avoid_: Provider, backend, model server, connection

**Search endpoint**:
The web search service set Office-wide that WebSearch goes through for the OpenAI-compatible API (SearXNG).
_Avoid_: Search provider, search engine

**Agent**:
A Role's person at work on one thing, a Task or a conversation; the same person can be at work on several things at once.
_Avoid_: Bot, worker, assistant, instance

**Sub-agent**:
An agent that an Agent's session starts to do part of its work in a context of its own, such as a search or a review, and that reports back to whoever started it; Running, then Finished, Failed or Stopped, and viewable, read-only, for the rest of the session. Only Claude Code engines start them.
_Avoid_: Subagent, child agent, helper, task (Claude Code's own word for it)

**Process**:
A command an Agent's session, or one of its Sub-agents, runs in the background, such as a dev server or a long test run, with its output; Running, then Finished, Failed or Stopped, and viewable, read-only, for the rest of the session. Not a Pipeline, and not one of the operating system's processes that Processes per service counts.
_Avoid_: Background task, shell, job, background command (in the UI)

**Consultant**:
A person whom other Agents may consult on a Task.
_Avoid_: Expert, advisor, Staff

**Task limit**:
How many of a person's Agents may work Stages at once; "none" means the person only talks and never works a Stage.
_Avoid_: Capacity, slots, concurrency

**Project limit**:
How many of a Project's Tasks may be started at once (In progress, Waiting on you or Paused), 1 unless the user raises it on the Project page; only the Project's own Tasks count against it.
_Avoid_: Project capacity, parallelism, concurrency

**Hard switch**:
One of the few actions on a Role card that need someone's say whatever the Agent thinks (run installs, publish outside the Pipeline, change Roles), set to Allowed, Consult a person, Ask me or Never.
_Avoid_: Permission flag, guard, gate (for this)

**Skill**:
A packaged set of instructions and files from The Office's library that a person may use when the work calls for it.
_Avoid_: Plugin, tool, ability

**Skill use**:
One Skill tool call in a session, on any engine, counted for the Skill that session got from The Office under that name; each Skill shows its uses in the last 7 days wherever Skills are listed.
_Avoid_: Invocation, run, call count

**Source**:
The git repository an installed Skill comes from (`owner/repo` on GitHub, or a git URL), with the Skill's folder in it. Written and uploaded Skills have none.
_Avoid_: Origin, registry, upstream

**Pinned version**:
The release of its Source an installed Skill is held at: the Source's newest tag when it was installed or updated, or its newest commit when the Source has no tags. It moves only when the user applies an update Proposal.
_Avoid_: Latest, tracked version

**Update**:
A newer pinned version than an installed Skill's, found by The Office's daily check of its Source and shown as "Update available". Devops drafts it as a Proposal; applying it saves the Skill's next version, as an edit or an upload does, and pins it there. Not an Office update.
_Avoid_: Upgrade, new release

**MCP server**:
A server from The Office's library, a local command or a remote URL, whose tools a person may use when their Role card assigns it; off until the user reviews it.
_Avoid_: Integration, connector, plugin, tool server

**Language server**:
A program installed on the workstation that answers the LSP tool for the files of its language. Every session on a Claude Code engine gets those found as it starts, whatever its Role; unlike an MCP server, no Role card assigns one.
_Avoid_: LSP server, code intelligence

**Server value**:
A named value an MCP server needs (an environment variable or a header), plain or secret, set Office-wide and overridden on a Project's page.
_Avoid_: Variable, parameter, credential, config

**Secret variable**:
A variable in a Project's environment whose value is never shown again once it is saved, and shows as `[secret NAME]` wherever it would appear in output. Its commands and Agents get it as they get the others.
_Avoid_: Secret, credential, hidden variable, masked variable

**Office Manager**:
The person the user goes to by default: it drafts Roles for the user to confirm, captures Ideas, answers for the state of The Office and redirects the user to whoever is responsible.
_Avoid_: Receptionist, HR, router

**Link card**:
What the Office Manager posts in a chat to point the user to whoever is responsible: that person (or the Task) with a Handover note the user can edit or drop before opening the thread. It never relays.
_Avoid_: Redirect message, referral, forward

**Office status**:
The Office Manager's read-only, Office-wide view in a chat: who is on what, what waits on the user and what is paused.
_Avoid_: Dashboard, report, overview

**Proposal**:
A new or changed Role card or Office setting drafted by the Office Manager, which takes effect only when the user confirms it.
_Avoid_: Suggestion, draft, request

**Caretaker**:
The built-in person who looks after the workstation and The Office: always present, never hired or let go, with a chat only.
_Avoid_: Admin, sysadmin, system agent

**Allow changes**:
A Caretaker Thread's switch, confirmed by the user, under which the Caretaker can do everything on the workstation but touch secrets; kept per Thread, off in a new one.
_Avoid_: Admin mode, unlock, elevated mode

**Palette**:
The set of colours the app is shown in, picked in Settings › Appearance or from the rail's Theme menu and kept in this browser: Light, Dark, Graphite or Paper, or following the system. Graphite counts as dark and Paper as light. It changes colours only, never layout.
_Avoid_: Theme, mode, colour scheme

**Density**:
How much air the app is shown with, picked in Settings › Appearance or from the rail's Theme menu and kept in this browser: Compact, Comfortable or Relaxed. It changes spacing, control heights and text sizes only, never colours.
_Avoid_: Size, zoom, scale
