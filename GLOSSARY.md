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

**Idea**:
A thought captured quickly and not yet shaped into work; it may become an Initiative or a Task, or be dropped.
_Avoid_: Draft, note, backlog item

**Initiative**:
A multi-task effort toward one outcome, whose Tasks are ordered by dependencies.
_Avoid_: Plan, epic, roadmap, effort

**Task**:
One unit of work in a Project, done when its Definition of Done is met: a published change, an Attachment, or both.
_Avoid_: Job, ticket, issue

**Plan**:
A Task's description of how it will be implemented, produced before implementation starts.
_Avoid_: Using "plan" for an Initiative

**Definition of Done**:
A Task's plain-language statement of what must be true when it is done; the Task ends when it is met.
_Avoid_: Acceptance criteria, DoD (in the UI)

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
The one Office-wide line of Tasks that Start couldn't run yet because a desk or their person's Task limit wasn't free, each with its reason; they start by themselves, oldest first, and hold no desk until they do.
_Avoid_: Backlog (a Task state), waiting list, pending

**Overlap**:
Two Tasks in one Project whose Plans expect to change some of the same files; Start warns of it before a Task joins one in progress.
_Avoid_: Conflict (git's, found at Publish), collision, clash

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
One continuous exchange within a conversation on a Task, an Initiative or a person's chat; a fresh Thread starts without the previous one's context.
_Avoid_: Session, chat (for the record), channel

**Consultation**:
A Thread on a Task in which an Agent asks a Consultant for an answer, or for approval of a call past a Hard switch; the user can read, join or take it over.
_Avoid_: Delegation, escalation (for this), handoff

**Mention**:
A Task, Initiative, Idea or Decision named in a chat message, picked with `@` or pasted as the link to its page; the Agent there is given its record with the message.
_Avoid_: Reference, tag, attachment (an Attachment is added to a record, not named in a message)

**Brief**:
What a new session is given to pick up work: the record of the Task or Initiative, the person's memory when they keep one, the records mentioned in the message it starts on, and the previous Stage's Handover note.
_Avoid_: Prompt, context dump, summary

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

**Notification**:
A signal outside the page the user is on that something waits for them or has happened; it opens that thing and is cleared by handling it, never by reading the Notification itself.
_Avoid_: Alert, inbox item, notice

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

### Agents

**Role**:
A job the user hires for, filled by one named person: its responsibilities, instructions, model, tools and authority.
_Avoid_: Persona, profile, agent type

**Role card**:
Everything that defines a Role: its person's name and title, responsibilities, instructions, model and engine, capabilities (shared memory, chat, Consultant), permission profile, authority, Task limit and Skills.
_Avoid_: Role config, definition, settings

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
A newer pinned version than an installed Skill's, found by The Office's daily check of its Source and shown as "Update available". Devops drafts it as a Proposal; applying it saves the Skill's next version, as an edit or an upload does, and pins it there.
_Avoid_: Upgrade, new release

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
