import { answerWords, type Decision } from "./decision.js";
import { usageWindowUsedUpWords, type Message } from "./message.js";
import type { Proposal, ProposedChange } from "./proposal.js";
import { userWords } from "./user.js";

/** The most characters a `read_threads` answer holds, as `read_stage_history`'s does. */
export const THREAD_HISTORY_READ_LIMIT = 60_000;

/** The most characters of one message's words: a longer one keeps its start and its end. */
export const MESSAGE_WORDS_LIMIT = 4_000;

/** The most characters of a tool activity's one line. */
const TOOL_ACTIVITY_LIMIT = 200;

/** Room kept in a cut message for the note saying how much was cut. */
const CUT_NOTE_ROOM = 40;

/** Room kept at the answer's end for the note saying how to read on. */
const READ_ON_NOTE_ROOM = 400;

/** What a message's words name besides itself, read before the words are made. */
export interface HistoryRecords {
  /** Who fills or filled the Role, by name and Role, as "Jim, the Developer". */
  person(roleKey: string): string;
  decision(id: string): Decision | undefined;
  proposal(id: string): Proposal | undefined;
}

/** A message as `read_threads` gives it: when, who, and what in a line or a few. */
export interface MessageInHistory {
  readonly id: string;
  readonly threadId: string;
  readonly at: Date;
  readonly speaker: string;
  readonly text: string;
}

/** What `threadHistoryWords` answers about. */
export interface ThreadMessagesRead {
  readonly from: Date;
  readonly to: Date;
  /** The filters asked with, in words, such as "with Jim, the Developer"; empty for none. */
  readonly filters: readonly string[];
  /** The messages logged in the range, the first logged first. */
  readonly messages: readonly MessageInHistory[];
  /** Each Thread's subject, by its id: the Task's or Initiative's title, or whose chat it is. */
  readonly subjects: ReadonlyMap<string, string>;
  /** The message read up to before, by its id, to read on after it. */
  readonly after: string | undefined;
}

const THE_OFFICE = "The Office";

/** The message as `read_threads` gives it: tool activity as one line, cards as what they hold. */
export function messageInHistory(message: Message, records: HistoryRecords): MessageInHistory {
  const { speaker, text } = speakerAndText(message, records);
  return { id: message.id, threadId: message.threadId, at: message.at, speaker, text };
}

function speakerAndText(
  message: Message,
  records: HistoryRecords,
): { readonly speaker: string; readonly text: string } {
  switch (message.kind) {
    case "user":
      return { speaker: userWords(message.writtenBy), text: message.text };
    case "person":
      return { speaker: records.person(message.roleKey), text: message.text };
    case "handover-note":
      return { speaker: records.person(message.roleKey), text: `Handover note: ${message.text}` };
    case "tool-activity":
      return {
        speaker: records.person(message.roleKey),
        text: `[${message.tool}] ${oneLine(message.summary)}`,
      };
    case "refusal":
      return {
        speaker: THE_OFFICE,
        text: `Refused ${message.tool}: ${oneLine(message.reason)}`,
      };
    case "mcp-server-not-started":
      return {
        speaker: THE_OFFICE,
        text: `The MCP server ${message.server} didn't start${message.reason ? `: ${message.reason}` : "."}`,
      };
    case "decision": {
      const speaker = message.roleKey === undefined ? THE_OFFICE : records.person(message.roleKey);
      return { speaker, text: decisionWords(records.decision(message.decisionId)) };
    }
    case "decision-answer": {
      const decision = records.decision(message.decisionId);
      const answer = decision?.answer;
      const speaker = answer?.byTheOffice
        ? THE_OFFICE
        : answer?.answeredBy === undefined
          ? userWords(answer?.atUsersRequest?.user ?? answer?.user ?? null)
          : records.person(answer.answeredBy);
      return {
        speaker,
        text:
          decision === undefined
            ? "Answered a Decision."
            : `Answered the Decision "${decision.question}": ${answerWords(decision, message.answer)}`,
      };
    }
    case "consultation-line":
      return { speaker: THE_OFFICE, text: message.text };
    case "proposal":
      return {
        speaker: records.person(message.roleKey),
        text: proposalWords(records.proposal(message.proposalId)),
      };
    case "link-card":
      return {
        speaker: records.person(message.roleKey),
        text: `Link card to ${records.person(message.to)}${message.taskId === undefined ? "" : ` about Task ${message.taskId}`}: ${message.note}`,
      };
    case "idea":
      return { speaker: records.person(message.roleKey), text: `Captured Idea ${message.ideaId}.` };
    case "office-status":
      return { speaker: records.person(message.roleKey), text: "Showed the Office status." };
    case "context":
      return {
        speaker: THE_OFFICE,
        text: `The Context policy chose ${message.move} (${message.reason}).`,
      };
    case "changes-allowed":
      return {
        speaker: userWords(message.by),
        text: message.allowed ? "Allowed changes." : "Switched changes off.",
      };
    case "failure":
      return { speaker: THE_OFFICE, text: `Couldn't answer: ${message.reason}` };
    case "usage-window-used-up":
      return { speaker: THE_OFFICE, text: usageWindowUsedUpWords(message) };
    case "held":
      return { speaker: THE_OFFICE, text: message.text };
  }
}

function decisionWords(decision: Decision | undefined): string {
  if (decision === undefined) return "Opened a Decision.";
  const asked = `Decision: ${decision.question}`;
  return decision.answer === undefined
    ? `${asked} Not answered yet.`
    : `${asked} Answered: ${answerWords(decision, decision.answer)}`;
}

function proposalWords(proposal: Proposal | undefined): string {
  if (proposal === undefined) return "Drafted a Proposal.";
  return `Proposal to ${proposedWords(proposal.change)} (${proposal.status.kind}).`;
}

function proposedWords(change: ProposedChange): string {
  switch (change.kind) {
    case "hire":
      return `hire ${change.card.name} as ${change.card.title}`;
    case "hire-from-preset":
      return `hire ${change.name} into the ${change.roleKey} Role`;
    case "change":
      return `change the ${change.roleKey} Role's card`;
    case "office-wide-limit":
      return `set the Office-wide limit to ${change.to}`;
    case "size-threshold":
      return `set the size threshold to ${change.to}`;
    case "office-instructions":
      return "change the Office instructions";
    case "duties":
      return `change who holds ${Object.keys(change.to).join(", ")}`;
    case "office-setup":
      return `set up The Office: hire ${change.hires.length} and assign ${change.duties.length} duties`;
    case "initiative":
      return `change Initiative ${change.initiativeId}`;
    case "project-commands":
      return `change Project ${change.projectId}'s commands`;
    case "pipeline":
      return `change the Pipeline ${change.pipelineId}`;
    case "stage-template":
      return `change the Stage template ${change.templateId}`;
    case "project-pipeline":
      return change.from === null
        ? `add the Project Pipeline ${change.to.name} to Project ${change.projectId}`
        : `change Project ${change.projectId}'s Pipeline ${change.from.name}`;
    case "project":
      return `onboard the Project ${change.project.name}`;
    case "skill-install":
      return `install the skill ${change.name} from ${change.repository}`;
    case "skill-update":
      return `update the skill ${change.name}`;
    case "skill":
      return `add the skill ${change.name}`;
  }
}

/** A tool activity's summary as one line: its first, shortened. */
function oneLine(summary: string): string {
  const lines = summary.trim().split("\n");
  const first = lines[0] ?? "";
  const shortened =
    first.length > TOOL_ACTIVITY_LIMIT ? `${first.slice(0, TOOL_ACTIVITY_LIMIT - 1)}…` : first;
  return lines.length > 1 && shortened === first ? `${shortened} …` : shortened;
}

/** How long an answer may grow, and how its read-on note says to read on after the last shown. */
export interface ThreadHistoryAnswer {
  readonly limit: number;
  readOn(lastShownId: string): string;
}

/** `read_threads`'s own answer: read on by asking it again after the last message shown. */
const READ_THREADS_ANSWER: ThreadHistoryAnswer = {
  limit: THREAD_HISTORY_READ_LIMIT,
  readOn: (lastShownId) =>
    `read on with the same from, to and filters, and after: "${lastShownId}".`,
};

/**
 * The `read_threads` answer: the messages grouped by Thread, each Thread from its first message in
 * the range on, oldest first, capped at the answer's limit (`THREAD_HISTORY_READ_LIMIT` for
 * `read_threads`). A full answer ends saying how many messages it leaves out and how to read on.
 */
export function threadHistoryWords(
  history: ThreadMessagesRead,
  shape: ThreadHistoryAnswer = READ_THREADS_ANSWER,
): string {
  const ordered = byThread(history.messages);
  const range = `from ${timeWords(history.from)} to ${timeWords(history.to)}`;
  const filtered = history.filters.length === 0 ? "" : `, ${history.filters.join(", ")}`;
  if (ordered.length === 0) return `No Thread messages were logged ${range}${filtered}.`;
  const start =
    history.after === undefined ? 0 : ordered.findIndex(({ id }) => id === history.after) + 1;
  if (start === 0 && history.after !== undefined) {
    return `No message ${history.after} was logged ${range}${filtered}: read without after to start from the first.`;
  }
  if (start === ordered.length) {
    return `No more Thread messages were logged ${range}${filtered} after message ${history.after}.`;
  }
  const threadCount = new Set(ordered.map(({ threadId }) => threadId)).size;
  let answer = `Thread messages logged ${range}${filtered}: ${ordered.length} in ${threadCount} ${threadCount === 1 ? "Thread" : "Threads"}, grouped by Thread, the first logged first${start === 0 ? "" : `, read on after message ${history.after}`}.`;
  let shownThread: string | undefined;
  for (let index = start; index < ordered.length; index++) {
    const message = ordered[index];
    if (message === undefined) break;
    const heading =
      message.threadId === shownThread
        ? ""
        : `\n\n## ${history.subjects.get(message.threadId) ?? "A Thread"} (Thread ${message.threadId})\n`;
    const piece = `${heading}\n${messageLine(message)}`;
    if (answer.length + piece.length > shape.limit - READ_ON_NOTE_ROOM) {
      const previous = ordered[index - 1];
      return `${answer}\n\n${readOnNote(ordered.length - index, previous?.id ?? "", shape)}`;
    }
    answer += piece;
    shownThread = message.threadId;
  }
  return answer;
}

/** The messages grouped by Thread, the Threads in the order of their first message. */
function byThread(messages: readonly MessageInHistory[]): MessageInHistory[] {
  const groups = new Map<string, MessageInHistory[]>();
  for (const message of messages) {
    const group = groups.get(message.threadId);
    if (group) group.push(message);
    else groups.set(message.threadId, [message]);
  }
  return [...groups.values()].flat();
}

function messageLine({ at, speaker, text }: MessageInHistory): string {
  const words = cutKeepingEnds(text.trim(), MESSAGE_WORDS_LIMIT).replaceAll("\n", "\n  ");
  return `- ${timeWords(at)} · ${speaker}: ${words}`;
}

/** The text within `limit` characters, keeping its start and its end around a note of the cut. */
function cutKeepingEnds(text: string, limit: number): string {
  if (text.length <= limit) return text;
  const kept = limit - CUT_NOTE_ROOM;
  const note = `\n… ${text.length - kept} characters cut …\n`;
  const head = Math.ceil(kept / 2);
  return `${text.slice(0, head)}${note}${text.slice(text.length - (kept - head))}`;
}

function readOnNote(leftOut: number, lastShownId: string, shape: ThreadHistoryAnswer): string {
  const messages = leftOut === 1 ? "1 more message is" : `${leftOut} more messages are`;
  return `… ${messages} left out to keep this answer within ${shape.limit} characters: ${shape.readOn(lastShownId)}`;
}

/** A time to the minute, in UTC, as "2026-11-12 13:15 UTC". */
function timeWords(at: Date): string {
  return `${at.toISOString().slice(0, 16).replace("T", " ")} UTC`;
}
