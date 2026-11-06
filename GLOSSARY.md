# The Office

A single-user workspace, run like an office, where AI agents turn ideas into published changes across the user's projects while the user plans, steers and tunes the work. Always written with "The"; formerly called Software Factory.

## Language

### Work

**Project**:
A repository The Office works on, with its own commands and settings.
_Avoid_: Repo (in the UI), workspace

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
The user keeping their edit of the part. It never confirms: a change leaves the part Not confirmed, and moves a Ready Task to Backlog; the same words change nothing.
_Avoid_: Save and confirm

**Confirm** (a Plan or a Definition of Done):
The user taking the part as it reads, the only way it becomes confirmed; a part not confirmed yet shows **Not confirmed**, whoever wrote it.
_Avoid_: Proposed (for a part's badge), approve

**Tag**:
A free-form word on a Task, set by the user or the Planner, to find and filter Tasks by.
_Avoid_: Label, category; "tag" for a Mention

**Saved view**:
A named set of the Work board's filters (search, priority, Tags, Initiative, Blocked), shown under "Views"; it never holds the Project filter.
_Avoid_: Filter preset, query, perspective

**Project filter**:
The top bar's choice of which Projects every surface shows; Office-wide numbers, the rail badge, the fire alarm and Notifications ignore it.
_Avoid_: Scope, workspace switcher, Project picker (for the choice itself)

**Queue**:
The one Office-wide line of Tasks that Start couldn't run yet because a desk or their person's Task limit wasn't free or a Window cap or Daily cap would be passed, each with its reason; they start by themselves, oldest first, and hold no desk until they do.
_Avoid_: Backlog (a Task state), waiting list, pending

**Overlap**:
Two Tasks in one Project whose Plans expect to change some of the same files; Start warns of it before a Task joins one in progress.
_Avoid_: Conflict (git's, found at Publish), collision, clash

**Usage estimate**:
What a Ready Task's whole Pipeline is expected to use on each engine it uses, in the measures ticked in Settings › Office limits (tokens, the 5-hour window, the 7-day window, cost); from done Tasks of the same Project and Pipeline, else the Planner's estimate in the Plan.
_Avoid_: Budget (a Stage's token limit), forecast, quota estimate

**Window cap**:
A Claude Code engine's cap, one for each window, on how much of the 5-hour or the 7-day window a Start may bring the window to, with its Usage estimate, before it waits in the Queue for the reset.
_Avoid_: Quota gate, budget, limit (the Office-wide limit and Task limits count desks), threshold

**Daily cap**:
An engine's cap on the tokens, or the dollars, used on it in one day; a Start that would pass it, with its Usage estimate, waits in the Queue until midnight. Off unless set.
_Avoid_: Budget, quota, daily limit

**Model price**:
What a model costs per million tokens of each kind (input, output, cache writes, cache reads), set in Settings › Engines: one per Claude model, shared by every Claude Code engine, and one per engine and model on the OpenAI-compatible API; every cost in The Office is priced by it.
_Avoid_: Rate, pricing, price table

**Reading source**:
Where a reading of the usage windows came from: the account's usage endpoint, or the rate-limit headers of the engine's last model reply. The two round differently, so the window % per token a Usage estimate uses is learnt only from successive readings of one source; a reading whose source is unknown is paired with none.
_Avoid_: Full answer, short answer, kind

**Files to change**:
The files and folders a Plan expects to change, written by the Planner with the Plan and confirmed with it; a folder covers the files under it. Start weighs an Overlap on them.
_Avoid_: Touch set, affected files, scope

**Resolve**:
The Stage The Office adds before Publish when the Task's branch conflicts with the base: The Office merges the base in, the Task's person edits the conflicted files, then the Project's Test and a Gate run before Publish again.
_Avoid_: Rebase, merge fix, conflict Stage

**Attachment**:
Anything attached to an Idea, an Initiative or a Task by the user or an Agent, such as a document, a screenshot, a file or a link; it can be a Task's result.
_Avoid_: Artifact, asset, output

**Decision**:
A question an Agent puts to the user and waits on before continuing.
_Avoid_: Approval, prompt, question (as a noun for the record)

**Thread**:
One continuous exchange within a conversation on a Task, an Initiative or a person's chat; a fresh Thread starts without the previous one's context. On a Task, each person has one Thread of their own, in their tab, and each Stage run has its Stage Thread, shown in the Stage history.
_Avoid_: Session, chat (for the record), channel

**Turn**:
One author's neighbouring messages in a Thread, shown together under one name.
_Avoid_: Bubble

**Consultation**:
A Thread on a Task in which an Agent asks a Consultant for an answer, or for approval of a call past a Hard switch; the user can read it or take it over, but not join it.
_Avoid_: Delegation, escalation (for this), handoff

**Mention**:
A Task, Initiative, Idea or Decision named in a chat message, picked with `@` or pasted as the link to its page; the Agent there is given its record with the message.
_Avoid_: Reference, tag, attachment (an Attachment is added to a record, not named in a message)

**Brief**:
What a new session is given to pick up work: the record of the Task or Initiative, the person's memory when they keep one, the records mentioned in the message it starts on, and the previous Stage's Handover note.
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
_Avoid_: Workflow, flow, process

**Pipeline library**:
The Office-wide set of Pipelines that Projects and Tasks choose from, edited in Settings or changed by Devops' Proposals.
_Avoid_: Pipeline catalog, templates

**Onboarding**:
Making a Project build and test in a fresh worktree on the workstation, done by Devops in the Project's Onboard Task.
_Avoid_: Setup, initialization, provisioning

**Stage**:
One step of a Pipeline: work by an Agent in a Role, a Project command run without an Agent, or a Gate.
_Avoid_: Phase, step (as a noun for the record)

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

**Before Ready**:
The read-only card on a Task page that lists what Ready needs (Plan confirmed, Definition of Done confirmed, Pipeline chosen, No Decision open), each unmet line linking to where it is settled; it takes Needs you's place when nothing waits, and is not part of Needs you.
_Avoid_: To confirm, checklist

### Agents

**Role**:
A job the user hires for, filled by one named person: its responsibilities, instructions, tools and authority.
_Avoid_: Persona, profile, agent type

**Role card**:
Everything that defines a Role: its person's name and title, responsibilities, instructions, effort, Role override, capabilities (shared memory, chat, Consultant), permission profile, authority, Task limit and Skills.
_Avoid_: Role config, definition, settings

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

**Consultant**:
A person whom other Agents may consult on a Task.
_Avoid_: Expert, advisor, Staff

**Task limit**:
How many of a person's Agents may work Stages at once; "none" means the person only talks and never works a Stage.
_Avoid_: Capacity, slots, concurrency

**Hard switch**:
One of the few actions on a Role card that need someone's say whatever the Agent thinks (run installs, publish outside the Pipeline, change Roles), set to Allowed, Consult a person, Ask me or Never.
_Avoid_: Permission flag, guard, gate (for this)

**Skill**:
A packaged set of instructions and files from The Office's library that a person may use when the work calls for it.
_Avoid_: Plugin, tool, ability

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

**Server value**:
A named value an MCP server needs (an environment variable or a header), plain or secret, set Office-wide and overridden on a Project's page.
_Avoid_: Variable, parameter, credential, config

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
