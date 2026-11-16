import { READ_ONLY_SHELL_RULE, WRITE_RUN_ENVIRONMENT_DEFINITION_TOOL } from "../../engine/index.js";
import type { DutyKey } from "../../people/index.js";
import {
  decisionSummary,
  formAnswerWords,
  isApproval,
  type Answerer,
  type Decision,
  type DecisionAnswer,
} from "./decision.js";
import { sameUser, userWords, userWordsOpening, type UserRef } from "./user.js";

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

/** The duties a Role's person holds as their session starts, which decide its built-in tools. */
export type HeldDuties = readonly DutyKey[];

/** The only duties a session's built-in tools and instructions depend on. */
export const SESSION_SHAPING_DUTIES: readonly DutyKey[] = [
  "default-person-to-talk-to",
  "shapes-initiatives",
  "onboards-projects",
];

/**
 * A chat session's standing instructions: who the person is, the Office instructions, their card's
 * instructions, and that a chat only reads (spec §2.4, §6). The same for every session of a card
 * version, an Office instructions version and the duties held, so they stay in the cached prefix.
 */
export function chatInstructions(person: SessionPerson, held: HeldDuties): string {
  return [
    ...personInstructions(person),
    `In your chat you read and answer; you change no file. Changes happen on Tasks, where The Office gives you a worktree of your own. Here you may read each Project's base branch with Read, Grep and Glob (${READ_ONLY_SHELL_RULE}), search and fetch the web, and with The Office's tools read its records of Projects, people, Tasks, Initiatives and Ideas, capture an Idea, and create a Task in Backlog when the user asks for one or agrees to it, giving it a Description of what the user wants when they said more than the title. When you and the user already know how it will be done and what must be true when it is, give it a Plan and a Definition of Done too, both or neither, for the user to confirm on the Task page.`,
    ...(held.includes("default-person-to-talk-to") ? [DEFAULT_PERSON_CALLING_RULE] : []),
    CALLING_RULE,
    CHAT_DECISION_RULE,
    // Devops reached for Grep on the repository it onboarded, refused outside its folders (task
    // 33's run).
    ...(held.includes("onboards-projects") ? [READ_REPOSITORY_RULE] : []),
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
export const CALLING_RULE = `Call another person of The Office with the ${CONSULT_TOOL} tool only when the user asks you to, such as "ask a colleague to set that up", or your authority says to consult them first. A request asks them to do what you can't; they work with their own tools and permissions, never yours, and answer in their own words. End your turn once you called: their answer comes as your next message, and you tell the user.`;

/**
 * The Office tool a person opens a Decision with (spec §2.4); the contracts name it too, and a test
 * keeps the two the same.
 */
export const OPEN_DECISION_TOOL = "open_decision";

/**
 * When a person asks the user a Decision form in their chat (spec §2.4, §2.7): it shows inline
 * there, and its answer comes as their next message. Follows `CALLING_RULE` in every chat.
 */
export const CHAT_DECISION_RULE = `When you need the user's choice, or several answers, before you go on, ask them with the ${OPEN_DECISION_TOOL} tool: everything in one form, which shows inline in this chat, then end your turn. Their answer comes as your next message. A simple question can still go in your reply.`;

/**
 * The Default person to talk to calls someone only when the user asks (spec §2.2): otherwise they
 * still point the user to whoever is responsible rather than relay the work.
 */
const DEFAULT_PERSON_CALLING_RULE =
  "You point the user to whoever is responsible with a Link card rather than relay their work or answer for someone else; call a person yourself only when the user asks you to.";

/**
 * What a refusal tells the Caretaker while their Thread only reads (spec §2.4): allowing changes
 * is the user's call, never the Agent's.
 */
export const ALLOW_CHANGES_ADVICE =
  "Say what you would change and why, and ask the user to Allow changes in this Thread.";

/**
 * The Office tool the Caretaker drafts the set-up of The Office with: its hires and duties as one
 * Proposal (spec §2.2); the contracts name it too, for the web to hide its activity line, and a
 * test keeps the two the same.
 */
export const PROPOSE_OFFICE_SETUP_TOOL = "propose_office_setup";

/**
 * How the Caretaker sets up The Office (spec §2.2, "Setting up an Office with nobody hired"). The
 * same whether changes are allowed or not, so the cached prefix stays.
 */
const OFFICE_SETUP_RULE = `Setting up The Office: when list_people shows nobody hired but you, offer to set The Office up. Ask what the user works on, then recommend whom to hire: presets, saying the duties and capabilities each brings, or Roles from scratch for what no preset covers. Draft them with ${PROPOSE_OFFICE_SETUP_TOOL}, as one Proposal the user applies with a click. A hired preset holds its own duties with no assignment: assign a duty only to give it to a Role other than its preset's, such as a Role from scratch. You may draft a set-up at any time the user asks, and you never hire anyone or change a duty yourself.`;

/**
 * Where the Caretaker finds a session's transcript, to diagnose a Thread (spec §6, the user's answer
 * of 2026-11-14): readable raw whether changes are allowed or not, but for the engines' accounts.
 * The same in both modes, so the cached prefix stays.
 */
export const ENGINE_TRANSCRIPTS_RULE =
  "Reading a session's transcript, to find out what a Thread's session did: each Claude Code engine keeps its sessions' transcripts in The Office's data folder (OFFICE_DATA_DIR; by default %LOCALAPPDATA%\\the-office on Windows and ~/.local/share/the-office on Linux), as engines/<engine id>/projects/<session folder>/<session id>.jsonl, one JSON event per line. You read them with Read, Grep and Glob whether changes are allowed or not. Search inside an engine's projects/ folder, such as with Glob **/<session id>.jsonl there: engines/ and an engine's folder named whole hold its account and stay refused. The service log names each Thread's session as it starts or resumes, with its session id and its engine id. The OpenAI-compatible API engine's conversations aren't readable.";

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
    ENGINE_TRANSCRIPTS_RULE,
    OFFICE_SETUP_RULE,
    CALLING_RULE,
    CHAT_DECISION_RULE,
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

/**
 * How every session writes what the user reads (spec §2.4): records as links to their pages, which
 * the web shows as chips or opens in the app, and text to copy in a code block, which has Copy.
 * The paths are the web's, as contracts' `recordPath` builds them.
 */
export const WRITING_FOR_THE_USER_RULE =
  "When you mention a Task, Initiative, Idea or Project to the user, write it as a Markdown link to its page with its full ID, never a shortened one: `[title](/tasks/<id>)`, `[name](/work/initiatives/<id>)`, `[title](/work/ideas?idea=<id>)`, `[name](/projects/<id>)`. Put text the user is meant to copy, such as a message, a command or a passage you propose, in a fenced code block: it has a Copy button.";

function personInstructions({
  card: { name, title, responsibilities, instructions },
  officeInstructions,
}: SessionPerson): string[] {
  const whoTheyAre = `You are ${name}, the ${title} in The Office, where people like you work with the user on their Projects. ${responsibilities}`;
  if (officeInstructions === "") return [whoTheyAre, instructions, WRITING_FOR_THE_USER_RULE];
  return [
    whoTheyAre,
    `## Office instructions\n\n${OFFICE_INSTRUCTIONS_LEAD_IN}\n\n${officeInstructions}`,
    // Closes the section above, or the Role's words would read as part of what they overrule.
    `## Your Role's instructions\n\n${instructions}`,
    WRITING_FOR_THE_USER_RULE,
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
 * output and an Agent Stage run's Stage Thread messages, which Pipelines registers. Agent Stages
 * get it too, beside `READING_OFFICE_TOOLS` (Pipelines' `AGENT_STAGE_OFFICE_TOOLS`), but planning
 * sessions and Initiative Threads don't.
 */
export const READ_STAGE_HISTORY_TOOL = "read_stage_history";

/**
 * The Office tool a person reads Thread messages with, from The Office's log, by a range and
 * filters (spec 2.4). An Agent Stage doesn't get it: it reads Thread messages only through a run's
 * Stage Thread, with `read_stage_history`.
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
 * history, asks the user a Decision form inline in the chat, answers a Decision for the user when
 * they ask, captures an Idea, creates a Task and drafts a skill as a Proposal (Conversations'
 * `propose_skill`), and changes no file.
 */
export const CHAT_OFFICE_TOOLS = [
  ...PERSON_READING_OFFICE_TOOLS,
  OPEN_DECISION_TOOL,
  ANSWER_DECISION_TOOL,
  "capture_idea",
  "create_task",
  PROPOSE_SKILL_TOOL,
] as const;

/**
 * The Office tool the Default person to talk to drafts a Proposal of a Role with; the contracts
 * name it too, for the web to hide its activity line, and a test keeps the two the same.
 */
export const PROPOSE_ROLE_TOOL = "propose_role";

/**
 * The Office tool the Default person to talk to drafts a Proposal of an Office setting with, named
 * as above.
 */
export const PROPOSE_OFFICE_SETTING_TOOL = "propose_office_setting";

/**
 * The Office tool the Default person to talk to reads the Office instructions with before drafting
 * a change: their session holds the version it started with, and a draft of an old copy would undo
 * an edit.
 */
export const READ_OFFICE_INSTRUCTIONS_TOOL = "read_office_instructions";

/**
 * The Office tool the Default person to talk to points the user to someone with, a Link card; named
 * as above.
 */
export const POST_LINK_CARD_TOOL = "post_link_card";

/**
 * The Office tool the Default person to talk to shows the Office status with, which Notifications
 * registers.
 */
export const SHOW_OFFICE_STATUS_TOOL = "show_office_status";

/**
 * The Office tool whoever onboards Projects drafts a Proposal of a Project's commands with; named
 * as above.
 */
export const PROPOSE_PROJECT_COMMANDS_TOOL = "propose_project_commands";

/**
 * The Office tool whoever onboards Projects drafts a Proposal of a library Pipeline's Stages with,
 * which Pipelines registers.
 */
export const PROPOSE_LIBRARY_PIPELINE_TOOL = "propose_library_pipeline";

/**
 * The Office tool whoever onboards Projects drafts a Proposal of a Project Pipeline with; named as
 * above.
 */
export const PROPOSE_PROJECT_PIPELINE_TOOL = "propose_project_pipeline";

/**
 * The Office tool whoever onboards Projects drafts a Project to onboard with, which Work registers;
 * named as above.
 */
export const PROPOSE_PROJECT_TOOL = "propose_project";

/**
 * The Office tool whoever onboards Projects reads the Pipelines with, the office-wide ones and the
 * Project Pipelines, which Pipelines registers.
 */
export const LIST_PIPELINES_TOOL = "list_pipelines";

/**
 * The Office tool whoever onboards Projects reads the Stage templates with, which Pipelines
 * registers.
 */
export const LIST_STAGE_TEMPLATES_TOOL = "list_stage_templates";

/**
 * The Office tool whoever onboards Projects drafts a Proposal of a Stage template's Stage with;
 * named as above.
 */
export const PROPOSE_STAGE_TEMPLATE_TOOL = "propose_stage_template";

/** The Office tool whoever onboards Projects reads the skills a Source holds with. */
export const LIST_SOURCE_SKILLS_TOOL = "list_source_skills";

/**
 * The Office tool whoever onboards Projects drafts installing a skill from a Source with; named as
 * above.
 */
export const PROPOSE_SKILL_INSTALL_TOOL = "propose_skill_install";

/**
 * The Office tool whoever onboards Projects reads an installed skill's update with: its versions
 * and its diff.
 */
export const READ_SKILL_UPDATE_TOOL = "read_skill_update";

/**
 * The Office tool whoever onboards Projects drafts an installed skill's update with; named as
 * above.
 */
export const PROPOSE_SKILL_UPDATE_TOOL = "propose_skill_update";

/**
 * The Office tool whoever onboards Projects reads a repository with before it is a Project, on the
 * workstation by its path or on a host by its Repository URL, which Projects registers: its
 * branches, and the names and manifest files of one folder at a time.
 */
export const READ_REPOSITORY_TOOL = "read_repository";

const READ_REPOSITORY_RULE = `A repository that is not a Project yet lies outside your folders: Read, Grep, Glob and the shell are refused there. Read it only with ${READ_REPOSITORY_TOOL}, its top level first, then each folder you need with its folder argument. A repository on a host, such as GitHub, is read by its Repository URL in place of a path, without cloning it, and onboarded by that URL: The Office clones it when the user applies the Proposal.`;

/**
 * The Office tool whoever shapes Initiatives and the Default person to talk to create an Initiative
 * with in their chat, when the user asks (spec §2.1), which Work registers; no other person and no
 * other session has it.
 */
export const CREATE_INITIATIVE_TOOL = "create_initiative";

/** The Office tools the Default person to talk to has in their chat besides. */
const DEFAULT_PERSON_OFFICE_TOOLS = [
  PROPOSE_ROLE_TOOL,
  PROPOSE_OFFICE_SETTING_TOOL,
  READ_OFFICE_INSTRUCTIONS_TOOL,
  POST_LINK_CARD_TOOL,
  SHOW_OFFICE_STATUS_TOOL,
] as const;

/**
 * A chat's Office tools for a person, by the duties they hold (spec §2.2): the Default person to
 * talk to doesn't turn work into Tasks but points to whoever plans, so never creates one, though
 * they may create an Initiative, for whoever shapes Initiatives to shape into Tasks; they draft
 * Roles and Office settings as Proposals the user applies, point the user to whoever is
 * responsible with a Link card, and show the Office status (ticket 06); they redirect with a Link
 * card and never relay, calling a person only when the user asks, as anyone else does (spec
 * §2.2). Each has their duties' own tools besides: whoever shapes Initiatives creates an
 * Initiative too, in their chat only. The Caretaker holds no duty, so has only the chat's own and
 * `caretakerChatOfficeTools`' set-up.
 */
export function chatOfficeTools(held: HeldDuties): readonly string[] {
  const defaultPerson = held.includes("default-person-to-talk-to");
  return [
    ...(defaultPerson
      ? CHAT_OFFICE_TOOLS.filter((name) => name !== "create_task")
      : CHAT_OFFICE_TOOLS),
    ...draftingOfficeTools(held),
    ...(defaultPerson || held.includes("shapes-initiatives") ? [CREATE_INITIATIVE_TOOL] : []),
    ...(defaultPerson ? DEFAULT_PERSON_OFFICE_TOOLS : []),
    CONSULT_TOOL,
  ];
}

/**
 * The Caretaker's chat's Office tools: the chat's own for the duties they hold, and drafting the
 * set-up of The Office, its hires and duties as one Proposal (spec §2.2), but no other Proposal of
 * a Role.
 */
export function caretakerChatOfficeTools(held: HeldDuties): readonly string[] {
  return [...chatOfficeTools(held), PROPOSE_OFFICE_SETUP_TOOL];
}

/**
 * The tools a person drafts records and Proposals with beyond the chat's own, which they bring to a
 * Consultation too: their duties', and the reading of a repository before it has a base branch to
 * read, for whoever onboards a Project.
 */
function draftingOfficeTools(held: HeldDuties): readonly string[] {
  return [
    ...roleOfficeTools(held),
    ...(held.includes("onboards-projects") ? [READ_REPOSITORY_TOOL] : []),
  ];
}

/**
 * The Office tools a person has in their chat and their Stage Threads alike, for the duties they
 * hold: whoever onboards and repairs Projects reads the Pipelines, proposes Project commands,
 * library Pipelines, Project Pipelines and Stage templates, drafts a Project to onboard, and
 * installs and updates skills from a Source (spec §2.1, §2.2, §2.3, §2.6).
 */
export function roleOfficeTools(held: HeldDuties): readonly string[] {
  return held.includes("onboards-projects")
    ? [
        LIST_PIPELINES_TOOL,
        PROPOSE_PROJECT_COMMANDS_TOOL,
        PROPOSE_LIBRARY_PIPELINE_TOOL,
        PROPOSE_PROJECT_PIPELINE_TOOL,
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
 * drafts (an Idea, a Task in Backlog, a skill and their duties' Proposals), which the user applies.
 * They call someone themselves while the chain of calls allows one more (`canCall`); they open no
 * Decision of their own and change no file.
 */
export function consultationOfficeTools(held: HeldDuties, canCall: boolean): readonly string[] {
  return [
    ...PERSON_READING_OFFICE_TOOLS,
    ANSWER_CONSULTATION_TOOL,
    "capture_idea",
    "create_task",
    PROPOSE_SKILL_TOOL,
    ...draftingOfficeTools(held),
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

/**
 * The Office tool an Agent writes a Memory note with; offered only while its Shared memory is on.
 */
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

/**
 * The first message of a session started with a Brief: the Brief, then the message, under a heading
 * naming the user who wrote it; The Office's message of answered Decisions (`writtenBy` undefined)
 * names who answered in its words.
 */
export function briefedMessage(
  brief: string,
  said: string,
  writtenBy: UserRef | undefined,
): string {
  const heading = writtenBy ? userMessageHeading(writtenBy) : "## The user's message";
  return `${brief}\n\n${heading}\n\n${said}`;
}

/**
 * The Brief of a session that starts on a skill command (spec §2.4): the command follows as its
 * own message, as written, with no heading, so the Brief ends saying it comes and who sends it.
 */
export function briefBeforeSkillCommand(brief: string, writtenBy: UserRef): string {
  return `${brief}\n\n${userWordsOpening(writtenBy)}'s skill command follows as the next message.`;
}

/**
 * A user's message into a running or resumed session: as written after one from the same user, or
 * under a heading naming them when another user wrote the one before it, or nobody did, so the
 * person knows who writes now. `previous` is who wrote the Thread's user message before it.
 */
export function messageFromUser(
  said: string,
  writtenBy: UserRef,
  previous: UserRef | null | undefined,
): string {
  return previous !== undefined && sameUser(previous, writtenBy)
    ? said
    : `${userMessageHeading(writtenBy)}\n\n${said}`;
}

function userMessageHeading(writtenBy: UserRef): string {
  return `## The message from ${userWords(writtenBy)}`;
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
 * What the asking session is sent as its next message when its Decision is answered (spec §2.4):
 * who answered (the user by name, the Consultant, the person who answered for the user at their
 * request, or The Office), then every question with its answer and comment and the general
 * comment, so a fresh session knows what was asked; or that they asked again, with the general
 * comment, or that The Office sent a call from a chat back, saying why. An approval keeps its one
 * line.
 */
export function decisionAnswerMessage(
  decision: Decision,
  answer: DecisionAnswer,
  answerer: Answerer,
): string {
  if (answer.kind === "asked-again") {
    const comment = answer.generalComment?.trim();
    if (answerer.kind === "the-office") {
      // A call from a chat sent back to its caller: the comment says why and what to do.
      return `The Office sent your Decision back to you, answering none of its questions: ${comment ?? ""}`;
    }
    return [
      `${askedAgainWords(answerer)}, answering none of your Decision's questions:`,
      comment ? `General comment: ${comment}` : "They gave no comment.",
      "Answer what they said, then open a new Decision for what you still need to ask.",
    ].join("\n\n");
  }
  if (isApproval(decision)) {
    const asked = `your Decision "${decisionSummary(decision)}"`;
    return `${answeredWords(answerer, asked)} with the option "${formAnswerWords(decision, answer)}".`;
  }
  const asked = decision.kind === "request" ? "your request" : "your Decision";
  return `${answeredWords(answerer, asked)}:\n\n${formAnswerWords(decision, answer)}`;
}

function askedAgainWords(answerer: Answerer): string {
  switch (answerer.kind) {
    case "user":
      return `${userWordsOpening(answerer.user)} asked you to ask again`;
    case "consultant":
      return `${answerer.name} asked you to ask again`;
    case "the-office":
      return "The Office asked you to ask again";
    case "at-users-request":
      return `${answerer.name} asked you to ask again for ${userWords(answerer.user)}, at their request`;
  }
}

function answeredWords(answerer: Answerer, asked: string): string {
  switch (answerer.kind) {
    case "user":
      return `${userWordsOpening(answerer.user)} answered ${asked}`;
    case "consultant":
      return `${answerer.name} answered ${asked}`;
    case "the-office":
      return `The Office answered ${asked}`;
    case "at-users-request":
      return `${answerer.name} answered ${asked} for ${userWords(answerer.user)}, at their request`;
  }
}

/** A Decision answered in an Initiative's planning Thread, with the title of the Task it is on. */
export interface AnsweredOnTask {
  readonly decision: Decision;
  readonly answer: DecisionAnswer;
  /** Undefined for a Task no longer found, named by its id alone. */
  readonly taskTitle: string | undefined;
  /** Who answered: the user, or the person who answered for them at their request. */
  readonly answerer: Answerer;
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
