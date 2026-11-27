import { usageWindowWords } from "../../engine/index.js";
import type { ContextMove, ContextReason } from "./context-policy.js";
import type { AtUsersRequest, DecisionAnswer } from "./decision.js";
import type { OpenPage } from "./open-page.js";
import type { StageContextLimit } from "./stage-context-limits.js";
import type { UserRef } from "./user.js";

/**
 * What The Office's log of a Thread holds, which is what the UI shows (spec §2.4): the engine's
 * transcript stays the engine's.
 */
export type Message = MessageFields & MessageDraft;

interface MessageFields {
  readonly id: string;
  readonly threadId: string;
  readonly at: Date;
}

/** A message by its kind and fields alone, before the log gives it its id, Thread and time. */
export type MessageDraft =
  | UserMessage
  | { readonly kind: "person"; readonly roleKey: string; readonly text: string }
  /** A few lines the person wrote for whoever continues, when The Office asked for them. */
  | { readonly kind: "handover-note"; readonly roleKey: string; readonly text: string }
  | ToolActivity
  | Refusal
  | McpServerNotStarted
  | DecisionCard
  | DecisionAnswerLine
  | ConsultationLine
  | ProposalCard
  | LinkCard
  | IdeaCard
  | OfficeStatusCard
  | ContextLine
  | ChangesAllowedLine
  | UsageWindowUsedUpLine
  | EngineSwitchedLine
  | ModelGaveWayLine
  | StageContextLimitLine
  | StageSessionRestartedLine
  | StageWorkClosing;

/**
 * What the user did themselves, which leaves them nothing new to read: anything else in a chat
 * comes from the person, or from The Office about their turn.
 */
export const USERS_OWN_MESSAGE_KINDS = [
  "user",
  "changes-allowed",
] as const satisfies readonly Message["kind"][];

/**
 * The Office's line in a Consultation (spec §2.4), so it shows the call as the asker's Thread does:
 * what was asked as it opens (`consultationAskedLine`), and the Consultant's answer once it reached
 * the asker (`consultationAnswerLine`).
 */
interface ConsultationLine {
  readonly kind: "consultation-line";
  readonly decisionId: string;
  readonly text: string;
}

/**
 * Who wrote the log's latest user message: null for one from before users existed, undefined when
 * the user wrote none.
 */
export function latestWriter(log: readonly Message[]): UserRef | null | undefined {
  return log.findLast((message): message is Message & UserMessage => message.kind === "user")
    ?.writtenBy;
}

/**
 * The user allowed changes in the Caretaker's Thread, or switched them off: The Office's line
 * (spec §2.4).
 */
interface ChangesAllowedLine {
  readonly kind: "changes-allowed";
  readonly allowed: boolean;
  /** The user who switched it; null on a line from before users existed. */
  readonly by: UserRef | null;
}

/**
 * The line a Stage's work in its Thread may close with: why the person couldn't answer, in the
 * engine's or The Office's words, or that the user held the Stage with Pause or Stop, or the fire
 * alarm held it, which is no failure (spec §2.4, §2.8). A failure closes a chat's turn too.
 */
export type StageWorkClosing =
  | { readonly kind: "failure"; readonly reason: string }
  | { readonly kind: "held"; readonly heldBy: HeldBy; readonly text: string };

/** Who stopped the person answering in a Thread, and how it ended their turn. */
export interface StoppedByUser {
  readonly by: UserRef;
  readonly personName: string;
  /** Their engine can't interrupt a turn, so the session ended instead. */
  readonly sessionEnded: boolean;
}

/**
 * The line a user's Stop leaves in a Thread they talk to a person in (spec §2.4.5), a held line
 * with `heldBy` "stop": "Ana stopped Pam.", and when the engine can't interrupt, that the session ended.
 */
export function stoppedByUserLine({
  by,
  personName,
  sessionEnded,
}: StoppedByUser): Extract<MessageDraft, { kind: "held" }> {
  const ended = sessionEnded
    ? " Their session ended, as their engine can't interrupt a turn: the next message starts a new one."
    : "";
  return { kind: "held", heldBy: "stop", text: `${by.name} stopped ${personName}.${ended}` };
}

/**
 * How a running Stage was held: by the user's Pause or Stop, by the fire alarm, or as its engine
 * refused a turn for a used-up usage window (spec 2.3).
 */
export type HeldBy = "pause" | "stop" | "alarm" | "usage-window";

/**
 * The engine refused the person's turn because a usage window of its account is used up (spec 2.4):
 * The Office's line, a notice rather than a failure. The window by the port's name, its reset as an
 * ISO time, as the log is kept as JSON.
 */
export interface UsageWindowUsedUpLine {
  readonly kind: "usage-window-used-up";
  readonly engineName: string;
  readonly window: string;
  readonly resetsAt: string;
}

/** "Claude Code's 5-hour window is used up until 2026-11-13 14:00 UTC", the line in words. */
export function usageWindowUsedUpWords({
  engineName,
  window,
  resetsAt,
}: Omit<UsageWindowUsedUpLine, "kind">): string {
  return `${engineName}'s ${usageWindowWords(window)} is used up until ${resetsAt.slice(0, 10)} ${resetsAt.slice(11, 16)} UTC.`;
}

/**
 * A model a level of the model and effort cascade set isn't offered by the engine the session landed
 * on, so the person works with the engine's default (spec §5.4.5): The Office's line, written as the
 * session starts. The engine by its name then.
 */
export interface ModelGaveWayLine {
  readonly kind: "model-gave-way";
  readonly personName: string;
  /** The engine's default model, which the session works with. */
  readonly model: string;
  readonly engineName: string;
  /** The model the cascade set, which the engine doesn't offer. */
  readonly notOffered: string;
}

/** "Pam works with gpt-6 on Codex, which doesn't offer gpt-5.", the line in words. */
export function modelGaveWayWords({
  personName,
  model,
  engineName,
  notOffered,
}: Omit<ModelGaveWayLine, "kind">): string {
  return `${personName} works with ${model} on ${engineName}, which doesn't offer ${notOffered}.`;
}

/**
 * A Stage session's context passed its soft or hard limit, and The Office asked the person for a
 * Handover note (spec §2.5): The Office's line.
 */
export interface StageContextLimitLine {
  readonly kind: "stage-context-limit";
  readonly limit: StageContextLimit;
  readonly contextTokens: number;
}

/**
 * The Stage went on in a fresh session of the same Stage Thread (spec §2.5): The Office's line,
 * with the ended session's context, whether the person's Handover note was passed on, and the Brief
 * the fresh session started with.
 */
export interface StageSessionRestartedLine {
  readonly kind: "stage-session-restarted";
  readonly contextTokens: number;
  readonly handoverNotePassedOn: boolean;
  readonly brief: string;
}

/**
 * The engine refused a turn for a used-up usage window, and the session went on on a Stand-in
 * Engine (spec 5.4): The Office's line, a notice. The engines by their names then, the window by
 * the port's name, its reset as an ISO time.
 */
export interface EngineSwitchedLine {
  readonly kind: "engine-switched";
  readonly fromName: string;
  readonly toName: string;
  readonly window: string;
  readonly resetsAt: string;
  /** Who went on, in a person's Thread; absent in a Stage Thread, where the Stage did. */
  readonly personName?: string;
  /**
   * The stand-in started the Thread fresh, as it is of another engine type or one whose session
   * can't be carried (spec §5.4.6); absent on a carried session, and on every line before it.
   */
  readonly fresh?: boolean;
}

/**
 * "Claude Code's 5-hour window was used up until 2026-11-13 14:00 UTC, so the Stage went on on
 * Claude Code 2.", the line in words; "…, so Pam went on on Claude Code 2." in a person's Thread,
 * and "…, so Pam went on on Codex, starting fresh." when the stand-in started the Thread fresh.
 */
export function engineSwitchedWords({
  fromName,
  toName,
  window,
  resetsAt,
  personName,
  fresh = false,
}: Omit<EngineSwitchedLine, "kind">): string {
  return `${fromName}'s ${usageWindowWords(window)} was used up until ${resetsAt.slice(0, 10)} ${resetsAt.slice(11, 16)} UTC, so ${personName ?? "the Stage"} went on on ${toName}${fresh ? ", starting fresh" : ""}.`;
}

/**
 * Whether a message the user wrote reached the person: one written into a running Stage Thread
 * waits for the next safe point (barge-in, spec §2.4), and is not delivered when the Stage's work
 * ends first. Any other reaches them as it is sent.
 */
export type MessageDelivery = "waiting" | "delivered" | "not-delivered";

interface UserMessage {
  readonly kind: "user";
  readonly text: string;
  readonly delivery: MessageDelivery;
  /** The user who wrote it; null on a message from before users existed, until it is claimed. */
  readonly writtenBy: UserRef | null;
  /**
   * Who wrote the Handover note the message started from, by their Role's key, when the user sent
   * the one a Link card gave them: the message is the user's own, edited or not.
   */
  readonly handoverNoteFrom?: string;
  /** The page open beside the chat drawer as the user sent it (spec §2.4), kept for the log. */
  readonly openPage?: OpenPage;
  /**
   * Set when the message is a skill command ("/<skill> [input]", spec §2.4): it ran the library
   * skill named, and `text` stays the message as written.
   */
  readonly skillCommand?: { readonly skill: string };
  /**
   * The images it carried, as they were when it was sent (spec §2.4); absent on one that carried
   * none, and on every message from before images.
   */
  readonly images?: readonly MessageImage[];
}

/** An image a user message carried, by the Attachment keeping it, as it was when it was sent. */
export interface MessageImage {
  readonly attachmentId: string;
  readonly name: string;
  readonly mediaType: string;
}

/**
 * The move the Context policy made as the person took a message, when it wasn't simply continuing
 * a warm session: The Office's line, never a person's (spec §9).
 */
interface ContextLine {
  readonly kind: "context";
  readonly move: ContextMove;
  readonly reason: ContextReason;
  readonly contextTokens: number;
  /** The Brief's estimate, when the move started a session with one. */
  readonly briefTokens: number | undefined;
  /** The Brief the session started with, for the user to read; undefined when there was none. */
  readonly brief: string | undefined;
}

/** Something the person did with a tool, such as reading a file. */
interface ToolActivity {
  readonly kind: "tool-activity";
  readonly roleKey: string;
  /** The engine's name for the tool, or an Office tool's. */
  readonly tool: string;
  /** What it did, whole, such as the file it read or the command it ran, line breaks included. */
  readonly summary: string;
}

/** A tool call the Office rules or the engine refused, with the reason the person read. */
interface Refusal {
  readonly kind: "refusal";
  readonly roleKey: string;
  readonly tool: string;
  readonly reason: string;
}

/**
 * One of the session's MCP servers didn't start: The Office's line, with why when the engine said.
 */
interface McpServerNotStarted {
  readonly kind: "mcp-server-not-started";
  /** The MCP server's name. */
  readonly server: string;
  /** Without the Server values it was started with. */
  readonly reason: string | undefined;
}

/**
 * A Decision the person opened, or The Office did (no Role), shown as its card; the Decision holds
 * its question and answer.
 */
interface DecisionCard {
  readonly kind: "decision";
  readonly roleKey: string | undefined;
  readonly decisionId: string;
}

/**
 * The user answered a Decision, by an option or a free answer, which went into the session. The
 * line keeps the answer as given: a Decision whose answer never reached a session opens again.
 */
interface DecisionAnswerLine {
  readonly kind: "decision-answer";
  readonly decisionId: string;
  readonly answer: DecisionAnswer;
  /** Set when a person gave it for the user, at their request; the user gave it otherwise. */
  readonly atUsersRequest?: AtUsersRequest;
  /**
   * Set only for an answer given in an Initiative's planning Thread while the person was answering:
   * it waits for their turn to end, then is delivered (spec §2.4). Any other went in as given.
   */
  readonly delivery?: MessageDelivery;
}

/**
 * A Proposal the person drafted, shown as its card; the Proposal holds what it changes and its
 * status.
 */
interface ProposalCard {
  readonly kind: "proposal";
  readonly roleKey: string;
  readonly proposalId: string;
}

/**
 * The Default person to talk to points the user to whoever is responsible (spec §2.2): a person to
 * open a chat Thread with, about a Task when it names one, with a Handover note the user sends
 * themselves. The person's state is read when the card is shown, never kept on it.
 */
interface LinkCard {
  readonly kind: "link-card";
  /** Who posted it. */
  readonly roleKey: string;
  /** The person pointed to, by their Role's key. */
  readonly to: string;
  /** The Task they are pointed to about, if any; the note links to it. */
  readonly taskId: string | undefined;
  readonly note: string;
}

/** An Idea the person captured in a chat, shown as its card; Work holds the Idea and its state. */
export interface IdeaCard {
  readonly kind: "idea";
  readonly roleKey: string;
  readonly ideaId: string;
}

/**
 * The Default person to talk to shows the Office status (spec §2.2): who is on what and what waits
 * on the user, Office-wide, read from Now whenever the card is shown, never kept on it.
 */
export interface OfficeStatusCard {
  readonly kind: "office-status";
  readonly roleKey: string;
}
