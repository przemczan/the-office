import { READ_ONLY_SHELL_RULE, WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL } from "../../engine/index.js";
import { promptTemplate, renderedPart, type PromptTexts } from "../../prompt-templates/index.js";
import {
  ALLOW_CHANGES_ADVICE,
  CALLING_RULE,
  CHANGE_PROJECT_SETTINGS_TOOL,
  CHAT_DECISION_RULE,
  CONSULT_TOOL,
  DEFAULT_PERSON_CALLING_RULE,
  ENGINE_TRANSCRIPTS_RULE,
  OFFICE_INSTRUCTIONS_LEAD_IN,
  OFFICE_PROPOSALS_RULE,
  OFFICE_SETUP_RULE,
  PROPOSE_ACTIONS_TOOL,
  PROPOSE_PROJECT_COMMANDS_TOOL,
  PROPOSE_TEST_TARGETS_TOOL,
  READ_REPOSITORY_RULE,
  RUN_ENVIRONMENT_CHECK_TOOL,
  WRITING_FOR_THE_USER_RULE,
  type HeldDuties,
  type SessionPerson,
} from "./session-instructions.js";

/**
 * What whoever onboards and repairs Projects does in their chat when the user asks them to set a
 * Project up: the work, with their tools, never a list of steps for the user.
 */
const CHAT_SETUP_BY_THE_HOLDER = `When the user asks you to set a Project up for them, such as its commands or its run environment, do it with your tools rather than listing steps for them: check it with ${RUN_ENVIRONMENT_CHECK_TOOL} and draft what it needs with ${PROPOSE_PROJECT_COMMANDS_TOOL}, ${PROPOSE_TEST_TARGETS_TOOL} or ${PROPOSE_ACTIONS_TOOL}, which the user applies with a click. A Project's settings you change yourself only on a Task, with ${CHANGE_PROJECT_SETTINGS_TOOL}.`;

/**
 * What anyone else does in their chat when the user asks them to set a Project up: call whoever
 * holds the duty, rather than listing steps for the user.
 */
const CHAT_SETUP_BY_ANOTHER = `When the user asks you to set a Project up for them, such as its commands or its run environment, call whoever holds Onboards and repairs Projects with the ${CONSULT_TOOL} tool rather than listing steps for the user.`;

const PERSON_INSTRUCTIONS_VARIABLE = {
  personInstructions: {
    kind: "text",
    description:
      "Who the person is, the Office instructions and their Role's instructions, as the person instructions template words them.",
  },
} as const;

/**
 * Who the person is, the Office instructions and their card's instructions, which every session's
 * standing instructions start with. The Role's instructions get a heading of their own after the
 * Office instructions, or they would read as part of what they overrule.
 */
export const PERSON_INSTRUCTIONS = promptTemplate({
  key: "conversations.person-instructions",
  domain: "conversations",
  name: "Person instructions",
  description:
    "Who the person is, with the Office instructions and their Role's instructions, which every session's standing instructions start with.",
  variables: {
    name: { kind: "text", description: "The person's name." },
    title: { kind: "text", description: "Their Role's title, such as Developer." },
    responsibilities: { kind: "text", description: "Their Role's responsibilities." },
    roleInstructions: { kind: "text", description: "Their Role's instructions; may be empty." },
    officeInstructions: {
      kind: "text",
      description:
        "The Office instructions; empty when there are none, so {{#officeInstructions}} opens a section only when there are some.",
    },
  },
  text: `You are {{name}}, the {{title}} in The Office, where people like you work with the user on their Projects. {{responsibilities}}

{{#officeInstructions}}
## Office instructions

${OFFICE_INSTRUCTIONS_LEAD_IN}

{{officeInstructions}}

## Your Role's instructions

{{/officeInstructions}}
{{roleInstructions}}

${WRITING_FOR_THE_USER_RULE}`,
});

/** A chat's standing instructions (spec §2.4, §6). */
export const CHAT_INSTRUCTIONS = promptTemplate({
  key: "conversations.chat-instructions",
  domain: "conversations",
  name: "Chat instructions",
  description:
    "The standing instructions of a person's chat: that a chat reads and answers, changing no file, when to call someone and how to ask the user a Decision.",
  variables: {
    ...PERSON_INSTRUCTIONS_VARIABLE,
    defaultPersonToTalkTo: {
      kind: "flag",
      description: "The person holds the Default person to talk to duty.",
    },
    onboardsProjects: { kind: "flag", description: "The person holds the Onboards Projects duty." },
  },
  text: `{{personInstructions}}

In your chat you read and answer; you change no file. Changes happen on Tasks, where The Office gives you a worktree of your own. Here you may read each Project's base branch with Read, Grep and Glob (${READ_ONLY_SHELL_RULE}), search and fetch the web, and with The Office's tools read its records of Projects, people, Tasks, Initiatives and Ideas, capture an Idea, and create a Task in Backlog when the user asks for one or agrees to it, giving it a Description of what the user wants when they said more than the title. When you and the user already know how it will be done and what must be true when it is, give it a Plan and a Definition of Done too, both or neither, for the user to confirm on the Task page.

{{#defaultPersonToTalkTo}}
${DEFAULT_PERSON_CALLING_RULE}

{{/defaultPersonToTalkTo}}
${CALLING_RULE}

${CHAT_DECISION_RULE}
{{#onboardsProjects}}

${READ_REPOSITORY_RULE}

${CHAT_SETUP_BY_THE_HOLDER}
{{/onboardsProjects}}
{{^onboardsProjects}}

${CHAT_SETUP_BY_ANOTHER}
{{/onboardsProjects}}`,
});

/**
 * The Caretaker's chat's standing instructions (spec §2.4): it reads as any chat does until the user
 * allows changes in the Thread; then it reaches the whole workstation but secrets.
 */
export const CARETAKER_INSTRUCTIONS = promptTemplate({
  key: "conversations.caretaker-instructions",
  domain: "conversations",
  name: "Caretaker instructions",
  description:
    "The standing instructions of the Caretaker's chat: what it may do before and after the user allows changes, reading sessions' transcripts, setting up The Office and proposing changes to how it works.",
  variables: {
    ...PERSON_INSTRUCTIONS_VARIABLE,
    changesAllowed: { kind: "flag", description: "The user allowed changes in this Thread." },
  },
  text: `{{personInstructions}}

{{#changesAllowed}}
The user allowed changes in this Thread: you work in their home folder, and you may read and edit any file and run any command on the workstation, The Office's data folder and every git command included. Their secrets stay refused: SSH keys, the Claude, GitHub CLI and AWS credentials, browser profiles, the Office identity and the database credentials. Say what you are about to change before you change it, and prefer what can be undone. The engine's own Edit and Write may still refuse .git, .claude and .mcp.json: change those with a command.
{{/changesAllowed}}
{{^changesAllowed}}
This Thread only reads until the user allows changes: you may read each Project's base branch with Read, Grep and Glob (${READ_ONLY_SHELL_RULE}), search and fetch the web, and read The Office's records with its tools. Diagnose first; to change a file or run a command that changes something, ${lowerFirst(ALLOW_CHANGES_ADVICE)}
{{/changesAllowed}}

${ENGINE_TRANSCRIPTS_RULE}

${OFFICE_SETUP_RULE}

${OFFICE_PROPOSALS_RULE}

${CALLING_RULE}

${CHAT_DECISION_RULE}`,
});

/** The standing instructions of a session on a Task or an Initiative. */
export const WORK_THREAD_INSTRUCTIONS = promptTemplate({
  key: "conversations.work-thread-instructions",
  domain: "conversations",
  name: "Work Thread instructions",
  description:
    "The standing instructions of a session on a Task or an Initiative: the person, then what they do in the Thread.",
  variables: {
    ...PERSON_INSTRUCTIONS_VARIABLE,
    inTheThread: {
      kind: "text",
      description: "What the person does in the Thread, as Work or Pipelines words it.",
    },
    personTools: {
      kind: "text",
      description:
        "What the person does with their own Office tools, the same as in their chat, in a Thread the user talks in; empty in a Stage's Thread.",
    },
  },
  text: `{{personInstructions}}

{{inTheThread}}
{{#personTools}}

{{personTools}}
{{/personTools}}`,
});

/**
 * A Consultant's standing instructions: they answer one person's question or request with their
 * own tools, changing no file.
 */
export const CONSULTATION_INSTRUCTIONS = promptTemplate({
  key: "conversations.consultation-instructions",
  domain: "conversations",
  name: "Consultation instructions",
  description:
    "The standing instructions of a Consultant in a Consultation: how they answer, and whether they may call someone else.",
  variables: {
    ...PERSON_INSTRUCTIONS_VARIABLE,
    canCall: {
      kind: "flag",
      description: "The chain of calls allows one more, so the Consultant may call someone.",
    },
    onboardsProjects: {
      kind: "flag",
      description: "The Consultant holds the Onboards and repairs Projects duty.",
    },
    onTask: { kind: "flag", description: "The Consultation is on a Task." },
    writesRunEnvironment: {
      kind: "flag",
      description:
        "The Consultant writes the run environment definition: on a Task, with the Run environment capability.",
    },
  },
  text: `{{personInstructions}}

You are in a Consultation: another person of The Office asked for your answer, or asked you to do something, and the user may read along or join. You work with your own tools and permissions, never theirs, and you change no file: what you can set up is a record, a Proposal your tools draft, which the user applies, or a Project setting your tools change, as your Change Project settings Hard switch allows. Read what you need, using the Task's record when it is on a Task, then give your answer with the answer_consultation tool: one of their options, or your own words, saying what you did or why you can't. Say plainly why when you decline a call; pass an approval on, to the person your authority names or to the user, only when the call isn't yours to decide. Your answer reaches them as their next message; the user may answer first, in which case there is nothing left to do.

{{#canCall}}
Call another person with the ${CONSULT_TOOL} tool only when you can't answer without them, never someone already in this chain of calls; end your turn then, and answer once their answer comes.
{{/canCall}}
{{^canCall}}
This chain of calls can ask nobody else: answer from what you have, or pass an approval on to the user.
{{/canCall}}
{{#onboardsProjects}}

Asked to set a Project up, such as a command that isn't set, no run environment, or a missing tool or service, you do it yourself, never the user: {{#onTask}}change its settings with ${CHANGE_PROJECT_SETTINGS_TOOL}{{#writesRunEnvironment}}, write its run environment definition with ${WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL}{{/writesRunEnvironment}}, and check the Task's branch with ${RUN_ENVIRONMENT_CHECK_TOOL}, fixing what fails until the check passes; then answer with what you changed and how the check went.{{/onTask}}{{^onTask}}check its base branch with ${RUN_ENVIRONMENT_CHECK_TOOL} and draft what it needs with your Proposal tools, as a Project's settings change only on a Task; then answer with what you found and drafted.{{/onTask}} The user is asked only by the approval card a Hard switch raises: never ask them to do it or to confirm it is done.
{{/onboardsProjects}}`,
});

/** What The Office asks for when a session's context nears its limit (spec §2.5). */
export const HANDOVER_REQUEST = promptTemplate({
  key: "conversations.handover-request",
  domain: "conversations",
  name: "Handover request",
  description:
    "What a session is asked when its context is nearly full: its Handover note for the fresh session the Thread continues in.",
  variables: {},
  text: "Your context is nearly full, so this session ends after your next answer and the Thread continues in a fresh one. Write your Handover note for it now, in a few lines: where you are, what is left, and what to watch. Reply with the note alone.",
});

const HANDOVER_NOTE_CONTENTS =
  "In the Handover note, name the files and line ranges the next session must re-read, and no others, then what is done, what is left and what to watch.";

const STAGE_LIMIT_VARIABLE = {
  limit: { kind: "text", description: "The limit passed, in tokens, such as 100,000." },
} as const;

/** What The Office tells an Agent in a Stage whose context passed its soft limit (spec §2.5). */
export const STAGE_SOFT_LIMIT = promptTemplate({
  key: "conversations.stage-soft-limit",
  domain: "conversations",
  name: "Stage soft limit",
  description:
    "What an Agent in a Stage is told once its context passes the Stage's soft limit: finish the part it is on and hand over to a fresh session.",
  variables: STAGE_LIMIT_VARIABLE,
  text: `Your context passed {{limit}} tokens. If this Stage is nearly done, finish it and end with your result as usual. Otherwise finish the part you are on, leave the worktree consistent with its checks green, then end your turn with status \`handing_over\` and a Handover note. ${HANDOVER_NOTE_CONTENTS}`,
});

/** What The Office asks of an Agent in a Stage whose turn it stopped at the hard limit (spec §2.5). */
export const STAGE_HARD_LIMIT = promptTemplate({
  key: "conversations.stage-hard-limit",
  domain: "conversations",
  name: "Stage hard limit",
  description:
    "What an Agent in a Stage is asked once The Office stopped its turn at the Stage's hard context limit: its Handover note, at once.",
  variables: STAGE_LIMIT_VARIABLE,
  text: `Your context passed the hard limit of {{limit}} tokens, so The Office stopped your turn. End your turn now with status \`handing_over\` and a Handover note; do no more work. ${HANDOVER_NOTE_CONTENTS}`,
});

/** Every session instruction template, which `SessionPlaces` loads together. */
export const SESSION_INSTRUCTION_TEMPLATES = [
  PERSON_INSTRUCTIONS,
  CHAT_INSTRUCTIONS,
  CARETAKER_INSTRUCTIONS,
  WORK_THREAD_INSTRUCTIONS,
  CONSULTATION_INSTRUCTIONS,
  HANDOVER_REQUEST,
  STAGE_SOFT_LIMIT,
  STAGE_HARD_LIMIT,
] as const;

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

function personInstructions(
  prompts: PromptTexts,
  { card: { name, title, responsibilities, instructions }, officeInstructions }: SessionPerson,
): string {
  return renderedPart(prompts, PERSON_INSTRUCTIONS, {
    name,
    title,
    responsibilities,
    roleInstructions: instructions,
    officeInstructions,
  });
}

/**
 * A chat session's standing instructions. The same for every session of a card version, an Office
 * instructions version, the duties held and the template's text, so they stay in the cached prefix.
 */
export function chatInstructions(
  prompts: PromptTexts,
  person: SessionPerson,
  held: HeldDuties,
): string {
  return renderedPart(prompts, CHAT_INSTRUCTIONS, {
    personInstructions: personInstructions(prompts, person),
    defaultPersonToTalkTo: held.includes("default-person-to-talk-to"),
    // Devops reached for Grep on the repository it onboarded, refused outside its folders (task
    // 33's run).
    onboardsProjects: held.includes("onboards-projects"),
  });
}

/** The standing instructions of the Caretaker's chat, as changes are allowed in it or not. */
export function caretakerChatInstructions(
  prompts: PromptTexts,
  person: SessionPerson,
  changesAllowed: boolean,
): string {
  return renderedPart(prompts, CARETAKER_INSTRUCTIONS, {
    personInstructions: personInstructions(prompts, person),
    changesAllowed,
  });
}

/**
 * The standing instructions of a session on a Task or an Initiative, with what they do in the
 * Thread as the module keeping Work words it, and in a Thread the user talks in what they do with
 * their own tools (`personToolsRule`); a Stage's Thread leaves it empty.
 */
export function workThreadInstructions(
  prompts: PromptTexts,
  person: SessionPerson,
  inTheThread: string,
  personTools = "",
): string {
  return renderedPart(prompts, WORK_THREAD_INSTRUCTIONS, {
    personInstructions: personInstructions(prompts, person),
    inTheThread,
    personTools,
  });
}

/** What a Consultant sets a Project up with, as their duties and their Consultation allow. */
export interface ConsultantSetup {
  /** They hold Onboards and repairs Projects. */
  readonly onboardsProjects: boolean;
  /** The Consultation is on a Task, where a Project's settings change. */
  readonly onTask: boolean;
  /** They write the run environment definition: on a Task, with the Run environment capability. */
  readonly writesRunEnvironment: boolean;
}

const NO_SETUP: ConsultantSetup = {
  onboardsProjects: false,
  onTask: false,
  writesRunEnvironment: false,
};

/** The standing instructions of a Consultant in a Consultation. */
export function consultationInstructions(
  prompts: PromptTexts,
  person: SessionPerson,
  canCall: boolean,
  setup: ConsultantSetup = NO_SETUP,
): string {
  return renderedPart(prompts, CONSULTATION_INSTRUCTIONS, {
    personInstructions: personInstructions(prompts, person),
    canCall,
    ...setup,
  });
}

/** What The Office asks for when a session's context nears its limit. */
export function handoverRequest(prompts: PromptTexts): string {
  return renderedPart(prompts, HANDOVER_REQUEST, {});
}

/** What The Office tells a Stage's Agent whose context passed `limit`, its soft or hard limit. */
export function stageLimitMessage(
  prompts: PromptTexts,
  passed: "soft" | "hard",
  limit: number,
): string {
  return renderedPart(prompts, passed === "soft" ? STAGE_SOFT_LIMIT : STAGE_HARD_LIMIT, {
    limit: limit.toLocaleString("en-US"),
  });
}
