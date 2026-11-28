import { promptTemplate } from "../../prompt-templates/index.domain.js";

const MEMORY_VARIABLE = {
  memory: {
    kind: "text",
    description:
      "The person's Memory, as the Brief's Memory template words it; empty when they have no note.",
  },
} as const;

const PROJECTS_VARIABLE = {
  projects: {
    kind: "text",
    description: "Where each Project is read, as the Brief's Projects template words it.",
  },
} as const;

const OPEN_QUESTIONS_VARIABLE = {
  questions: {
    kind: "list",
    description: "The open Decision's questions, in order.",
    fields: {
      number: "The question's number, from 1.",
      question: "The question.",
      first: "Not empty for the first question, so {{^first}} comes between questions.",
      openQuestion: "Not empty for a question answered in the user's own words.",
      optionLines: "A choice's options, one line each.",
    },
  },
} as const;

/** The part of a Brief that carries the person's Memory notes (spec §2.2). */
export const BRIEF_MEMORY = promptTemplate({
  key: "conversations.brief-memory",
  domain: "conversations",
  name: "Brief: Memory",
  description:
    "The part of a Brief that carries the person's Memory notes that fit, oldest first, and how many older ones were left out.",
  variables: {
    lines: { kind: "list", description: "The notes that fit, one line each, oldest first." },
    leftOut: {
      kind: "text",
      description: "How many older notes were left out; empty when none were.",
    },
    oneLeftOut: { kind: "flag", description: "Exactly one older note was left out." },
  },
  text: `## Your Memory

Notes you wrote in earlier sessions, oldest first:

{{#lines}}
{{.}}
{{/lines}}
{{#leftOut}}
{{^lines}}

{{/lines}}

{{leftOut}} older {{#oneLeftOut}}note{{/oneLeftOut}}{{^oneLeftOut}}notes{{/oneLeftOut}} left out.
{{/leftOut}}
`,
});

/** The part of a Brief that says where each Project is read, checked out read-only. */
export const BRIEF_PROJECTS = promptTemplate({
  key: "conversations.brief-projects",
  domain: "conversations",
  name: "Brief: Projects",
  description:
    "The part of a Brief that says where the session reads each Project: its base branch, or on an Initiative, the Initiative's branch.",
  variables: {
    hasProjects: { kind: "flag", description: "The Office works on at least one Project." },
    readsInitiativeBranch: {
      kind: "flag",
      description: "The session reads the Initiative's branch in at least one Project.",
    },
    projects: {
      kind: "list",
      description: "The Projects, each where the session reads it.",
      fields: {
        name: "The Project's name.",
        baseBranch: "Its base branch, such as main.",
        folder: "The folder the session reads it in.",
        initiativeBranch: "The Initiative's branch in it; empty off an Initiative.",
        onInitiativeBranch: "Not empty when the session reads the Initiative's branch there.",
        initiativeBranchGone: "Not empty when the Initiative's branch was deleted there.",
      },
    },
  },
  text: `## The Projects

{{^hasProjects}}
The Office works on no Project yet.
{{/hasProjects}}
{{#hasProjects}}
{{#readsInitiativeBranch}}
You read each Project where it is checked out:
{{/readsInitiativeBranch}}
{{^readsInitiativeBranch}}
You read each Project's base branch where it is checked out:
{{/readsInitiativeBranch}}

{{#projects}}
{{#onInitiativeBranch}}
- {{name}}: the Initiative's branch {{initiativeBranch}}, read-only, at {{folder}}
{{/onInitiativeBranch}}
{{^onInitiativeBranch}}
- {{name}}: its {{baseBranch}} branch, read-only, at {{folder}}{{#initiativeBranchGone}}; the Initiative's branch {{initiativeBranch}} is gone, so you read the base branch.{{/initiativeBranchGone}}
{{/onInitiativeBranch}}
{{/projects}}
{{/hasProjects}}
`,
});

/** The part of a chat's or a person's Thread's Brief that carries its latest exchanges (spec §9). */
export const BRIEF_LATEST_EXCHANGES = promptTemplate({
  key: "conversations.brief-latest-exchanges",
  domain: "conversations",
  name: "Brief: latest exchanges",
  description:
    "The part of a fresh session's Brief that carries the Thread's latest exchanges that fit, oldest first.",
  variables: {
    exchanges: {
      kind: "list",
      description: "The messages that fit, oldest first.",
      fields: {
        text: "Who wrote the message and what it says, with the images it carried.",
        first: "Not empty for the first message, so {{^first}} comes between messages.",
      },
    },
    readImages: {
      kind: "flag",
      description: "A message carries an image that is still there to read.",
    },
  },
  text: `## The latest exchanges

{{#exchanges}}
{{^first}}

{{/first}}
{{text}}
{{/exchanges}}
{{#readImages}}

Read an image the user sent with read_attachment, by its Attachment's id.
{{/readImages}}
`,
});

/** The part of a Task Thread's Brief that carries the Decisions the user answered. */
export const BRIEF_ANSWERED_DECISIONS = promptTemplate({
  key: "conversations.brief-answered-decisions",
  domain: "conversations",
  name: "Brief: answered Decisions",
  description:
    "The part of a Brief for a Thread on a Task that carries the Decisions the user answered on the Task.",
  variables: {
    decisions: {
      kind: "list",
      description: "Each answered Decision, with its questions and answers, in the order answered.",
    },
  },
  text: `## Decisions the user answered

{{#decisions}}
{{.}}
{{/decisions}}
`,
});

const OPEN_QUESTIONS = `{{#questions}}
{{^first}}

{{/first}}
{{number}}. {{question}}
{{#openQuestion}}
   An open question, answered in their own words.
{{/openQuestion}}
{{^openQuestion}}
{{optionLines}}
{{/openQuestion}}
{{/questions}}`;

/** The part of a Task Thread's Brief for the Decision the Thread waits on the user for. */
export const BRIEF_OPEN_DECISION = promptTemplate({
  key: "conversations.brief-open-decision",
  domain: "conversations",
  name: "Brief: open Decision",
  description:
    "The part of a Brief for a Thread on a Task for the Decision it waits on: what was asked, and that the answer comes as a message.",
  variables: OPEN_QUESTIONS_VARIABLE,
  text: `## Your open Decision

You asked the user:

${OPEN_QUESTIONS}

They haven't answered it yet: their answer comes as a message in this Thread.`,
});

/**
 * The part of an Initiative Thread's Brief for the Decision on no Task it waits on (spec §2.4): it
 * isn't asked again.
 */
export const BRIEF_OPEN_DECISION_ON_INITIATIVE = promptTemplate({
  key: "conversations.brief-open-decision-on-initiative",
  domain: "conversations",
  name: "Brief: open Decision on the Initiative",
  description:
    "The part of a Brief for a Thread on an Initiative for the Decision on the Initiative as a whole it waits on: what was asked, of whom, and not to ask it again.",
  variables: {
    ...OPEN_QUESTIONS_VARIABLE,
    whom: {
      kind: "text",
      description: 'Whom it was put to: "the user", or "the person in the Role" and its key.',
    },
  },
  text: `## Your open Decision on the Initiative

You asked {{whom}}:

${OPEN_QUESTIONS}

It still waits on {{whom}}: don't ask it again. Their answer comes as a message in this Thread.`,
});

/** A new chat Thread's Brief, before the user's first message. */
export const NEW_CHAT_THREAD_BRIEF = promptTemplate({
  key: "conversations.new-chat-thread-brief",
  domain: "conversations",
  name: "New chat Thread's Brief",
  description:
    "What a person's session is given as a new chat Thread starts: that nothing carries over, their Memory and where the Projects are.",
  variables: { ...MEMORY_VARIABLE, ...PROJECTS_VARIABLE },
  text: `You are talking with the user in your chat, in a new Thread: nothing from your earlier Threads carries over.
{{#memory}}

{{memory}}
{{/memory}}

{{projects}}`,
});

const FRESH_THREAD_VARIABLES = {
  hasTitle: { kind: "flag", description: "The Thread has a title." },
  title: { kind: "text", description: "The Thread's title." },
  hasHandoverNote: { kind: "flag", description: "The person wrote a Handover note in it." },
  handoverNote: { kind: "text", description: "The person's latest Handover note." },
  latestExchanges: {
    kind: "text",
    description:
      "The Thread's latest exchanges, as the Brief's latest exchanges template words them; empty when there are none.",
  },
  ...MEMORY_VARIABLE,
} as const;

const FRESH_THREAD_PARTS = `{{#hasTitle}}

## The Thread

{{title}}
{{/hasTitle}}
{{#hasHandoverNote}}

## Your Handover note

{{handoverNote}}
{{/hasHandoverNote}}
{{#latestExchanges}}

{{latestExchanges}}
{{/latestExchanges}}
{{#memory}}

{{memory}}
{{/memory}}`;

/** A chat Thread's Brief when it continues in a fresh session (spec §9). */
export const FRESH_CHAT_THREAD_BRIEF = promptTemplate({
  key: "conversations.fresh-chat-thread-brief",
  domain: "conversations",
  name: "Fresh chat Thread's Brief",
  description:
    "What a chat Thread's fresh session is given: its title, the latest Handover note, its latest exchanges, the person's Memory and where the Projects are.",
  variables: { ...FRESH_THREAD_VARIABLES, ...PROJECTS_VARIABLE },
  text: `You are continuing a Thread with the user in your chat, in a fresh session: the earlier session's context is gone, and this Brief is what you pick up from.
${FRESH_THREAD_PARTS}

{{projects}}`,
});

/** A person's Thread on a Task's Brief when it continues in a fresh session (spec §2.5). */
export const FRESH_PERSONS_THREAD_BRIEF = promptTemplate({
  key: "conversations.fresh-persons-thread-brief",
  domain: "conversations",
  name: "Fresh person's Thread's Brief",
  description:
    "What a person's Thread on a Task gives its fresh session: its title, the latest Handover note, its latest exchanges and the person's Memory.",
  variables: FRESH_THREAD_VARIABLES,
  text: `You are continuing your Thread on a Task with the user, in a fresh session: the earlier session's context is gone, and this Brief is what you pick up from. You read the Task's worktree and change nothing in it.
${FRESH_THREAD_PARTS}
`,
});

const CONTINUING_VARIABLE = {
  continuing: {
    kind: "flag",
    description: "The Thread continues in a fresh session, after one before it.",
  },
} as const;

/** A Brief for a Thread on a Task (spec §2.5): from the Task's record, never its exchanges. */
export const TASK_THREAD_BRIEF = promptTemplate({
  key: "conversations.task-thread-brief",
  domain: "conversations",
  name: "Task Thread's Brief",
  description:
    "What a session on a Task is given: the Task's record, the person's Memory, the Decisions the user answered and the one the Thread waits on.",
  variables: {
    ...CONTINUING_VARIABLE,
    record: { kind: "text", description: "The Task's record, as Work words it." },
    ...MEMORY_VARIABLE,
    answeredDecisions: {
      kind: "text",
      description:
        "The Decisions the user answered, as the Brief's answered Decisions template words them; empty when none.",
    },
    openDecision: {
      kind: "text",
      description:
        "The Decision the Thread waits on, as the Brief's open Decision template words it; empty when none.",
    },
  },
  text: `{{#continuing}}
You are continuing a Thread on a Task in a fresh session: the earlier session's context is gone, and this Brief, from the Task's record, is what you pick up from.

{{/continuing}}
{{record}}
{{#memory}}

{{memory}}
{{/memory}}
{{#answeredDecisions}}

{{answeredDecisions}}
{{/answeredDecisions}}
{{#openDecision}}

{{openDecision}}
{{/openDecision}}
`,
});

/** A Brief for a Thread on an Initiative (spec §2.5): from its record, never its exchanges. */
export const INITIATIVE_THREAD_BRIEF = promptTemplate({
  key: "conversations.initiative-thread-brief",
  domain: "conversations",
  name: "Initiative Thread's Brief",
  description:
    "What a session on an Initiative is given: the Initiative's record, the person's Memory, where the Projects are and the Decision on the Initiative the Thread waits on.",
  variables: {
    ...CONTINUING_VARIABLE,
    record: { kind: "text", description: "The Initiative's record, as Work words it." },
    ...MEMORY_VARIABLE,
    ...PROJECTS_VARIABLE,
    openDecision: {
      kind: "text",
      description:
        "The Decision on the Initiative the Thread waits on, as the Brief's open Decision on the Initiative template words it; empty when none.",
    },
  },
  text: `{{#continuing}}
You are continuing a Thread on an Initiative in a fresh session: the earlier session's context is gone, and this Brief, from the Initiative's record, is what you pick up from.

{{/continuing}}
{{record}}
{{#memory}}

{{memory}}
{{/memory}}

{{projects}}
{{#openDecision}}

{{openDecision}}
{{/openDecision}}
`,
});

/** The part of a Brief that says which Office tools are loaded and how to reach the others (spec 6 › Tool areas). */
export const BRIEF_OFFICE_TOOLS = promptTemplate({
  key: "conversations.brief-office-tools",
  domain: "conversations",
  name: "Brief: Office tools",
  description:
    "The part of a Brief that names the Office tool areas the session starts with and lists the tools of the others, with how to load them on its engine.",
  variables: {
    loadedAreas: {
      kind: "text",
      description:
        "The areas whose tools are loaded from the start, Core first, such as Core, work.",
    },
    toolSearch: {
      kind: "flag",
      description: "The engine loads a tool by name with ToolSearch, not through the tool pair.",
    },
    areas: {
      kind: "list",
      description: "The areas not loaded, each with its tools.",
      fields: {
        area: "The area's key.",
        tools: "Its tools' names as the session reaches them, comma separated.",
      },
    },
  },
  text: `## Your Office tools

Loaded from the start: the tools of {{loadedAreas}}. The Office tools of the other areas are not loaded.
{{#toolSearch}}
Load one with ToolSearch, \`select:<tool name>\`, then call it.
{{/toolSearch}}
{{^toolSearch}}
List an area's tools with \`list_office_tools\` (its \`area\`), then call one with \`call_office_tool\` (its \`name\` and \`input\`).
{{/toolSearch}}

{{#areas}}
- {{area}}: {{tools}}
{{/areas}}
`,
});

/** Every Brief template, which `Briefs` loads together. */
export const BRIEF_TEMPLATES = [
  NEW_CHAT_THREAD_BRIEF,
  FRESH_CHAT_THREAD_BRIEF,
  FRESH_PERSONS_THREAD_BRIEF,
  TASK_THREAD_BRIEF,
  INITIATIVE_THREAD_BRIEF,
  BRIEF_MEMORY,
  BRIEF_PROJECTS,
  BRIEF_LATEST_EXCHANGES,
  BRIEF_ANSWERED_DECISIONS,
  BRIEF_OPEN_DECISION,
  BRIEF_OPEN_DECISION_ON_INITIATIVE,
  BRIEF_OFFICE_TOOLS,
] as const;
