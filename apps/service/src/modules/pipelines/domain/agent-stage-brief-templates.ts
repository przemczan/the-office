import { promptTemplate } from "../../prompt-templates/index.js";

/** What a refused turn may have left, as both the held run's section and the sent-again message say. */
const REFUSED_HALF_DONE =
  "The engine may have refused your turn after some of its tool calls, so some of your edits may be half-done: check them before you go on.";

/** The message the engine refused, sent again: the Stage's work, or the correction of its result. */
const REFUSED_MESSAGE = `{{#refusedWork}}
The message the engine refused was this Stage's work, above: do it now, and end with its result.
{{/refusedWork}}
{{^refusedWork}}
The message the engine refused was The Office's request to correct your result, sent again:

{{correction}}
{{/refusedWork}}`;

const REFUSED_MESSAGE_VARIABLES = {
  refusedWork: {
    kind: "flag",
    description:
      "The message the engine refused was the Stage's work; otherwise it was the request to correct the result.",
  },
  correction: {
    kind: "text",
    description:
      "The request to correct the result, as the result correction template words it; empty when the work was refused.",
  },
} as const;

/** A Stage run's result as a line of a Brief, and of the Brief of a person's Thread on the Task. */
export const EARLIER_STAGE_RESULT = promptTemplate({
  key: "pipelines.earlier-stage-result",
  domain: "pipelines",
  name: "Earlier Stage's result",
  description:
    "How a Brief lists a Stage run before this one: how it ended, the notes the user let the work go on with, and its Handover note.",
  variables: {
    stageName: { kind: "text", description: "The Stage's name, such as Implement." },
    kindName: { kind: "text", description: "The Stage's kind, such as Agent Stage or Gate." },
    gateContinued: {
      kind: "flag",
      description: "A Gate the user let the work continue from, with notes.",
    },
    gateNotes: {
      kind: "text",
      description:
        "The notes the user let the work continue with, each later line indented to stay within the item.",
    },
    done: { kind: "flag", description: "The run ended done." },
    summary: { kind: "text", description: "The summary of a run that ended done." },
    askedUser: { kind: "flag", description: "The run ended asking the user." },
    question: { kind: "text", description: "The question the run asked the user." },
    failed: { kind: "flag", description: "The run failed." },
    error: { kind: "text", description: "Why the run failed." },
    hasRouteNotes: {
      kind: "flag",
      description: "None of the Stage's routes held, and the user chose where to go on with notes.",
    },
    routeNotes: {
      kind: "text",
      description:
        "The user's notes for the Stages after it, each later line indented to stay within the item.",
    },
    hasHandoverNote: {
      kind: "flag",
      description: "The run left a Handover note, and the Brief carries it.",
    },
    handoverNote: { kind: "text", description: "The run's Handover note." },
  },
  text: `{{#gateContinued}}
- {{stageName}} ({{kindName}}): the user let the work continue, with notes for the Stages after it. Follow them:
  {{gateNotes}}
{{/gateContinued}}
{{#done}}
- {{stageName}} ({{kindName}}): done. {{summary}}
{{/done}}
{{#askedUser}}
- {{stageName}} ({{kindName}}): asked the user "{{question}}"
{{/askedUser}}
{{#failed}}
- {{stageName}} ({{kindName}}): failed. {{error}}
{{/failed}}
{{#hasRouteNotes}}
  None of its routes held, so the user chose where the work goes on, with notes for the Stages after it. Follow them:
  {{routeNotes}}
{{/hasRouteNotes}}
{{#hasHandoverNote}}
  Handover note: {{handoverNote}}
{{/hasHandoverNote}}
`,
});

/**
 * The Brief a new session of an Agent Stage starts from: the Task's record (spec §2.5). It says
 * never to `cd` to an absolute path: Claude Code asks approval for `cd <absolute path> && …`
 * whatever the hook allows, which fails an unattended Stage (task 12's check on the Test Project).
 */
export const STAGE_BRIEF = promptTemplate({
  key: "pipelines.stage-brief",
  domain: "pipelines",
  name: "Agent Stage's Brief",
  description:
    "What a new session of an Agent Stage is given from the Task's record: the Task, where the Agent works, the Plan, the Definition of Done, the commit message, the earlier Stages, the changes so far, the Attachments, and what the Agent may run.",
  variables: {
    title: { kind: "text", description: "The Task's title." },
    projectName: { kind: "text", description: "The Project's name." },
    whoAskedSection: {
      kind: "text",
      description: "Who created the Task and who started or queued it, as a section.",
    },
    descriptionSection: { kind: "text", description: "The Task's Description, as a section." },
    worktreePath: { kind: "text", description: "Where the Task's worktree is." },
    worktreeBranch: { kind: "text", description: "The Task's branch." },
    screenshotsFolder: {
      kind: "text",
      description: "The folder screenshots go in, relative to the worktree.",
    },
    baseBranch: { kind: "text", description: "The Project's base branch, such as main." },
    inInitiative: {
      kind: "flag",
      description: "The Task belongs to an Initiative and publishes into its branch.",
    },
    publishingTask: {
      kind: "flag",
      description: "The Task is an Initiative's Publishing Task, working on its branch itself.",
    },
    initiativeBranch: {
      kind: "text",
      description: "The Initiative's branch; empty off an Initiative.",
    },
    publishingMode: {
      kind: "text",
      description:
        "How a Publishing Task's Publish puts the Initiative's branch into the base branch, such as a pull request.",
    },
    bases: {
      kind: "text",
      description: "What the Task's branch takes in, in order, such as initiative/x, then main.",
    },
    plan: { kind: "text", description: "The Task's Plan; empty when it has none." },
    hasDefinitionOfDone: { kind: "flag", description: "The Task has a Definition of Done." },
    definitionOfDone: {
      kind: "list",
      description: "The Definition of Done's statements, in order.",
      fields: {
        number: "The statement's number, from 1, as results report it.",
        statement: "The statement.",
        reportedMet: "Not empty when an earlier Stage reported it met and none took it back.",
      },
    },
    commitMessageWritten: {
      kind: "flag",
      description: "The Task's commit message was written; otherwise it is the default.",
    },
    commitMessage: { kind: "text", description: "The Task's commit message." },
    fence: {
      kind: "text",
      description: "Backticks longer than any run of them in the commit message, to fence it.",
    },
    earlierStages: {
      kind: "text",
      description:
        "The earlier Stages' results, one item each, as the earlier Stage's result template words them; empty when none ran.",
    },
    hasDiffSummary: { kind: "flag", description: "What changed so far is known." },
    diffSummary: { kind: "text", description: "What changed on the Task's branch so far." },
    hasLinkedRecords: { kind: "flag", description: "The Task is linked to other records." },
    linkedRecordsSection: {
      kind: "text",
      description: "The records the Task is linked to, as a section.",
    },
    hasConnectedDevices: {
      kind: "flag",
      description: "The Task has Connected devices that are connected as the Stage starts.",
    },
    connectedDevices: {
      kind: "list",
      description: "The Connected devices connected as the Stage starts, one line each.",
    },
    hasAttachments: { kind: "flag", description: "The Task has Attachments." },
    attachments: { kind: "list", description: "The Task's Attachments, one line each." },
    commands: {
      kind: "text",
      description: "The commands the Agent may run, as the Brief's commands template words them.",
    },
    hardSwitches: {
      kind: "text",
      description: "The Hard switches section, as the Hard switches template words it.",
    },
  },
  text: `## The Task

{{title}}, in the Project {{projectName}}.

{{whoAskedSection}}

{{descriptionSection}}

## Where you work

The Task's worktree, at {{worktreePath}} on the branch {{worktreeBranch}}, {{#publishingTask}}the Initiative's own. Its worktree holds {{initiativeBranch}} itself, the Initiative's whole change in this Project; Publish puts it into {{baseBranch}} by {{publishingMode}}. The Office brings {{baseBranch}} into it{{/publishingTask}}{{#inInitiative}}which started from the Initiative's branch {{initiativeBranch}}, and its Publish lands it on {{initiativeBranch}} as one commit, not on {{baseBranch}}. The Office brings {{bases}} into it{{/inInitiative}}{{^publishingTask}}{{^inInitiative}}which started from {{baseBranch}}{{/inInitiative}}{{/publishingTask}}.

Screenshots go in {{screenshotsFolder}}/ there: git ignores it, and The Office keeps it as you leave it across test runs.
{{#plan}}

## The Plan

{{plan}}
{{/plan}}
{{#hasDefinitionOfDone}}

## The Definition of Done

{{#definitionOfDone}}
{{number}}. {{statement}}{{#reportedMet}} (Reported met so far){{/reportedMet}}
{{/definitionOfDone}}
{{/hasDefinitionOfDone}}

## The commit message

{{#commitMessageWritten}}
Publish lands the Task as one commit with this message:
{{/commitMessageWritten}}
{{^commitMessageWritten}}
None is written yet, so Publish lands the Task as one commit with the default, its title with a short summary below it:
{{/commitMessageWritten}}

{{fence}}
{{commitMessage}}
{{fence}}

Update it with write_commit_message when your work changes what it should say, following the commit convention the Project's own docs define.
{{#earlierStages}}

## Earlier Stages

{{earlierStages}}
{{/earlierStages}}
{{#hasDiffSummary}}

## What changed so far

{{diffSummary}}
{{/hasDiffSummary}}
{{#hasLinkedRecords}}

{{linkedRecordsSection}}
{{/hasLinkedRecords}}
{{#hasConnectedDevices}}

## Connected devices

These devices of the Task were connected as this Stage started; commands reach them at the endpoint given:

{{#connectedDevices}}
{{.}}
{{/connectedDevices}}
{{/hasConnectedDevices}}

## Attachments

{{^hasAttachments}}
None.
{{/hasAttachments}}
{{#hasAttachments}}
Read one with read_attachment, by its id: a text file or a PDF's text by its lines, a long one in slices or by searching it for a phrase; an image as a picture where the engine shows one; any other file by its name, kind and size.

{{#attachments}}
{{.}}
{{/attachments}}
{{/hasAttachments}}

## Commands you may run

{{commands}}

Run them in the worktree, where your session starts, with paths relative to it; never \`cd\` to an absolute path, as that stops the Stage to ask for approval.

The Office commits the Stage's work after it ends, so don't commit it yourself, and don't write in your Handover note that your changes are uncommitted.

{{hardSwitches}}
`,
});

/** The section of the Stage's message for a run that was held, and how its edits stand. */
export const STAGE_HELD = promptTemplate({
  key: "pipelines.stage-held",
  domain: "pipelines",
  name: "Stage held before",
  description:
    "The part of a Stage's message that says how its last run was held (Stop, Pause, the fire alarm, the usage window or a restart) and where its edits stand.",
  variables: {
    notStarted: {
      kind: "flag",
      description:
        "The Office recorded the run without starting it, having restarted between Stages; only the user's words go with it.",
    },
    stop: { kind: "flag", description: "A user stopped the run." },
    pause: { kind: "flag", description: "A user paused the run." },
    alarm: { kind: "flag", description: "The fire alarm held the run." },
    usageWindow: {
      kind: "flag",
      description: "The run was paused for a used-up usage window, until it reset.",
    },
    standIn: {
      kind: "flag",
      description:
        "The run was paused for a used-up usage window, and a user chose to go on on a Stand-in Engine.",
    },
    restart: { kind: "flag", description: "The Office restarted while the run went on." },
    who: { kind: "text", description: 'Who held the run, such as "the user Ann Lee".' },
    whoCapitalized: {
      kind: "text",
      description: 'Who held the run, starting a sentence, such as "The user Ann Lee".',
    },
    engineName: { kind: "text", description: "The Stand-in Engine the run goes on on." },
    chosenBy: {
      kind: "text",
      description: 'Who chose the Stand-in Engine, such as "the user Ann Lee".',
    },
    cutShortWhilePaused: {
      kind: "flag",
      description: "The Office restarted during the paused run's last turn and cut it short.",
    },
    cutShortByAlarm: {
      kind: "flag",
      description: "The Office cut the last turn of a run the fire alarm held short.",
    },
    refused: {
      kind: "flag",
      description: "The engine refused the last turn for a used-up usage window.",
    },
    ...REFUSED_MESSAGE_VARIABLES,
    hasGuidance: {
      kind: "flag",
      description: "The user gave their own words for the run going on.",
    },
    guidance: { kind: "text", description: "The user's own words for the run going on." },
  },
  text: `{{#notStarted}}
{{#hasGuidance}}
## The user's words for this Stage

{{guidance}}
{{/hasGuidance}}
{{/notStarted}}
{{^notStarted}}
{{#stop}}
## Stopped by {{who}}

{{whoCapitalized}} stopped this Stage while it ran, and has resumed it. The Office discarded the Stage's uncommitted edits, so the worktree is as the last Stage left it: do the Stage's work again from there.
{{/stop}}
{{#pause}}
## Paused by {{who}}

{{whoCapitalized}} paused this Stage after your last turn, and has resumed it. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.
{{/pause}}
{{#alarm}}
## Held by the fire alarm

The user sounded the fire alarm while this Stage ran, which held it after your last turn, and has given the all clear. Your edits are in the worktree as you left them: go on with the Stage's work from there, and end with its result.
{{/alarm}}
{{#usageWindow}}
## Paused for the usage window

Your engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage until the window reset, and has resumed it now. Your edits are in the worktree as you left them.
{{/usageWindow}}
{{#standIn}}
## Paused for the usage window

Your engine refused your last turn because a usage window of its account was used up, so The Office paused this Stage. It goes on on {{engineName}}, as {{chosenBy}} chose, in this same session. Your edits are in the worktree as you left them.
{{/standIn}}
{{#restart}}
## The Office restarted

The Office restarted while this Stage ran, which cut your last turn short, and the Stage goes on now. The Stage's uncommitted edits are still in the worktree, but the cut may have left one half-done, such as a file half-written: check \`git status\` and \`git diff\` first, then go on with the Stage's work from there, and end with its result.
{{/restart}}
{{#cutShortWhilePaused}}

The Office restarted during your last turn, which it cut short, so some of your edits may be half-done: check them before you go on.
{{/cutShortWhilePaused}}
{{#cutShortByAlarm}}

The Office cut your last turn short, so some of your edits may be half-done: check them before you go on.
{{/cutShortByAlarm}}
{{#refused}}

${REFUSED_HALF_DONE}

${REFUSED_MESSAGE}
{{/refused}}
{{#hasGuidance}}

The user's words for it:

{{guidance}}
{{/hasGuidance}}
{{/notStarted}}
`,
});

/** The section of the Stage's message that says why it runs again. */
export const STAGE_RUNS_AGAIN = promptTemplate({
  key: "pipelines.stage-runs-again",
  domain: "pipelines",
  name: "Stage runs again",
  description:
    "The part of a Stage's message that says why it runs again: a later Stage's loop went back to it, or one more round was chosen, with the guidance given.",
  variables: {
    sameStage: {
      kind: "flag",
      description: "One more round of this Stage itself was chosen, after it failed.",
    },
    hasGuide: {
      kind: "flag",
      description: "A Consultant chose the round, rather than the user.",
    },
    guide: {
      kind: "text",
      description: 'The Consultant who chose the round, such as "Bob (Architect)".',
    },
    stageName: { kind: "text", description: "The later Stage that failed, whose loop went back." },
    round: { kind: "text", description: "Which time the loop goes back, from 1." },
    rounds: { kind: "text", description: "How many times the loop may go back." },
    error: { kind: "text", description: "The failure the round goes back with." },
    hasGuidance: { kind: "flag", description: "Guidance was given for this round." },
    guidance: { kind: "text", description: "What to do differently this round." },
  },
  text: `## Why this Stage runs again

{{#sameStage}}
{{#hasGuide}}One more round of this Stage was chosen by {{guide}}{{/hasGuide}}{{^hasGuide}}The user chose one more round of this Stage{{/hasGuide}} after:
{{/sameStage}}
{{^sameStage}}
"{{stageName}}" failed after it, so the Pipeline went back here (round {{round}} of {{rounds}}):
{{/sameStage}}

{{error}}
{{#hasGuidance}}

{{#hasGuide}}Guidance for this round from {{guide}}{{/hasGuide}}{{^hasGuide}}The user's guidance for this round{{/hasGuide}}:

{{guidance}}
{{/hasGuidance}}
`,
});

/** What a Stage's session is sent again on the Stand-in Engine it went on on (spec 5.4). */
export const STAGE_SENT_AGAIN = promptTemplate({
  key: "pipelines.stage-sent-again",
  domain: "pipelines",
  name: "Stage sent again on a Stand-in Engine",
  description:
    "What a Stage's session is sent after its engine refused a turn for a used-up usage window and it went on on a Stand-in Engine: the refused message again.",
  variables: REFUSED_MESSAGE_VARIABLES,
  text: `## Gone on on a Stand-in Engine

Your engine refused your last turn because a usage window of its account was used up, so The Office moved this session to a Stand-in Engine, where it goes on now. Your edits are in the worktree as you left them.

${REFUSED_HALF_DONE}

${REFUSED_MESSAGE}
`,
});

/** What the Stage asks now, sent after the Brief to a new session, alone to a continued one. */
export const STAGE_MESSAGE = promptTemplate({
  key: "pipelines.stage-message",
  domain: "pipelines",
  name: "Stage's message",
  description:
    "What a Stage asks its Agent: its brief, the Stages after it, a recheck of the commit message before Publish, and why it runs now, such as a question answered, a round again or feedback from a Gate.",
  variables: {
    stageName: { kind: "text", description: "The Stage's name." },
    stageBrief: { kind: "text", description: "The Stage's brief, from the Pipeline." },
    listsLaterStages: {
      kind: "flag",
      description: "The message lists the Stages after this one in the Task's Pipeline.",
    },
    hasLaterStages: { kind: "flag", description: "Some Stage comes after this one." },
    fullCommandLater: {
      kind: "flag",
      description:
        "A later Script Stage runs one of the Project's commands, such as its tests or build, other than Publish.",
    },
    laterStages: {
      kind: "list",
      description: "The Stages after this one, in Pipeline order.",
      fields: {
        name: "The Stage's name.",
        kindName: "The Stage's kind, such as Agent Stage or Gate.",
        agent: "Not empty for an Agent Stage.",
        roleTitle: "The title of the Role that works an Agent Stage; empty when none does.",
        dutyLabel:
          "The duty an Agent Stage nobody works asks for, nobody holding it; empty when it names none.",
        brief: "An Agent Stage's brief, each later line indented to stay within the item.",
        gate: "Not empty for a Gate.",
        publish: "Not empty for Publish.",
        commandLine: "The command line a Script Stage runs; empty when its command isn't set.",
        unsetCommand: "The key of a Script Stage's command that isn't set.",
        comesBack: "Not empty when the work comes back to this Stage if that Stage fails.",
      },
    },
    recheck: {
      kind: "flag",
      description:
        "This is the last Agent Stage before a Publish, which rechecks the commit message.",
    },
    landsOn: { kind: "text", description: "The branch Publish lands the Task on." },
    recheckBase: {
      kind: "text",
      description: "The one base the Task's diff is read from; empty with none or two.",
    },
    recheckBases: {
      kind: "text",
      description:
        "The bases the Task's own commits are read without, when it has two; empty otherwise.",
    },
    commitMessageWritten: {
      kind: "flag",
      description: "The Task's commit message was written; otherwise it is the default.",
    },
    commitMessage: { kind: "text", description: "The Task's commit message as it reads now." },
    fence: {
      kind: "text",
      description: "Backticks longer than any run of them in the commit message, to fence it.",
    },
    held: {
      kind: "text",
      description:
        "How the last run was held, as the Stage held before template words it; empty when it wasn't.",
    },
    answered: {
      kind: "flag",
      description: "The Stage runs again as the user answered its Agent's question.",
    },
    question: { kind: "text", description: "The question the Agent asked." },
    answer: { kind: "text", description: "The user's answer, in words." },
    runsAgain: {
      kind: "text",
      description:
        "Why the Stage runs again, as the Stage runs again template words it; empty when it doesn't.",
    },
    sentBack: {
      kind: "flag",
      description: "The user sent the work back to this Stage from a Gate.",
    },
    gateName: { kind: "text", description: "The Gate the work was sent back from." },
    feedback: { kind: "text", description: "The user's feedback from the Gate." },
    installProblem: {
      kind: "text",
      description: "Why the install before the Stage failed; empty when it didn't.",
    },
  },
  text: `## The Stage: {{stageName}}

{{stageBrief}}
{{#listsLaterStages}}

## Later Stages

{{#hasLaterStages}}
These Stages come after this one in the Task's Pipeline, in order:

{{#laterStages}}
- {{name}} ({{kindName}}{{#agent}}, {{#roleTitle}}{{roleTitle}}{{/roleTitle}}{{^roleTitle}}{{#dutyLabel}}{{dutyLabel}}, nobody holds it{{/dutyLabel}}{{^dutyLabel}}nobody chosen yet{{/dutyLabel}}{{/roleTitle}}{{/agent}}): {{#agent}}{{brief}}{{/agent}}{{#gate}}the user looks at the work there and lets it continue or sends it back.{{/gate}}{{#publish}}The Office publishes the Task's work.{{/publish}}{{#commandLine}}runs \`{{commandLine}}\`.{{/commandLine}}{{#unsetCommand}}runs the Project's command {{unsetCommand}}, which isn't set.{{/unsetCommand}}{{#comesBack}} If it fails, the work comes back here.{{/comesBack}}
{{/laterStages}}
{{#fullCommandLater}}

While you iterate, run only the tests that cover the files you change: a later Stage runs the Project's full command.
{{/fullCommandLater}}
{{/hasLaterStages}}
{{^hasLaterStages}}
No Stage comes after this one in the Task's Pipeline.
{{/hasLaterStages}}
{{/listsLaterStages}}
{{#recheck}}

## Recheck the commit message

Yours is the last Agent Stage before Publish, which lands the Task on {{landsOn}} as one commit with the Task's commit message. Before you end the Stage, read the Task's whole diff ({{#recheckBase}}\`git diff {{recheckBase}}...HEAD\`{{/recheckBase}}{{#recheckBases}}\`git log -p --no-merges HEAD --not {{recheckBases}}\`, its own commits without what the bases brought in{{/recheckBases}}{{^recheckBase}}{{^recheckBases}}\`git diff HEAD\`{{/recheckBases}}{{/recheckBase}}; the Brief's "What changed so far" summarises it), check the message against that diff and the commit convention the Project's own docs define (CLAUDE.md, AGENTS.md, README, CONTRIBUTING and the like), and fix it with write_commit_message where it no longer fits. {{#commitMessageWritten}}It reads now:{{/commitMessageWritten}}{{^commitMessageWritten}}None is written, so Publish would use the default:{{/commitMessageWritten}}

{{fence}}
{{commitMessage}}
{{fence}}
{{/recheck}}
{{#held}}

{{held}}
{{/held}}
{{#answered}}

## Your question, answered

You asked the user: {{question}}

Their answer: {{answer}}

Go on with the Stage from there.
{{/answered}}
{{#runsAgain}}

{{runsAgain}}
{{/runsAgain}}
{{#sentBack}}

## Sent back from {{gateName}}

The user looked at the work so far at the Gate and sent it back to this Stage with their feedback. It is no failure: act on it, then end the Stage with its result.

{{feedback}}
{{/sentBack}}
{{#installProblem}}

## The install before this Stage

{{installProblem}}

Commands that need the dependencies may fail until it passes. If the Task's changes broke it, fix that first; The Office installs again before the next Stage.
{{/installProblem}}
`,
});

/**
 * The section of the Brief a Stage's fresh session starts with after its earlier session in the same
 * Stage run passed its context limit (spec §2.5): that session's Handover note, or that it wrote none.
 */
export const STAGE_HANDOVER = promptTemplate({
  key: "pipelines.stage-handover",
  domain: "pipelines",
  name: "Handover note from this Stage's earlier session",
  description:
    "The part of a Stage's Brief for the fresh session The Office starts once the Stage's session passed its context limit: the earlier session's Handover note, or that it wrote none.",
  variables: {
    hasHandoverNote: {
      kind: "flag",
      description: "The earlier session wrote a Handover note.",
    },
    handoverNote: { kind: "text", description: "The earlier session's Handover note." },
  },
  text: `## Handover note from this Stage's earlier session

This Stage began in an earlier session, whose context grew past its limit, so The Office goes on with the Stage in this fresh session. That session's edits are in the worktree, uncommitted: go on from where it left the work, without redoing what is done, and end the Stage with its result.
{{#hasHandoverNote}}

Its Handover note:

{{handoverNote}}
{{/hasHandoverNote}}
{{^hasHandoverNote}}

It wrote no Handover note: check the worktree's diff first (\`git status\` and \`git diff\`) to see where it left the work.
{{/hasHandoverNote}}
`,
});

/** Every template an Agent Stage's Brief and message render, which the runner loads together. */
export const AGENT_STAGE_BRIEF_TEMPLATES = [
  STAGE_BRIEF,
  EARLIER_STAGE_RESULT,
  STAGE_MESSAGE,
  STAGE_HELD,
  STAGE_RUNS_AGAIN,
  STAGE_SENT_AGAIN,
  STAGE_HANDOVER,
] as const;
