import { READ_ONLY_SHELL_RULE } from "../../engine/index.js";
import { DEVOPS, OFFICE_MANAGER } from "../../people/index.js";
import { answerWords, type Decision, type DecisionAnswer } from "./decision.js";

/** The parts of a Role card a session's standing instructions come from. */
export interface SessionPersonCard {
  readonly name: string;
  readonly title: string;
  readonly responsibilities: string;
  readonly instructions: string;
}

/**
 * A chat session's standing instructions: who the person is, their card's instructions, and that a
 * chat only reads (spec §2.4, §6). The same for every session of a card version, so they stay in
 * the cached prefix.
 */
export function chatInstructions(card: SessionPersonCard, roleKey: string): string {
  return [
    ...personInstructions(card),
    `In your chat you read and answer; you change no file. Changes happen on Tasks, where The Office gives you a worktree of your own. Here you may read each Project's base branch with Read, Grep and Glob (${READ_ONLY_SHELL_RULE}), search and fetch the web, and with The Office's tools read its records of Projects, people, Tasks, Initiatives and Ideas, capture an Idea, and create a Task in Backlog when the user asks for one or agrees to it.`,
    // Devops reached for Grep on the repository it onboarded, refused outside its folders (task 33's run).
    ...(roleKey === DEVOPS ? [READ_LOCAL_REPOSITORY_RULE] : []),
  ].join("\n\n");
}

/**
 * The standing instructions of a session on a Task or an Initiative: who the person is, their
 * card's instructions, and what they do in the Thread, as the module keeping Work words it.
 */
export function workThreadInstructions(card: SessionPersonCard, inTheThread: string): string {
  return [...personInstructions(card), inTheThread].join("\n\n");
}

function personInstructions({
  name,
  title,
  responsibilities,
  instructions,
}: SessionPersonCard): string[] {
  return [
    `You are ${name}, the ${title} in The Office, where people like you work with the user on their Projects. ${responsibilities}`,
    instructions,
  ];
}

/**
 * The Office tool anyone drafts a written skill with in their chat (spec §2.6); the contracts name
 * it too, for the web to hide its activity line, and a test keeps the two the same.
 */
export const PROPOSE_SKILL_TOOL = "propose_skill";

/**
 * The Office tools a chat session works with records by (spec §6), as the Projects, People and Work
 * modules register them, and Conversations `propose_skill`: they read records, capture an Idea,
 * create a Task and draft a skill as a Proposal, and change no file.
 */
export const CHAT_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "read_initiative",
  "list_ideas",
  "read_idea",
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
export const READ_LOCAL_REPOSITORY_TOOL = "read_local_repository";

const READ_LOCAL_REPOSITORY_RULE = `A repository that is not a Project yet lies outside your folders: Read, Grep, Glob and the shell are refused there. Read it only with ${READ_LOCAL_REPOSITORY_TOOL}, its top level first, then each folder you need with its folder argument. A repository on a host, such as GitHub, is read by its Repository URL in place of a path, without cloning it.`;

/**
 * A chat's Office tools for the Role's person: the Office Manager doesn't turn work into Tasks but
 * points to the Planner, so it never creates one; it drafts Roles and Office settings as Proposals
 * the user applies, points the user to whoever is responsible with a Link card, and shows the
 * Office status (ticket 06). Anyone else has their Role's own tools besides, and Devops, onboarding a
 * Project from their chat, reads its repository before it has a base branch to read.
 */
export function chatOfficeTools(roleKey: string): readonly string[] {
  return roleKey === OFFICE_MANAGER
    ? [
        ...CHAT_OFFICE_TOOLS.filter((name) => name !== "create_task"),
        PROPOSE_ROLE_TOOL,
        PROPOSE_OFFICE_SETTING_TOOL,
        POST_LINK_CARD_TOOL,
        SHOW_OFFICE_STATUS_TOOL,
      ]
    : [
        ...CHAT_OFFICE_TOOLS,
        ...roleOfficeTools(roleKey),
        ...(roleKey === DEVOPS ? [READ_LOCAL_REPOSITORY_TOOL] : []),
      ];
}

/**
 * The Office tools a Role's person has in their chat and their Stage Threads alike, for what the
 * Role looks after: Devops reads the Pipeline library, proposes Project commands and library
 * Pipelines, drafts a Project to onboard, and installs and updates skills from a Source (spec
 * §2.1, §2.2, §2.3, §2.6).
 */
export function roleOfficeTools(roleKey: string): readonly string[] {
  return roleKey === DEVOPS
    ? [
        LIST_PIPELINES_TOOL,
        PROPOSE_PROJECT_COMMANDS_TOOL,
        PROPOSE_LIBRARY_PIPELINE_TOOL,
        PROPOSE_PROJECT_TOOL,
        LIST_SOURCE_SKILLS_TOOL,
        PROPOSE_SKILL_INSTALL_TOOL,
        READ_SKILL_UPDATE_TOOL,
        PROPOSE_SKILL_UPDATE_TOOL,
      ]
    : [];
}

/**
 * The Office tool a Consultant answers with; the contracts name it too, for the web to hide its
 * activity line, and a test keeps the two the same.
 */
export const ANSWER_CONSULTATION_TOOL = "answer_consultation";

/**
 * The Office tools a Consultant works a Consultation with: they read the records the Task rests on
 * and give their answer. They open no Decision and consult no one, so a Consultation never nests.
 */
export const CONSULTATION_OFFICE_TOOLS = [
  "list_projects",
  "list_people",
  "list_tasks",
  "read_task",
  "list_ideas",
  "read_idea",
  ANSWER_CONSULTATION_TOOL,
] as const;

/**
 * The standing instructions of a Consultant in a Consultation: who they are, their card's
 * instructions, and that they answer one Agent's question on a Task, reading and changing nothing.
 */
export function consultationInstructions(card: SessionPersonCard): string {
  return [
    ...personInstructions(card),
    "You are in a Consultation: another person of The Office, working a Task, asked for your answer, and the user may read along or join. You change no file. Read what you need, using the Task's record, then give your answer with the answer_consultation tool: one of their options, or your own words. Say plainly why when you decline a call; pass an approval on, to the person your authority names or to the user, only when the call isn't yours to decide. Your answer reaches them as their next message; the user may answer first, in which case there is nothing left to do.",
  ].join("\n\n");
}

/** The Office tool an Agent writes a Memory note with; offered only while its Shared memory is on. */
export const REMEMBER_TOOL = "remember";

/** The Office tool an Agent rewords a Role with; it sits behind the Change Roles Hard switch. */
export const CHANGE_ROLE_TOOL = "change_role";

/**
 * The Office tools a session gets: its place's; `remember` when its card has Shared memory; and
 * `change_role` on a Task, where a held call has a Thread to wait in, unless its Change Roles is
 * Never.
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
    ...(onTask && hardSwitches.changeRoles.kind !== "never" ? [CHANGE_ROLE_TOOL] : []),
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
 * `answerer` names the Consultant who answered; undefined when the user did.
 */
export function decisionAnswerMessage(
  decision: Decision,
  answer: DecisionAnswer,
  answerer = "The user",
): string {
  const words = answerWords(decision, answer);
  return answer.kind === "option"
    ? `${answerer} answered your Decision "${decision.question}" with the option "${words}".`
    : `${answerer} answered your Decision "${decision.question}" in their own words:\n\n${words}`;
}
