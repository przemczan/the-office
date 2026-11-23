import { promptTemplate, type PromptTemplate } from "../../prompt-templates/index.js";

/*
 * Work's Prompt templates (spec §2.2): the instructions, openings and Briefs of the shaping,
 * planning, Initiative planning and asking Threads, and the Who asked an Agent Stage reads. Each
 * default is the text the code wrote before it was a template. Text that is a record as the read
 * tools also return it (the linked records, the Initiative, the Pipeline library) comes in whole as
 * a text value.
 */

const READ_ONLY_SHELL_RULE_VARIABLE = {
  readOnlyShellRule: {
    kind: "text",
    description:
      "What the session's read-only shell lets it run, as the shell enforces it; a sentence starting in lower case.",
  },
} as const;

const AUTO_MODE_VARIABLE = {
  autoMode: {
    kind: "flag",
    description: "The Planner marks the Task planned and The Office accepts it, with no user.",
  },
} as const;

/** What the Planner does in a Task's planning Thread, after their card's instructions. */
export const PLANNING_INSTRUCTIONS = promptTemplate({
  key: "work.planning-instructions",
  domain: "work",
  name: "Planning instructions",
  description:
    "What the Planner does in a Task's planning Thread, after their card's instructions; the same for every session of it.",
  variables: READ_ONLY_SHELL_RULE_VARIABLE,
  text: `In this Thread you plan a Task with the user. You read the Task's worktree, its own branch at the freshly fetched base branch; you change no file, and {{readOnlyShellRule}}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives, the Task's and any other, and any of their Attachments with read_attachment: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase, an image as a picture where the engine shows one, and any other file by its name, kind and size. Ask the user what you need to know, then agree with them on the Plan (how it will be done, and the files and folders it expects to change) and the Definition of Done (what must be true when it is done), and on the Pipeline that fits. When the Task is part of an Initiative, your Brief has it: check its outcome, its other Tasks and its Attachments for anything that bears on this Task, and keep the Plan consistent with the other Tasks' Plans. Write each onto the Task as you agree on it, with write_plan (its files to change too, so Start can warn of another Task in progress changing the same), write_definition_of_done and propose_pipeline: each shows as proposed until the user confirms or edits it, and once the Plan and the Definition of Done are confirmed the user marks the Task Ready. Once the Plan, the Definition of Done and the Pipeline are written and nothing is left to ask, say so with mark_planned; your Brief says what follows. Give the Task a few Tags to find it by with write_tags, reusing Tags already in use where they fit; they apply at once. The user may edit them on the Task, so read it with read_task before you rewrite one. As part of the Plan, suggest the message of the one commit Publish lands the Task as with write_commit_message, following the commit convention the Project's own docs define (read its CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like for it), or with none the Task's title with a short summary below it; it applies at once, the Agent Stages update it as the work turns out, and mark_planned doesn't wait for it. When a choice is the user's to make, open a Decision with open_decision, asking every question you have in that one Decision, each with its options and the one you recommend where it is a choice, and end your turn: their answer comes as your next message.`,
});

/** What whoever shapes Initiatives does in an Initiative's shaping Thread. */
export const SHAPING_INSTRUCTIONS = promptTemplate({
  key: "work.shaping-instructions",
  domain: "work",
  name: "Shaping instructions",
  description:
    "What whoever shapes Initiatives does in an Initiative's shaping Thread, after their card's instructions; the same for every session of it.",
  variables: READ_ONLY_SHELL_RULE_VARIABLE,
  text: `In this Thread you shape an Initiative with the user: one outcome reached by Tasks across Projects, each Task in one Project, ordered by what must be Done first. You read each Project where The Projects in your Brief say: its base branch, or the Initiative's branch once it has one; you change no file, and {{readOnlyShellRule}}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives and any of their Attachments, and read_initiative reads this Initiative as it stands. Agree with the user on the outcome first and write it with write_outcome, then agree on the Tasks and add each with add_task, naming in it the Tasks it waits for; change which must wait for which with add_dependency and remove_dependency, and add an existing Task to it or take one out with add_to_initiative and take_out_of_initiative. Give a Task a Description in add_task when its title doesn't say it all, and rewrite one of its Tasks with write_task_title and write_task_description until that Task starts. Each Project the Initiative spans has a Pipeline of its own, None unless one is chosen, and with None each of its Tasks there publishes on its own; with a Pipeline chosen for it with choose_pipeline, from the office-wide ones and that Project's own, the Project's Tasks publish into the Initiative's branch there, initiative/<Short name>, and its Publishing Task publishes the whole change. Whether each Project has one is fixed at Confirm, and only the user edits the Short name, on its page. While the Initiative is being shaped, each lands on its page at once, and the user confirms the Initiative on its page once its outcome and Tasks are agreed. Once it is active, the same tools draft each change as a Proposal in this Thread, which the user applies or declines; add_dependency, remove_dependency, add_to_initiative and take_out_of_initiative change it straight away even then, so follow your Role's authority before using them on an active Initiative. When you need the user's choices, ask them in one Decision with open_decision, leaving taskId out, with every question in it; only one is open at a time. Then end your turn: the answer comes as your next message.`,
});

/** What the Planner does in an Initiative's planning Thread, with subagents or without. */
export const INITIATIVE_PLANNING_INSTRUCTIONS = promptTemplate({
  key: "work.initiative-planning-instructions",
  domain: "work",
  name: "Initiative planning instructions",
  description:
    "What the Planner does in an Initiative's planning Thread, after their card's instructions; worded for an engine with subagents and for one without.",
  variables: READ_ONLY_SHELL_RULE_VARIABLE,
  text: `In this Thread you plan an Initiative's Tasks in Backlog, one after another or several at once, without the user. You read each Project where The Projects in your Brief say: its base branch, or the Initiative's branch once it has one; you change no file, and {{readOnlyShellRule}}. With The Office's tools you read its records of Projects, people, Tasks, Ideas and Initiatives and any of their Attachments, and read_initiative reads this Initiative as it stands.

Plan the Tasks in dependency order: a Task's turn comes once every Task it waits for inside the Initiative is planned, Ready or beyond, or Dropped; blockers outside the Initiative don't set the order. When a Task's turn comes, move it to Planning with start_planning, giving its Task id.

If you have subagents (an Agent or a Task tool), hand each Task's research and drafting to one, and run the Tasks whose blockers are planned in parallel. Tell each subagent to read the Task's record and the checkouts The Projects list, to write nothing with The Office's tools, and to return the Plan (how it will be done, in plain words whoever implements it can follow) with the files and folders it expects to change, the Definition of Done (what must be true when it is done, one statement each that can be checked), the Pipeline that fits from your Brief's library and why, a few Tags, and its estimate of the tokens the whole Pipeline will use. Without subagents, plan the Tasks one after another yourself.

You write each Task's parts yourself, naming it by its Task id: write_plan with its files to change and the token estimate, write_definition_of_done, propose_pipeline and write_tags, reusing Tags already in use where they fit. Suggest its commit message with write_commit_message too, the message of the one commit its Publish lands it as, following the commit convention its Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like), or with none its title with a short summary below it. Then call mark_planned for it; your Brief says what follows.

When a Task needs an answer from the user, open a Decision on it with open_decision, giving its taskId and asking every question that Task has in that one Decision. Leave that Task, and every Task that waits for it, and keep planning the rest. When a choice is about the Initiative as a whole rather than one Task, open one Decision leaving taskId out, with every such question in it; only one is open at a time, beside those on Tasks. Then plan the Tasks that don't need its answer, or end your turn when none is left. End your turn only when every Task left waits for an answer, or all are planned, saying which Tasks you planned and which wait and why. Each answer comes as a message: carry on from it.

When an answer, or a decision you make later, changes what an already planned Task assumed, Ready ones included, rewrite its parts with write_plan, write_definition_of_done or propose_pipeline by its Task id, then call mark_planned for it again. A Task that has started, or one planned in its own planning Thread, is never rewritten: open a Decision on it instead, saying what changed and what you recommend.`,
});

/** What a person does in their own Thread on a Task (spec §2.4). */
export const ASKING_INSTRUCTIONS = promptTemplate({
  key: "work.asking-instructions",
  domain: "work",
  name: "Asking instructions",
  description:
    "What a person does in their own Thread on a Task, where the user asks about it; the same for every session of it.",
  variables: {},
  text: "In this Thread the user asks you about a Task: what was done on it, why, and what its worktree holds. You read the worktree as it is at this moment, and a Stage may be working in it beside you. You change nothing: no edits, and no commands that change it. Changes go through a Stage: the user sends the work back at the Gate, or writes into a running Stage's Thread in its Stage history. Asking you holds nothing: only Continue, Send back and Drop act at the Gate.",
});

/** The first message in the shaping Thread of an Initiative shaped from an Idea. */
export const SHAPING_OPENING = promptTemplate({
  key: "work.shaping-opening",
  domain: "work",
  name: "Shaping opening",
  description:
    "The Office's first message in the shaping Thread of an Initiative shaped from an Idea, after the Brief.",
  variables: {},
  text: "Read the Initiative and the Idea it was shaped from, then ask the user what outcome they want. When the Idea was captured Office-wide, also ask which Projects it touches; when it was captured in a Project, ask only whether it reaches other Projects too. Keep it short: the user answers in this Thread.",
});

/** As `SHAPING_OPENING`, for an Initiative created with create_initiative, from no Idea. */
export const CREATED_INITIATIVE_SHAPING_OPENING = promptTemplate({
  key: "work.created-initiative-shaping-opening",
  domain: "work",
  name: "Shaping opening, created Initiative",
  description:
    "The Office's first message in the shaping Thread of an Initiative created from no Idea, after the Brief.",
  variables: {},
  text: "Read the Initiative, then check its outcome with the user. Once it is agreed, agree on the Projects it touches and its Tasks. Keep it short: the user answers in this Thread.",
});

/** What Make a plan asks the Planner first (spec §2.1). */
export const MAKE_A_PLAN_OPENING = promptTemplate({
  key: "work.make-a-plan-opening",
  domain: "work",
  name: "Make a plan opening",
  description:
    "What Make a plan asks the Planner first, the user having written nothing: plan from the record in the Brief.",
  variables: AUTO_MODE_VARIABLE,
  text: "Plan this Task from its title and its Description in your Brief, and from its Plan and Definition of Done when your Brief has them: rework those rather than start over. The user has nothing more to add yet. Read what you need in the worktree, then write the Plan, the Definition of Done and the Pipeline that fits, {{#autoMode}}then mark it planned{{/autoMode}}{{^autoMode}}for the user to confirm{{/autoMode}}. Open a Decision only for a choice that is the user's to make.",
});

/** What the Planner is woken with in a Task's planning Thread a restart cut short (spec §2.4). */
export const PLANNING_AFTER_RESTART_OPENING = promptTemplate({
  key: "work.planning-after-restart-opening",
  domain: "work",
  name: "Planning after a restart",
  description:
    "What the Planner is woken with in a Task's planning Thread that a restart of The Office cut short, mid-turn or with Sub-agents running.",
  variables: {},
  text: "The Office restarted and cut your planning of this Task short. Any Sub-agents you had running were stopped, and their results were lost: run again the ones you still need, then carry on planning where you left off.",
});

/** The first message in an Initiative's planning Thread opened with Plan the Initiative. */
export const INITIATIVE_PLANNING_OPENING = promptTemplate({
  key: "work.initiative-planning-opening",
  domain: "work",
  name: "Initiative planning opening",
  description:
    "The Office's first message in an Initiative's planning Thread opened with Plan the Initiative, after the Brief.",
  variables: {},
  text: "Plan this Initiative's Tasks in Backlog, as your Brief lists them, in the order their blockers set. The user has nothing more to add yet.",
});

/** As `PLANNING_AFTER_RESTART_OPENING`, in an Initiative's planning Thread. */
export const INITIATIVE_PLANNING_AFTER_RESTART_OPENING = promptTemplate({
  key: "work.initiative-planning-after-restart-opening",
  domain: "work",
  name: "Initiative planning after a restart",
  description:
    "What the Planner is woken with in an Initiative's planning Thread that a restart of The Office cut short.",
  variables: {},
  text: "The Office restarted and cut your planning of this Initiative's Tasks short. Any Sub-agents you had running were stopped, and their results were lost: run again the ones you still need, then carry on planning the Tasks still in Planning where you left off.",
});

const NO_WORKTREE_YET_TEXT =
  "The Task has no worktree yet: The Office makes it when the Task starts. Until then you read each Project's checkout in your folder, as a chat does: at its base branch, or at the Task's Initiative's branch where it has one.";

const HOW_TO_READ_ATTACHMENTS_TEXT =
  "Read one with read_attachment, by its id: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase; an image as a picture where the engine shows one; any other file by its name, kind and size.";

const TASK_VARIABLES = {
  taskTitle: { kind: "text", description: "The Task's title." },
  taskId: { kind: "text", description: "The Task's id." },
  projectName: { kind: "text", description: "The name of the Task's Project." },
  description: {
    kind: "text",
    description: "The Task's Description, or the words saying the title is all there is.",
  },
} as const;

const WORKTREE_VARIABLES = {
  worktree: { kind: "flag", description: "The Task has a worktree." },
  worktreePath: { kind: "text", description: "Where its worktree is; empty with none." },
  worktreeBranch: { kind: "text", description: "The Task's own branch; empty with no worktree." },
} as const;

const PLAN_VARIABLES = {
  plan: {
    kind: "text",
    description: "The Task's Plan, with the files it expects to change; empty while unwritten.",
  },
  planConfirmation: {
    kind: "text",
    description: "Whether the Plan is confirmed: confirmed, or not yet confirmed.",
  },
  hasDefinitionOfDone: { kind: "flag", description: "The Definition of Done is written." },
  definitionOfDone: {
    kind: "list",
    description: "The Definition of Done's statements, in order, each read as {{.}}.",
  },
  definitionOfDoneConfirmation: {
    kind: "text",
    description: "Whether the Definition of Done is confirmed: confirmed, or not yet confirmed.",
  },
} as const;

const ATTACHMENT_VARIABLES = {
  hasAttachments: { kind: "flag", description: "The Task has at least one Attachment." },
  attachments: {
    kind: "text",
    description: "The Task's Attachments, one line each with its id; None. when it has none.",
  },
} as const;

const PIPELINE_LIBRARY_VARIABLE = {
  pipelineLibrary: {
    kind: "text",
    description:
      "The Pipelines, one line each, each Project's own first under its name, then the office-wide ones.",
  },
} as const;

const PLAN_SECTIONS = `{{#plan}}

## The Plan, {{planConfirmation}}

{{plan}}
{{/plan}}
{{#hasDefinitionOfDone}}

## The Definition of Done, {{definitionOfDoneConfirmation}}

{{#definitionOfDone}}
- {{.}}
{{/definitionOfDone}}
{{/hasDefinitionOfDone}}
`;

const ATTACHMENTS_SECTION = `## Attachments

{{#hasAttachments}}
${HOW_TO_READ_ATTACHMENTS_TEXT}

{{/hasAttachments}}
{{attachments}}
`;

/** A planning Thread's Brief (spec §2.5). */
export const PLANNING_BRIEF = promptTemplate({
  key: "work.planning-brief",
  domain: "work",
  name: "Planning Brief",
  description:
    "The Brief of a Task's planning Thread: the Task, who asked, where it is worked and where it came from, its records, the Project's commands, the Pipelines and the parts written so far.",
  variables: {
    ...TASK_VARIABLES,
    kind: { kind: "text", description: "The Task's Kind: Feature, Bug or Chore." },
    kindPlural: {
      kind: "text",
      description: "Tasks of its Kind, as the Pipeline line names them: Features, Bugs or Chores.",
    },
    commitType: {
      kind: "text",
      description: "The commit type its Kind suggests: feat, fix or chore.",
    },
    bugDetails: {
      kind: "text",
      description:
        "Its Caused by and Found in version, when set, such as Caused by: Passkeys (Task …, Done). Found in version: v1.14.2.; empty when neither is.",
    },
    createdBy: { kind: "text", description: "Who created the Task, such as the user Ann Lee." },
    movedToPlanningBy: {
      kind: "text",
      description: "Who last moved the Task to Planning; empty when no such move was kept.",
    },
    ready: { kind: "flag", description: "The Task is Ready: planned, waiting to start." },
    ...WORKTREE_VARIABLES,
    startsFrom: {
      kind: "text",
      description: "The branch the worktree started from: the base branch or the Initiative's.",
    },
    fromIdea: { kind: "flag", description: "The Task was shaped from an Idea." },
    ideaTitle: { kind: "text", description: "The Idea's title; empty from no Idea." },
    ideaNotesAreDescription: {
      kind: "flag",
      description: "The Idea's notes are the Task's Description still.",
    },
    ideaNotes: { kind: "text", description: "The Idea's notes; empty when it has none." },
    linkedRecords: {
      kind: "text",
      description: "The records the Task is linked to, as a section; empty when none.",
    },
    initiative: {
      kind: "text",
      description:
        "The Initiative the Task is part of, with its other Tasks, as a section; empty when none.",
    },
    initiativeBranch: {
      kind: "text",
      description:
        "The Initiative's branch the Task starts from and publishes into; empty when it starts from the base branch.",
    },
    initiativePipeline: {
      kind: "text",
      description: "The Initiative's Pipeline in the Task's Project, by name; empty with none.",
    },
    baseBranch: { kind: "text", description: "The Project's base branch, such as main." },
    ...ATTACHMENT_VARIABLES,
    commands: {
      kind: "text",
      description: "The Project's install command and other commands, one line each.",
    },
    hasPipeline: { kind: "flag", description: "The Task follows a Pipeline already." },
    pipelineName: {
      kind: "text",
      description: "The Pipeline the Task follows, by name and id; empty with none.",
    },
    defaultPipeline: {
      kind: "text",
      description:
        "The Pipeline the Project gives the Task's Kind (its Kind's default, else the Project's), by name and id, with why it was Broken before The Office updated, if it was.",
    },
    defaultPipelineBroken: {
      kind: "flag",
      description:
        "That Pipeline was Broken before The Office updated and isn't saved since, so it can't be proposed.",
    },
    ...PIPELINE_LIBRARY_VARIABLE,
    proposedPipeline: {
      kind: "text",
      description: "The Pipeline the Planner proposed, by name and id; empty with none.",
    },
    proposalReason: { kind: "text", description: "Why the Planner proposed it." },
    ...AUTO_MODE_VARIABLE,
    ...PLAN_VARIABLES,
  },
  text: `You are planning a Task with the user, in the Task's planning Thread.

## The Task

{{taskTitle}} (Task {{taskId}}), in the Project {{projectName}}.

Kind: {{kind}}. Its commit type is {{commitType}} (Bug → fix, Feature → feat, Chore → chore).
{{#bugDetails}}
{{bugDetails}}
{{/bugDetails}}
If the Task isn't what its Kind says, change it with write_kind; set Caused by and Found in version with write_bug_details.

## Who asked

The Task was created by {{createdBy}}{{#movedToPlanningBy}} and moved to Planning by {{movedToPlanningBy}}{{/movedToPlanningBy}}.
{{#ready}}

## The Task is Ready

It is planned and waits to start. Writing its Plan, Definition of Done or Pipeline takes it back to Planning, out of the queue if it is queued, where it is marked planned and Ready again, so write a part only when the user asks you to change it. Answer their questions without writing anything otherwise.
{{/ready}}

## What the user wants, in their own words

{{description}}

## Where you work

{{#worktree}}
The Task's worktree, at {{worktreePath}} on the branch {{worktreeBranch}}, which started from the freshly fetched {{startsFrom}}.
{{/worktree}}
{{^worktree}}
${NO_WORKTREE_YET_TEXT}
{{/worktree}}

## Where it came from

{{^fromIdea}}
The Task was created as it is, from no Idea.
{{/fromIdea}}
{{#fromIdea}}
{{#ideaNotesAreDescription}}
The Idea "{{ideaTitle}}", whose notes are the Description.
{{/ideaNotesAreDescription}}
{{^ideaNotesAreDescription}}
The Idea "{{ideaTitle}}". Its notes:

{{ideaNotes}}{{^ideaNotes}}It has no notes.{{/ideaNotes}}
{{/ideaNotesAreDescription}}
{{/fromIdea}}
{{#linkedRecords}}

{{linkedRecords}}
{{/linkedRecords}}
{{#initiative}}

{{initiative}}
{{/initiative}}
{{#initiativeBranch}}

## The Initiative's branch

The Initiative has the Pipeline {{initiativePipeline}} in this Project, so this Task starts from its branch {{initiativeBranch}} and publishes into it by merge, never into {{baseBranch}} directly. The Initiative's Pipeline runs only in the Project's Publishing Task, which takes {{initiativeBranch}} into {{baseBranch}} once its Tasks are done; this Task keeps a Pipeline of its own, the one you propose below.
{{/initiativeBranch}}

${ATTACHMENTS_SECTION}
## The Project's commands

{{commands}}

## The Pipelines

{{#hasPipeline}}The Task follows {{pipelineName}} until the user confirms another.{{/hasPipeline}}{{^hasPipeline}}The Task has no Pipeline yet.{{/hasPipeline}} The Pipeline {{projectName}} gives {{kindPlural}} is {{defaultPipeline}}{{^defaultPipelineBroken}}; propose it with propose_pipeline unless the work needs another{{/defaultPipelineBroken}}{{#defaultPipelineBroken}}. Propose the one its Definition of Done needs with propose_pipeline{{/defaultPipelineBroken}}:

{{pipelineLibrary}}
{{#proposedPipeline}}

You proposed {{proposedPipeline}}: {{proposalReason}} It waits for the user to confirm it.
{{/proposedPipeline}}

## Auto mode

{{#autoMode}}
On: once you mark the Task planned with mark_planned and no Decision on it is open, The Office confirms the Plan, the Definition of Done and the proposed Pipeline and marks the Task Ready.
{{/autoMode}}
{{^autoMode}}
Off: the user confirms the Plan, the Definition of Done and the Pipeline, and marks the Task Ready.
{{/autoMode}}
${PLAN_SECTIONS}`,
});

/** The first session's Brief of a person's Thread on a Task (spec §2.5). */
export const ASKING_BRIEF = promptTemplate({
  key: "work.asking-brief",
  domain: "work",
  name: "Asking Brief",
  description:
    "The first session's Brief of a person's own Thread on a Task: the Task, where it is read, its Plan and Definition of Done, Stage results, the diff so far and the person's Handover notes.",
  variables: {
    ...TASK_VARIABLES,
    ...WORKTREE_VARIABLES,
    ...PLAN_VARIABLES,
    ...ATTACHMENT_VARIABLES,
    hasStageResults: { kind: "flag", description: "At least one Stage run has a result." },
    stageResults: {
      kind: "list",
      description: "Each Stage run's result, one line each, read as {{.}}.",
    },
    diffSummary: {
      kind: "text",
      description: "What changed on the Task's branch so far; empty when nothing has.",
    },
    handoverNotes: {
      kind: "text",
      description: "The person's own Handover notes on the Task; empty when none.",
    },
  },
  text: `The user wants to ask you about a Task, in your own Thread on it.

## The Task

{{taskTitle}} (Task {{taskId}}), in the Project {{projectName}}.

## What the user wants, in their own words

{{description}}

## Where you read

{{#worktree}}
The Task's worktree, at {{worktreePath}} on the branch {{worktreeBranch}}.
{{/worktree}}
{{^worktree}}
${NO_WORKTREE_YET_TEXT}
{{/worktree}}
${PLAN_SECTIONS}
${ATTACHMENTS_SECTION}{{#hasStageResults}}

## Stage results

{{#stageResults}}
{{.}}
{{/stageResults}}
{{/hasStageResults}}
{{#diffSummary}}

## What changed so far

{{diffSummary}}
{{/diffSummary}}
{{#handoverNotes}}

## Your Handover notes on this Task

{{handoverNotes}}
{{/handoverNotes}}
`,
});

/** An Initiative's shaping Thread's Brief (spec §2.5). */
export const SHAPING_BRIEF = promptTemplate({
  key: "work.shaping-brief",
  domain: "work",
  name: "Shaping Brief",
  description:
    "The Brief of an Initiative's shaping Thread: its record, who shaped or created it, and the Pipelines each Project it spans may follow.",
  variables: {
    record: {
      kind: "text",
      description: "The Initiative's record: outcome, Tasks, dependencies and Attachments.",
    },
    createdFromIdea: { kind: "flag", description: "The Initiative was shaped from an Idea." },
    createdBy: { kind: "text", description: "Who shaped or created it, such as the user Ann Lee." },
    ideaProjectId: {
      kind: "text",
      description: "The Project its Idea was captured in; empty for one captured Office-wide.",
    },
    shaping: { kind: "flag", description: "The Initiative is being shaped, not yet confirmed." },
    hasProjects: { kind: "flag", description: "The Initiative spans at least one Project." },
    projects: {
      kind: "list",
      description: "The Projects it spans, each with the Pipeline it has there.",
      fields: {
        name: "The Project's name.",
        id: "The Project's id.",
        pipeline: "The Initiative's Pipeline there, by name; empty for None.",
      },
    },
    ...PIPELINE_LIBRARY_VARIABLE,
  },
  text: `{{record}}

## Who asked

The Initiative was {{#createdFromIdea}}shaped from its Idea{{/createdFromIdea}}{{^createdFromIdea}}created{{/createdFromIdea}} by {{createdBy}}.
{{#ideaProjectId}}

The Idea was captured in the Project {{ideaProjectId}}, so the Initiative's Tasks are in {{ideaProjectId}} unless the user names other Projects: don't ask which Project it is for.
{{/ideaProjectId}}

## The Pipelines

Each Project the Initiative spans has a Pipeline of its own, or None. {{#shaping}}Choose one for a Project with choose_pipeline, or None with null, when the user wants that Project's whole change published together; whether each Project has one is fixed at Confirm.{{/shaping}}{{^shaping}}Whether each Project has one was fixed at Confirm; choose_pipeline drafts a Proposal of another Pipeline for a Project that has one, or of a first one for a Project the Initiative came to span since.{{/shaping}}
{{#hasProjects}}

{{#projects}}
- {{name}} ({{id}}): {{#pipeline}}{{pipeline}}.{{/pipeline}}{{^pipeline}}None, so each of its Tasks publishes on its own.{{/pipeline}}
{{/projects}}
{{/hasProjects}}

{{pipelineLibrary}}
`,
});

/** An Initiative's planning Thread's Brief (spec §2.5). */
export const INITIATIVE_PLANNING_BRIEF = promptTemplate({
  key: "work.initiative-planning-brief",
  domain: "work",
  name: "Initiative planning Brief",
  description:
    "The Brief of an Initiative's planning Thread: its record, who opened the Thread, the Tasks to plan, those being planned and those waiting for an answer, the Projects it spans, the Pipelines and auto mode.",
  variables: {
    record: {
      kind: "text",
      description: "The Initiative's record: outcome, Tasks, dependencies and Attachments.",
    },
    planningOpenedBy: {
      kind: "text",
      description: "Who opened this planning Thread; empty when that wasn't kept.",
    },
    withUser: {
      kind: "flag",
      description: "The Thread was opened with Plan with…, to plan with the user.",
    },
    hasTasksToPlan: { kind: "flag", description: "At least one of its Tasks is in Backlog." },
    tasksToPlan: {
      kind: "list",
      description: "Its Tasks in Backlog, each with the Tasks inside the Initiative it waits for.",
      fields: {
        title: "The Task's title.",
        id: "The Task's id.",
        projectName: "The name of its Project.",
        waitsFor: "The Tasks it waits for, by title, id and state; empty when none.",
        kind: "Its Kind: Feature, Bug or Chore.",
        kindPlural: "Tasks of its Kind: Features, Bugs or Chores.",
        commitType: "The commit type its Kind suggests: feat, fix or chore.",
        bugDetails: "Its Caused by and Found in version, when set; empty when neither is.",
        defaultPipeline:
          "The Pipeline its Project gives its Kind, by name and id, with why it was Broken before The Office updated, if it was.",
      },
    },
    hasBeingPlanned: {
      kind: "flag",
      description: "This Thread moved Tasks to Planning and hasn't marked them planned.",
    },
    beingPlanned: {
      kind: "list",
      description: "The Tasks this Thread is planning and hasn't marked planned.",
      fields: { title: "The Task's title.", id: "The Task's id." },
    },
    hasWaiting: {
      kind: "flag",
      description: "This Thread opened Decisions on Tasks that wait on the user.",
    },
    waiting: {
      kind: "list",
      description: "The Decisions on Tasks this Thread opened that wait on the user.",
      fields: {
        taskTitle: "The title of the Task it is on.",
        taskId: "The id of the Task it is on.",
        question: "Its question.",
      },
    },
    projects: {
      kind: "list",
      description: "The Projects the Initiative spans.",
      fields: {
        first: "Not empty for the first Project, so {{^first}} comes between Projects.",
        name: "The Project's name.",
        id: "The Project's id.",
        baseBranch: "Its base branch, such as main.",
        defaultPipeline:
          "Its default Pipeline, by name and id, with why it was Broken before The Office updated, if it was.",
        commands: "Its install command and other commands, one line each.",
      },
    },
    ...PIPELINE_LIBRARY_VARIABLE,
    autoMode: {
      kind: "flag",
      description: "The Initiative is planned in auto mode: The Office accepts each planned Task.",
    },
  },
  text: `You are planning an Initiative's Tasks, in its planning Thread.

{{record}}
{{#planningOpenedBy}}

## Who asked

This planning Thread was opened by {{planningOpenedBy}}, with {{#withUser}}Plan with…{{/withUser}}{{^withUser}}Plan the Initiative{{/withUser}}.
{{/planningOpenedBy}}
{{#withUser}}

## Planning with the user

The user opened this Thread to plan the Initiative with you: their messages say how to plan it. Follow them where they differ from the default way your instructions give; ask in the Thread what is unclear.
{{/withUser}}

## The Tasks to plan

{{^hasTasksToPlan}}
None of its Tasks is in Backlog now.
{{/hasTasksToPlan}}
{{#hasTasksToPlan}}
Its Tasks in Backlog, each with the Tasks inside the Initiative it waits for:

{{#tasksToPlan}}
- "{{title}}" (Task {{id}}), a {{kind}} in the Project {{projectName}}: {{#waitsFor}}waits for {{waitsFor}}{{/waitsFor}}{{^waitsFor}}waits for no Task in the Initiative{{/waitsFor}}. Its commit type is {{commitType}}.{{#bugDetails}} {{bugDetails}}{{/bugDetails}}{{#defaultPipeline}} The Pipeline {{projectName}} gives {{kindPlural}} is {{defaultPipeline}}.{{/defaultPipeline}}
{{/tasksToPlan}}
{{/hasTasksToPlan}}
{{#hasBeingPlanned}}

## Being planned here

This Thread moved these Tasks to Planning and hasn't marked them planned yet: read each with read_task, finish what its parts lack and call mark_planned for it.

{{#beingPlanned}}
- "{{title}}" (Task {{id}})
{{/beingPlanned}}
{{/hasBeingPlanned}}
{{#hasWaiting}}

## Waiting for an answer

This Thread opened these Decisions, which still wait on the user: don't ask them again, and leave each Task, and the Tasks that wait for it, until its answer comes as a message.

{{#waiting}}
- "{{taskTitle}}" (Task {{taskId}}): "{{question}}"
{{/waiting}}
{{/hasWaiting}}

## The Projects it spans

{{#projects}}
{{^first}}

{{/first}}
### {{name}} ({{id}})

Base branch {{baseBranch}}, checked out where The Projects below say; its default Pipeline is {{defaultPipeline}}. Its commands:

{{commands}}
{{/projects}}
{{^projects}}

{{/projects}}

## The Pipelines

A Task's Kind gives its commit type (Bug → fix, Feature → feat, Chore → chore) and the Pipeline its Project gives it, named with the Task above. If a Task isn't what its Kind says, change it with write_kind; set a Bug's Caused by and Found in version with write_bug_details.

A Task has no Pipeline until one is chosen. Propose for each Task the Pipeline its Project gives its Kind with propose_pipeline, unless its Definition of Done needs another; a Project Pipeline only for its own Project's Tasks:

{{pipelineLibrary}}

## Auto mode

{{#autoMode}}
On: once you mark a Task planned with mark_planned, The Office confirms its Plan, Definition of Done and proposed Pipeline and marks it Ready.
{{/autoMode}}
{{^autoMode}}
Off: once you mark a Task planned with mark_planned, it waits in Planning for the user to confirm its Plan, Definition of Done and Pipeline and mark it Ready.
{{/autoMode}}
`,
});

/** Who asked for the Task an Agent Stage works (spec §2.5). */
export const TASK_WHO_ASKED = promptTemplate({
  key: "work.task-who-asked",
  domain: "work",
  name: "Agent Stage: Who asked",
  description:
    "The part of an Agent Stage's Brief that names who created the Task and who last started it.",
  variables: {
    createdBy: { kind: "text", description: "Who created the Task, such as the user Ann Lee." },
    startedBy: {
      kind: "text",
      description:
        "Who last started it, such as the queue, as its turn came; empty when no start was kept.",
    },
  },
  text: `## Who asked

The Task was created by {{createdBy}}{{#startedBy}} and started by {{startedBy}}{{/startedBy}}.
`,
});

/** Every Prompt template Work renders, which it registers at start. */
export const WORK_PROMPT_TEMPLATES: readonly PromptTemplate[] = [
  SHAPING_INSTRUCTIONS,
  PLANNING_INSTRUCTIONS,
  INITIATIVE_PLANNING_INSTRUCTIONS,
  ASKING_INSTRUCTIONS,
  SHAPING_OPENING,
  CREATED_INITIATIVE_SHAPING_OPENING,
  MAKE_A_PLAN_OPENING,
  PLANNING_AFTER_RESTART_OPENING,
  INITIATIVE_PLANNING_OPENING,
  INITIATIVE_PLANNING_AFTER_RESTART_OPENING,
  PLANNING_BRIEF,
  ASKING_BRIEF,
  SHAPING_BRIEF,
  INITIATIVE_PLANNING_BRIEF,
  TASK_WHO_ASKED,
];
