import { READ_ONLY_SHELL_RULE, WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL } from "../../engine/index.js";
import { DEVOPS, OFFICE_MANAGER } from "../../people/index.js";
import { answerWords, type Answerer, type Decision, type DecisionAnswer } from "./decision.js";

/** The parts of a Role card a session's standing instructions come from. */
interface SessionPersonCard {
  readonly name: string;
  readonly title: string;
  readonly responsibilities: string;
  readonly instructions: string;
}

/** Who a session is for: the person's card, and the Office instructions' text it runs with. */
export interface SessionPerson {
  readonly card: SessionPersonCard;
  /** Empty when there are none. */
  readonly officeInstructions: string;
}

/**
 * A chat session's standing instructions: who the person is, the Office instructions, their card's
 * instructions, and that a chat only reads (spec §2.4, §6). The same for every session of a card
 * version and an Office instructions version, so they stay in the cached prefix.
 */
export function chatInstructions(person: SessionPerson, roleKey: string): string {
  return [
    ...personInstructions(person),
    `In your chat you read and answer; you change no file. Changes happen on Tasks, where The Office gives you a worktree of your own. Here you may read each Project's base branch with Read, Grep and Glob (${READ_ONLY_SHELL_RULE}), search and fetch the web, and with The Office's tools read its records of Projects, people, Tasks, Initiatives and Ideas, capture an Idea, and create a Task in Backlog when the user asks for one or agrees to it, giving it a Description of what the user wants when they said more than the title. When you and the user already know how it will be done and what must be true when it is, give it a Plan and a Definition of Done too, both or neither, for the user to confirm on the Task page.`,
    ...(roleKey === OFFICE_MANAGER ? [] : [CALLING_RULE]),
    // Devops reached for Grep on the repository it onboarded, refused outside its folders (task 33's run).
    ...(roleKey === DEVOPS ? [READ_REPOSITORY_RULE] : []),
  ].join("\n\n");
}

/**
 * The Office tool a person consults or calls another with (spec §2.2); the contracts name it too,
 * and a test keeps the two the same.
 */
export const CONSULT_TOOL = "consult";

/**
 * When a person the user talks to calls someone (spec §2.2, §2.4): only when the user asks, or
 * their authority says to consult that person first. Work's Thread on a Task and Planning Thread
 * say the same.
 */
export const CALLING_RULE = `Call another person of The Office with the ${CONSULT_TOOL} tool only when the user asks you to, such as "ask Devops to set that up", or your authority says to consult them first. A request asks them to do what you can't; they work with their own tools and permissions, never yours, and answer in their own words. End your turn once you called: their answer comes as your next message, and you tell the user.`;

/**
 * What a refusal tells the Caretaker while their Thread only reads (spec §2.4): allowing changes
 * is the user's call, never the Agent's.
 */
export const ALLOW_CHANGES_ADVICE =
  "Say what you would change and why, and ask the user to Allow changes in this Thread.";

/**
 * The standing instructions of the Caretaker's chat (spec §2.4): it reads as any chat does until
 * the user allows changes in the Thread; then it reaches the whole workstation but secrets.
 */
export function caretakerChatInstructions(person: SessionPerson, changesAllowed: boolean): string {
  return [
    ...personInstructions(person),
    changesAllowed
      ? "The user allowed changes in this Thread: you work in their home folder, and you may read and edit any file and run any command on the workstation, The Office's data folder and every git command included. Their secrets stay refused: SSH keys, the Claude, GitHub CLI and AWS credentials, browser profiles, the Office identity and the database credentials. Say what you are about to change before you change it, and prefer what can be undone. The engine's own Edit and Write may still refuse .git, .claude and .mcp.json: change those with a command."
      : `This Thread only reads until the user allows changes: you may read each Project's base branch with Read, Grep and Glob (${READ_ONLY_SHELL_RULE}), search and fetch the web, and read The Office's records with its tools. Diagnose first; to change a file or run a command that changes something, ${lowerFirst(ALLOW_CHANGES_ADVICE)}`,
    CALLING_RULE,
  ].join("\n\n");
}

function lowerFirst(text: string): string {
  return text.charAt(0).toLowerCase() + text.slice(1);
}

/**
 * The standing instructions of a session on a Task or an Initiative: who the person is, the Office
 * instructions, their card's instructions, and what they do in the Thread, as the module keeping
 * Work words it.
 */
export function workThreadInstructions(person: SessionPerson, inTheThread: string): string {
  return [...personInstructions(person), inTheThread].join("\n\n");
}

/**
 * Fixed words, so the cached prefix changes only with the text. "A Project's own" holds for a
 * session with no single Project too, such as a chat.
 */
const OFFICE_INSTRUCTIONS_LEAD_IN =
  "The user's general guidelines for everyone in The Office. Where they disagree, your Role's instructions and a Project's own CLAUDE.md win.";

function personInstructions({
  card: { name, title, responsibilities, instructions },
  officeInstructions,
}: SessionPerson): string[] {
  const whoTheyAre = `You are ${name}, the ${title} in The Office, where people like you work with the user on their Projects. ${responsibilities}`;
  if (officeInstructions === "") return [whoTheyAre, instructions];
  return [
    whoTheyAre,
    `## Office instructions\n\n${OFFICE_INSTRUCTIONS_LEAD_IN}\n\n${officeInstructions}`,
    // Closes the section above, or the Role's words would read as part of what they overrule.
    `## Your Role's instructions\n\n${instructions}`,
  ];
}

/**
 * The Office tool anyone drafts a written skill with in their chat (spec §2.6); the contracts name
 * it too, for the web to hide its activity line, and a test keeps the two the same.
 */
export const PROPOSE_SKILL_TOOL = "propose_skill";

/**
 * The Office tool that reads a Role's whole card, which People registers: whoever drafts a change
 * gives each field whole, and their session's copy of the card may be old or lack the instructions.
 */
export const READ_ROLE_TOOL = "read_role";

/**
 * The Office tools every session reads The Office's records with (spec §6), Agent Stages included:
 * Projects, people and their Roles, and every Task, Idea and Initiative, the links between them and
 * all their Attachments, as the Projects, People and Work modules register them. Each session's
 * list starts from these and adds only its own writing tools.
 */
export const READING_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  READ_ROLE_TOOL,
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
  "read_initiative",
  "read_attachment",
] as const;

/**
 * The Office tool a person reads a Task's Stage history with, each run and its Project commands'
 * output, which Pipelines registers. An Agent Stage doesn't get it: its Brief carries what it needs
 * of earlier runs.
 */
export const READ_STAGE_HISTORY_TOOL = "read_stage_history";

/**
 * The Office tool a person reads Thread messages with, from The Office's log, by a range and
 * filters (spec 2.4). An Agent Stage doesn't get it, as with `read_stage_history`.
 */
export const READ_THREADS_TOOL = "read_threads";

/**
 * The Office tools a person's session reads records with, in their chat, their Thread on a Task
 * and a Consultation: every record, and a Task's Stage history and the Threads' messages besides.
 */
export const PERSON_READING_OFFICE_TOOLS = [
  ...READING_OFFICE_TOOLS,
  READ_STAGE_HISTORY_TOOL,
  READ_THREADS_TOOL,
] as const;

/**
 * The Office tool a person answers a Decision waiting on the user with, for the user, when the user
 * asks them to in a Thread they talk in (spec §2.4): a chat, a person's Thread on a Task, the
 * Planner's and an Initiative's Threads, never a Stage Thread or a Consultation. The contracts name
 * it too, and a test keeps the two the same.
 */
export const ANSWER_DECISION_TOOL = "answer_decision";

/**
 * The Office tools a chat session works with (spec §6): it reads every record and a Task's Stage
 * history, answers a Decision for the user when they ask, captures an Idea, creates a Task and
 * drafts a skill as a Proposal (Conversations' `propose_skill`), and changes no file.
 */
export const CHAT_OFFICE_TOOLS = [
  ...PERSON_READING_OFFICE_TOOLS,
  ANSWER_DECISION_TOOL,
  "capture_idea",
  "create_task",
  PROPOSE_SKILL_TOOL,
] as const;

/**
 * The Office tool the Office Manager drafts a Proposal of a Role with; the contracts name it too,
 * for the web to hide its activity line, and a test keeps the two the same.
 */
export const PROPOSE_ROLE_TOOL = "propose_role";

/** The Office tool the Office Manager drafts a Proposal of an Office setting with, named as above. */
export const PROPOSE_OFFICE_SETTING_TOOL = "propose_office_setting";

/**
 * The Office tool the Office Manager reads the Office instructions with before drafting a change:
 * their session holds the version it started with, and a draft of an old copy would undo an edit.
 */
export const READ_OFFICE_INSTRUCTIONS_TOOL = "read_office_instructions";

/** The Office tool the Office Manager points the user to someone with, a Link card; named as above. */
export const POST_LINK_CARD_TOOL = "post_link_card";

/** The Office tool the Office Manager shows the Office status with, which Notifications registers. */
export const SHOW_OFFICE_STATUS_TOOL = "show_office_status";

/** The Office tool Devops drafts a Proposal of a Project's commands with; named as above. */
export const PROPOSE_PROJECT_COMMANDS_TOOL = "propose_project_commands";

/** The Office tool Devops drafts a Proposal of a library Pipeline's Stages with, which Pipelines registers. */
export const PROPOSE_LIBRARY_PIPELINE_TOOL = "propose_library_pipeline";

/** The Office tool Devops drafts a Project to onboard with, which Work registers; named as above. */
export const PROPOSE_PROJECT_TOOL = "propose_project";

/** The Office tool Devops reads the Pipeline library with, which Pipelines registers. */
export const LIST_PIPELINES_TOOL = "list_pipelines";

/** The Office tool Devops reads the Stage templates with, which Pipelines registers. */
export const LIST_STAGE_TEMPLATES_TOOL = "list_stage_templates";

/** The Office tool Devops drafts a Proposal of a Stage template's Stage with; named as above. */
export const PROPOSE_STAGE_TEMPLATE_TOOL = "propose_stage_template";

/** The Office tool Devops reads the skills a Source holds with. */
export const LIST_SOURCE_SKILLS_TOOL = "list_source_skills";

/** The Office tool Devops drafts installing a skill from a Source with; named as above. */
export const PROPOSE_SKILL_INSTALL_TOOL = "propose_skill_install";

/** The Office tool Devops reads an installed skill's update with: its versions and its diff. */
export const READ_SKILL_UPDATE_TOOL = "read_skill_update";

/** The Office tool Devops drafts an installed skill's update with; named as above. */
export const PROPOSE_SKILL_UPDATE_TOOL = "propose_skill_update";

/**
 * The Office tool Devops reads a repository with before it is a Project, on the workstation by its
 * path or on a host by its Repository URL, which Projects registers: its branches, and the names and
 * manifest files of one folder at a time.
 */
export const READ_REPOSITORY_TOOL = "read_repository";

const READ_REPOSITORY_RULE = `A repository that is not a Project yet lies outside your folders: Read, Grep, Glob and the shell are refused there. Read it only with ${READ_REPOSITORY_TOOL}, its top level first, then each folder you need with its folder argument. A repository on a host, such as GitHub, is read by its Repository URL in place of a path, without cloning it, and onboarded by that URL: The Office clones it when the user applies the Proposal.`;

/**
 * A chat's Office tools for the Role's person: the Office Manager doesn't turn work into Tasks but
 * points to the Planner, so it never creates one; it drafts Roles and Office settings as Proposals
 * the user applies, points the user to whoever is responsible with a Link card, and shows the
 * Office status (ticket 06); they redirect with a Link card and never relay, so they call no one.
 * Anyone else calls a person when the user asks (spec §2.2) and has their Role's own tools besides.
 */
export function chatOfficeTools(roleKey: string): readonly string[] {
  return roleKey === OFFICE_MANAGER
    ? [
        ...CHAT_OFFICE_TOOLS.filter((name) => name !== "create_task"),
        PROPOSE_ROLE_TOOL,
        PROPOSE_OFFICE_SETTING_TOOL,
        READ_OFFICE_INSTRUCTIONS_TOOL,
        POST_LINK_CARD_TOOL,
        SHOW_OFFICE_STATUS_TOOL,
      ]
    : [...CHAT_OFFICE_TOOLS, ...draftingOfficeTools(roleKey), CONSULT_TOOL];
}

/**
 * The tools a person drafts records and Proposals with beyond the chat's own, which they bring to a
 * Consultation too: their Role's, and Devops' reading of a repository before it has a base branch
 * to read, as they onboard a Project.
 */
function draftingOfficeTools(roleKey: string): readonly string[] {
  return [...roleOfficeTools(roleKey), ...(roleKey === DEVOPS ? [READ_REPOSITORY_TOOL] : [])];
}

/**
 * The Office tools a Role's person has in their chat and their Stage Threads alike, for what the
 * Role looks after: Devops reads the Pipeline library, proposes Project commands, library
 * Pipelines and Stage templates, drafts a Project to onboard, and installs and updates skills from
 * a Source (spec §2.1, §2.2, §2.3, §2.6).
 */
export function roleOfficeTools(roleKey: string): readonly string[] {
  return roleKey === DEVOPS
    ? [
        LIST_PIPELINES_TOOL,
        PROPOSE_PROJECT_COMMANDS_TOOL,
        PROPOSE_LIBRARY_PIPELINE_TOOL,
        LIST_STAGE_TEMPLATES_TOOL,
        PROPOSE_STAGE_TEMPLATE_TOOL,
        PROPOSE_PROJECT_TOOL,
        LIST_SOURCE_SKILLS_TOOL,
        PROPOSE_SKILL_INSTALL_TOOL,
        READ_SKILL_UPDATE_TOOL,
        PROPOSE_SKILL_UPDATE_TOOL,
      ]
    : [];
}

/**
 * The Office tools only an Agent Stage's session gets, as its card's capabilities say: the Run
 * environment capability writes the run environment definition, in the Task's worktree, which
 * Write and Edit can't reach (spec §2.2, §6). A chat, a Planning Thread or a Consultation has none.
 */
export function stageCapabilityOfficeTools(capabilities: {
  readonly runEnvironment: boolean;
}): readonly string[] {
  return capabilities.runEnvironment ? [WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL] : [];
}

/**
 * The Office tool a Consultant answers with; the contracts name it too, for the web to hide its
 * activity line, and a test keeps the two the same.
 */
export const ANSWER_CONSULTATION_TOOL = "answer_consultation";

/**
 * The Office tools a Consultant works a Consultation with: their own, never the asker's (spec §6).
 * They read every record and the Stage history, give their answer, and draft what their chat
 * drafts (an Idea, a Task in Backlog, a skill and their Role's Proposals), which the user applies.
 * They call someone themselves while the chain of calls allows one more (`canCall`); they open no
 * Decision of their own and change no file.
 */
export function consultationOfficeTools(roleKey: string, canCall: boolean): readonly string[] {
  return [
    ...PERSON_READING_OFFICE_TOOLS,
    ANSWER_CONSULTATION_TOOL,
    "capture_idea",
    "create_task",
    PROPOSE_SKILL_TOOL,
    ...draftingOfficeTools(roleKey),
    ...(canCall ? [CONSULT_TOOL] : []),
  ];
}

/**
 * The standing instructions of a Consultant in a Consultation: who they are, the Office
 * instructions, their card's instructions, and that they answer one person's question or request,
 * with their own tools, changing no file.
 */
export function consultationInstructions(person: SessionPerson, canCall: boolean): string {
  return [
    ...personInstructions(person),
    "You are in a Consultation: another person of The Office asked for your answer, or asked you to do something, and the user may read along or join. You work with your own tools and permissions, never theirs, and you change no file: what you can set up is a record or a Proposal your tools draft, which the user applies. Read what you need, using the Task's record when it is on a Task, then give your answer with the answer_consultation tool: one of their options, or your own words, saying what you did or why you can't. Say plainly why when you decline a call; pass an approval on, to the person your authority names or to the user, only when the call isn't yours to decide. Your answer reaches them as their next message; the user may answer first, in which case there is nothing left to do.",
    canCall
      ? `Call another person with the ${CONSULT_TOOL} tool only when you can't answer without them, never someone already in this chain of calls; end your turn then, and answer once their answer comes.`
      : "This chain of calls can ask nobody else: answer from what you have, or pass an approval on to the user.",
  ].join("\n\n");
}

/** The Office tool an Agent writes a Memory note with; offered only while its Shared memory is on. */
export const REMEMBER_TOOL = "remember";

/** The Office tool an Agent rewords a Role with; it sits behind the Change Roles Hard switch. */
export const CHANGE_ROLE_TOOL = "change_role";

/**
 * The Office tools a session gets: its place's; `remember` when its card has Shared memory; and
 * `change_role` on a Task, where a held call has a Thread to wait in, unless its Change Roles is
 * Never, with `read_role` to start the change from.
 */
export function sessionOfficeTools(
  placeTools: readonly string[],
  {
    capabilities,
    hardSwitches,
  }: {
    readonly capabilities: { readonly sharedMemory: boolean };
    readonly hardSwitches: { readonly changeRoles: { readonly kind: string } };
  },
  onTask: boolean,
): string[] {
  return [
    ...placeTools,
    ...(capabilities.sharedMemory ? [REMEMBER_TOOL] : []),
    ...(onTask && hardSwitches.changeRoles.kind !== "never"
      ? [CHANGE_ROLE_TOOL, ...(placeTools.includes(READ_ROLE_TOOL) ? [] : [READ_ROLE_TOOL])]
      : []),
  ];
}

/** What The Office asks for when a session's context nears its limit (spec §2.5). */
export const HANDOVER_REQUEST =
  "Your context is nearly full, so this session ends after your next answer and the Thread continues in a fresh one. Write your Handover note for it now, in a few lines: where you are, what is left, and what to watch. Reply with the note alone.";

/** The first message of a session started with a Brief: the Brief, then the user's message. */
export function briefedMessage(brief: string, said: string): string {
  return `${brief}\n\n## The user's message\n\n${said}`;
}

/** One of the Role's MCP servers a session doesn't get, with why, in the brief's words. */
export interface LeftOutServer {
  readonly name: string;
  readonly reason: string;
}

/**
 * A session's message, such as its Brief or the first one it is resumed with, led by the Role's
 * MCP servers it doesn't get, so the person knows their tools are missing (spec §5.4).
 */
export function withLeftOutServers(text: string, leftOut: readonly LeftOutServer[]): string {
  if (leftOut.length === 0) return text;
  const lines = leftOut.map(({ name, reason }) => `- ${name}: ${reason}`);
  return `## MCP servers left out\n\nThese MCP servers of your Role are not in this session, so their tools are missing:\n\n${lines.join("\n")}\n\n${text}`;
}

/**
 * The first message of a Thread The Office opens, such as a Task's planning Thread: the Brief,
 * then what The Office asks of the person, before the user has said anything.
 */
export function openingMessage(brief: string, opening: string): string {
  return `${brief}\n\n## What to do now\n\n${opening}`;
}

/**
 * What the asking session is sent as its next message when its Decision is answered: the question,
 * with the chosen option or the answerer's own words, so a fresh session knows what was asked.
 * `answerer` is the Consultant who answered, or the person who answered for the user at their
 * request; undefined when the user did.
 */
export function decisionAnswerMessage(
  decision: Decision,
  answer: DecisionAnswer,
  answerer?: Answerer,
): string {
  const words = answerWords(decision, answer);
  const asked =
    decision.kind === "request"
      ? `your request "${decision.question}"`
      : `your Decision "${decision.question}"`;
  const answered =
    answerer === undefined
      ? `The user answered ${asked}`
      : answerer.kind === "consultant"
        ? `${answerer.name} answered ${asked}`
        : answerer.kind === "the-office"
          ? `The Office answered ${asked}`
          : `${answerer.name} answered ${asked} for the user, at their request,`;
  return answer.kind === "option"
    ? `${answered} with the option "${words}".`
    : `${answered} in their own words:\n\n${words}`;
}

/** A Decision answered in an Initiative's planning Thread, with the title of the Task it is on. */
export interface AnsweredOnTask {
  readonly decision: Decision;
  readonly answer: DecisionAnswer;
  /** Undefined for a Task no longer found, named by its id alone. */
  readonly taskTitle: string | undefined;
  /** The person who answered for the user, at their request; undefined when the user did. */
  readonly answerer?: Answerer | undefined;
}

/**
 * What the planning session is sent when Decisions on the Initiative's Tasks are answered: every
 * answer, in the order given, each naming its Task, in one message (spec §2.4).
 */
export function decisionAnswersOnTasksMessage(answers: readonly AnsweredOnTask[]): string {
  return answers
    .map(
      ({ decision, answer, taskTitle, answerer }) =>
        `On the Task ${taskTitle === undefined ? "" : `"${taskTitle}" `}(${decision.taskId}): ${decisionAnswerMessage(decision, answer, answerer)}`,
    )
    .join("\n\n");
}
