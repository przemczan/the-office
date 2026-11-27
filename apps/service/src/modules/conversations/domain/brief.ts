import { flagField, renderedPart, type PromptTexts } from "../../prompt-templates/index.js";
import {
  BRIEF_ANSWERED_DECISIONS,
  BRIEF_LATEST_EXCHANGES,
  BRIEF_MEMORY,
  BRIEF_OFFICE_TOOLS,
  BRIEF_OPEN_DECISION,
  BRIEF_OPEN_DECISION_ON_INITIATIVE,
  BRIEF_PROJECTS,
  FRESH_CHAT_THREAD_BRIEF,
  FRESH_PERSONS_THREAD_BRIEF,
  INITIATIVE_THREAD_BRIEF,
  NEW_CHAT_THREAD_BRIEF,
  TASK_THREAD_BRIEF,
} from "./brief-templates.js";
import {
  decisionSummary,
  formAnswerWords,
  questionAnswerWords,
  type Decision,
  type DecisionAnswer,
  type DecisionQuestion,
} from "./decision.js";
import type { Message } from "./message.js";
import { userWordsOpening } from "./user.js";

/**
 * What a new session is given to pick up work (spec §2.5), assembled from the record with no model
 * call: never a transcript.
 */
export interface Brief {
  readonly text: string;
  /** Estimated, for the Thread's label and the Context policy's costs. */
  readonly tokens: number;
}

/**
 * A Project as a session reads it, checked out read-only: its base branch, or on an Initiative, the
 * Initiative's branch.
 */
export interface BriefProject {
  readonly projectId: string;
  readonly name: string;
  readonly baseBranch: string;
  /** Where the session reads it. */
  readonly folder: string;
  /**
   * The Initiative's branch a session on an Initiative reads in this Project, `gone` once it was
   * deleted here, so the base branch is read instead; undefined where it reads the base branch.
   */
  readonly initiativeBranch?: { readonly branch: string; readonly gone: boolean };
}

/** About as much of a chat Thread's log as a Brief carries (spec §9). */
export const CHAT_EXCHANGES_TOKENS = 3_000;

/** About as much of a person's Memory as a Brief carries (spec 2.2). */
export const MEMORY_TOKENS = 2_000;

/** Characters per token, the usual estimate for English text and code. */
const CHARACTERS_PER_TOKEN = 4;

export function estimatedTokens(text: string): number {
  return Math.ceil(text.length / CHARACTERS_PER_TOKEN);
}

/** A Memory note as a Brief reads it. */
export interface BriefMemoryNote {
  readonly text: string;
  /** The Project the note is about; undefined when it holds for all of them. */
  readonly projectId: string | undefined;
  readonly writtenAt: Date;
}

/** The part of a person's Memory a Brief carries: the notes that fit, oldest first. */
export interface BriefMemory {
  readonly lines: readonly string[];
  /** How many older notes the cap left out. */
  readonly leftOut: number;
}

export const NO_MEMORY: BriefMemory = { lines: [], leftOut: 0 };

/**
 * Which of a person's notes a Brief reads: on a Task, those for all Projects and its Project's; on
 * an Initiative, those for all Projects; in a chat, which reads every Project, every note, each
 * labelled with what it is about.
 */
export type MemoryReach =
  | { readonly kind: "project"; readonly projectId: string }
  | { readonly kind: "all-projects" }
  | { readonly kind: "every-note"; readonly projects: readonly BriefProject[] };

/** The label the Memory tab groups a note for all Projects under. */
const ALL_PROJECTS = "All Projects";

/**
 * The notes `reach` reads, the newest that fit under the cap: older ones are dropped, never
 * summarised, since no model call builds a Brief.
 */
export function selectMemory(notes: readonly BriefMemoryNote[], reach: MemoryReach): BriefMemory {
  const relevant = notes
    .filter((note) => isInReach(note, reach))
    .toSorted((first, second) => second.writtenAt.getTime() - first.writtenAt.getTime());
  const lines: string[] = [];
  let room = MEMORY_TOKENS * CHARACTERS_PER_TOKEN;
  for (const note of relevant) {
    const line = `- ${note.writtenAt.toISOString().slice(0, 10)}${aboutLabel(note, reach)}: ${note.text}`;
    if (line.length > room) break;
    lines.push(line);
    room -= line.length;
  }
  return { lines: lines.toReversed(), leftOut: relevant.length - lines.length };
}

function isInReach(note: BriefMemoryNote, reach: MemoryReach): boolean {
  switch (reach.kind) {
    case "every-note":
      return true;
    case "all-projects":
      return note.projectId === undefined;
    case "project":
      return note.projectId === undefined || note.projectId === reach.projectId;
  }
}

/** What the note is about, where a Brief reads the notes of more than one Project. */
function aboutLabel(note: BriefMemoryNote, reach: MemoryReach): string {
  if (reach.kind !== "every-note") return "";
  if (note.projectId === undefined) return ` (${ALL_PROJECTS})`;
  const project = reach.projects.find(({ projectId }) => projectId === note.projectId);
  return ` (${project?.name ?? note.projectId})`;
}

/**
 * A new chat Thread's Brief: your Memory and where the Projects are, before the user's first
 * message.
 */
export function newChatThreadBrief(
  prompts: PromptTexts,
  projects: readonly BriefProject[],
  memory: BriefMemory,
): Brief {
  return briefOf(
    renderedPart(prompts, NEW_CHAT_THREAD_BRIEF, {
      memory: memoryPart(prompts, memory),
      projects: projectsPart(prompts, projects),
    }),
  );
}

/** What a fresh session's Brief carries of the Thread it continues. */
interface FreshThread {
  readonly title: string | undefined;
  /** The Thread's log so far, oldest first. */
  readonly log: readonly Message[];
  /** The ids of the Attachments of images its messages carried that are gone since. */
  readonly removedImages?: ReadonlySet<string>;
  readonly memory: BriefMemory;
}

/**
 * A chat Thread's Brief when it continues in a fresh session (spec §9): its title, the person's
 * latest Handover note, and its last exchanges, newest kept, capped at about 3k tokens.
 */
export function freshChatThreadBrief(
  prompts: PromptTexts,
  thread: FreshThread & { readonly projects: readonly BriefProject[] },
): Brief {
  return briefOf(
    renderedPart(prompts, FRESH_CHAT_THREAD_BRIEF, {
      ...freshThreadValues(prompts, thread),
      projects: projectsPart(prompts, thread.projects),
    }),
  );
}

/**
 * A person's Thread on a Task's Brief when it continues in a fresh session (spec §2.5): as a chat's,
 * from the Thread alone. The record was the first session's, and the session reads the Task's
 * worktree, so no Project is listed.
 */
export function freshPersonsThreadBrief(prompts: PromptTexts, thread: FreshThread): Brief {
  return briefOf(
    renderedPart(prompts, FRESH_PERSONS_THREAD_BRIEF, freshThreadValues(prompts, thread)),
  );
}

function freshThreadValues(
  prompts: PromptTexts,
  { title, log, removedImages = NO_REMOVED_IMAGES, memory }: FreshThread,
) {
  const note = log.findLast((message) => message.kind === "handover-note");
  return {
    hasTitle: title !== undefined,
    title: title ?? "",
    hasHandoverNote: note !== undefined,
    handoverNote: note?.text ?? "",
    latestExchanges: latestExchangesPart(prompts, log, removedImages),
    memory: memoryPart(prompts, memory),
  };
}

/** What a Brief for a Thread on a Task is assembled from. */
export interface TaskThreadRecord {
  /** The Task's record, as the module keeping Tasks words it. */
  readonly record: string;
  /** The Thread continues in a fresh session, after one before it. */
  readonly continuing: boolean;
  /** The Decisions on the Task the user answered, in any of its Threads, in the order answered. */
  readonly answered: readonly Decision[];
  /** The Decision this Thread waits on the user for, if any. */
  readonly open: Decision | undefined;
  /** The person's Memory notes for the Task's Project. */
  readonly memory: BriefMemory;
}

/**
 * A Brief for a Thread on a Task: the Task's record, its answered Decisions and the one the Thread
 * waits on, and, when the Thread continues in a fresh session, that the earlier context is gone.
 * Unlike a chat's, it carries none of the Thread's exchanges: a Task's record holds what was
 * settled (spec §2.5).
 */
export function taskThreadBrief(
  prompts: PromptTexts,
  { record, continuing, answered, open, memory }: TaskThreadRecord,
): Brief {
  return briefOf(
    renderedPart(prompts, TASK_THREAD_BRIEF, {
      continuing,
      record,
      memory: memoryPart(prompts, memory),
      answeredDecisions: answeredDecisionsPart(prompts, answered),
      openDecision:
        open === undefined
          ? ""
          : renderedPart(prompts, BRIEF_OPEN_DECISION, { questions: openQuestions(open) }),
    }),
  );
}

/** What a Brief for a Thread on an Initiative is assembled from. */
export interface InitiativeThreadRecord {
  /** The Initiative's record, as the module keeping Initiatives words it. */
  readonly record: string;
  /** The Thread continues in a fresh session, after one before it. */
  readonly continuing: boolean;
  /** The person's Memory notes that hold for every Project, since an Initiative spans them. */
  readonly memory: BriefMemory;
  readonly projects: readonly BriefProject[];
  /** The Decision on no Task, on the Initiative as a whole, this Thread waits on, if any. */
  readonly open?: Decision | undefined;
}

/**
 * A Brief for a Thread on an Initiative: its record and where the Projects are, and, when the
 * Thread continues in a fresh session, that the earlier context is gone. Like a Task's, it carries
 * none of the Thread's exchanges: what was settled is on the Initiative (spec §2.5).
 */
export function initiativeThreadBrief(
  prompts: PromptTexts,
  { record, continuing, memory, projects, open }: InitiativeThreadRecord,
): Brief {
  return briefOf(
    renderedPart(prompts, INITIATIVE_THREAD_BRIEF, {
      continuing,
      record,
      memory: memoryPart(prompts, memory),
      projects: projectsPart(prompts, projects),
      openDecision: open === undefined ? "" : openOnInitiativePart(prompts, open),
    }),
  );
}

/**
 * The Brief's part for the Decision on no Task an Initiative's Thread waits on (spec §2.4): what
 * was asked, that it waits on its answer and isn't asked again, and that the answer comes as a
 * message in the Thread.
 */
function openOnInitiativePart(prompts: PromptTexts, decision: Decision): string {
  return renderedPart(prompts, BRIEF_OPEN_DECISION_ON_INITIATIVE, {
    questions: openQuestions(decision),
    whom: decision.putTo === undefined ? "the user" : `the person in the Role ${decision.putTo}`,
  });
}

/** Empty when there is no note to carry and none was left out. */
function memoryPart(prompts: PromptTexts, { lines, leftOut }: BriefMemory): string {
  if (lines.length === 0 && leftOut === 0) return "";
  return renderedPart(prompts, BRIEF_MEMORY, {
    lines,
    // "0" would open the section: a template reads only an empty text as false.
    leftOut: leftOut === 0 ? "" : String(leftOut),
    oneLeftOut: leftOut === 1,
  });
}

/** Empty when the user answered none of `decisions`. */
function answeredDecisionsPart(prompts: PromptTexts, decisions: readonly Decision[]): string {
  const entries = decisions.flatMap((decision) =>
    decision.answer ? [answeredEntry(decision, decision.answer)] : [],
  );
  if (entries.length === 0) return "";
  return renderedPart(prompts, BRIEF_ANSWERED_DECISIONS, { decisions: entries });
}

/**
 * An answered Decision's lines: its question with the answer under it when it asked one, each
 * question numbered with its answer when it asked several.
 */
function answeredEntry(decision: Decision, answer: DecisionAnswer): string {
  const [only, ...others] = decision.questions;
  if (only === undefined || others.length > 0 || answer.kind !== "submitted") {
    return `- ${decisionSummary(decision)}\n${indented(formAnswerWords(decision, answer))}`;
  }
  const lines: string[] = [];
  const given = answer.answers[0];
  if (given !== undefined) {
    const words = questionAnswerWords(only, given);
    lines.push(
      given.kind === "words" ? `Answer, in their own words: ${words}` : `Answer: ${words}`,
    );
    const comment = given.comment?.trim();
    if (comment) lines.push(`Comment: ${comment}`);
  }
  const general = answer.generalComment?.trim();
  if (general) lines.push("", `General comment: ${general}`);
  return `- ${only.question}\n${indented(lines.join("\n"))}`;
}

/** Every line of `text` under its Decision's line, blank lines kept blank. */
function indented(text: string): string {
  return text
    .split("\n")
    .map((line) => (line === "" ? line : `  ${line}`))
    .join("\n");
}

/** The open Decision's questions, numbered, each with a choice's options. */
function openQuestions({ questions }: Decision) {
  return questions.map((question: DecisionQuestion, index) => ({
    number: String(index + 1),
    question: question.question,
    first: flagField(index === 0),
    openQuestion: flagField(question.kind === "open"),
    optionLines:
      question.kind === "open" ? "" : question.options.map((option) => `   - ${option}`).join("\n"),
  }));
}

/** The Brief's line naming the knowledge base's index, at its path in the install. */
export function knowledgeBaseLine(index: string): string {
  return `The Office's knowledge base, about The Office itself, starts at its index, ${index}. It is read-only.`;
}

/**
 * `brief` led by the line naming the knowledge base's index, on every engine; as it is when the
 * install has no knowledge base.
 */
export function withKnowledgeBase(brief: Brief, index: string | undefined): Brief {
  if (index === undefined) return brief;
  return briefOf(`${knowledgeBaseLine(index)}\n\n${brief.text}`);
}

/** The Office tools a session reaches on demand, of one area. */
export interface BriefToolArea {
  readonly area: string;
  readonly tools: readonly string[];
}

/** How a session reaches the Office tools it isn't started with. */
export interface BriefOfficeTools {
  /** `deferred`: ToolSearch loads a tool by name; `pair`: `list_office_tools` and `call_office_tool`. */
  readonly loading: "deferred" | "pair";
  /** The areas besides Core whose tools are loaded from the start. */
  readonly homeAreas: readonly string[];
  readonly others: readonly BriefToolArea[];
}

/** The name Claude Code gives an Office tool, which ToolSearch's `select:` takes. */
const DEFERRED_TOOL_PREFIX = "mcp__office__";

/**
 * `brief` followed by the loaded areas and the other areas' tools with how to load them; as it is
 * when no tool is left to reach (an Agent Stage's Brief lists none).
 */
export function withOfficeToolAreas(
  prompts: PromptTexts,
  brief: Brief,
  { loading, homeAreas, others }: BriefOfficeTools,
): Brief {
  if (others.length === 0) return brief;
  const part = renderedPart(prompts, BRIEF_OFFICE_TOOLS, {
    loadedAreas: ["core", ...homeAreas].join(", "),
    toolSearch: loading === "deferred",
    areas: others.map(({ area, tools }) => ({
      area,
      tools: tools
        .map((name) => (loading === "deferred" ? `${DEFERRED_TOOL_PREFIX}${name}` : name))
        .join(", "),
    })),
  });
  return briefOf(`${brief.text.trimEnd()}\n\n${part}`);
}

const NO_REMOVED_IMAGES: ReadonlySet<string> = new Set();

function briefOf(text: string): Brief {
  return { text, tokens: estimatedTokens(text) };
}

function projectsPart(prompts: PromptTexts, projects: readonly BriefProject[]): string {
  return renderedPart(prompts, BRIEF_PROJECTS, {
    hasProjects: projects.length > 0,
    readsInitiativeBranch: projects.some(
      ({ initiativeBranch }) => initiativeBranch?.gone === false,
    ),
    projects: projects.map(({ name, baseBranch, folder, initiativeBranch }) => ({
      name,
      baseBranch,
      folder,
      initiativeBranch: initiativeBranch?.branch ?? "",
      onInitiativeBranch: flagField(initiativeBranch?.gone === false),
      initiativeBranchGone: flagField(initiativeBranch?.gone === true),
    })),
  });
}

/**
 * The users' messages, each naming who wrote it, and the person's, the newest that fit under the
 * cap, oldest first; empty when there are none.
 */
function latestExchangesPart(
  prompts: PromptTexts,
  log: readonly Message[],
  removedImages: ReadonlySet<string>,
): string {
  const lines: string[] = [];
  let room = CHAT_EXCHANGES_TOKENS * CHARACTERS_PER_TOKEN;
  let withImages = false;
  for (const message of log.toReversed()) {
    if (message.kind !== "user" && message.kind !== "person") continue;
    const images = message.kind === "user" ? (message.images ?? []) : [];
    const imageLines = images.map(({ attachmentId, name }) =>
      removedImages.has(attachmentId)
        ? "Image removed"
        : `image ${name} · Attachment ${attachmentId}`,
    );
    const line = [
      `${message.kind === "user" ? userWordsOpening(message.writtenBy) : "You"}: ${message.text}`,
      ...imageLines,
    ].join("\n");
    if (line.length > room) {
      // The newest message alone over the cap keeps its end, which the conversation went on from.
      if (lines.length === 0) lines.push(`…${line.slice(line.length - room + 1)}`);
      break;
    }
    lines.push(line);
    room -= line.length;
    withImages ||= images.some(({ attachmentId }) => !removedImages.has(attachmentId));
  }
  if (lines.length === 0) return "";
  return renderedPart(prompts, BRIEF_LATEST_EXCHANGES, {
    exchanges: lines.toReversed().map((text, index) => ({ text, first: flagField(index === 0) })),
    readImages: withImages,
  });
}
