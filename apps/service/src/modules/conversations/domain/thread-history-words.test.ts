import { describe, expect, it } from "vitest";
import { aDecision } from "./decision.fixtures.js";
import type { Message, MessageDraft } from "./message.js";
import { aProposal, aProposedCard } from "./proposal.fixtures.js";
import {
  MESSAGE_WORDS_LIMIT,
  messageInHistory,
  THREAD_HISTORY_READ_LIMIT,
  threadHistoryWords,
  type HistoryRecords,
  type MessageInHistory,
  type ThreadMessagesRead,
} from "./thread-history-words.js";
import { ANN_LEE } from "./user.fixtures.js";

const FROM = new Date("2026-11-05T00:00:00.000Z");
const TO = new Date("2026-11-12T23:59:59.999Z");

const decision = aDecision({
  id: "decision-1",
  answer: { kind: "option", option: 1, answeredAt: new Date("2026-11-06T10:00:00.000Z") },
});
const proposal = aProposal({
  id: "proposal-1",
  change: {
    kind: "hire",
    card: aProposedCard({ name: "Nina", title: "Devops" }),
    skills: [],
    roleKey: undefined,
  },
  status: { kind: "applied", at: new Date("2026-11-06T11:00:00.000Z"), by: ANN_LEE },
});

const RECORDS: HistoryRecords = {
  person: (roleKey) =>
    ({ developer: "Jim, the Developer", caretaker: "Jan, the Caretaker" })[roleKey] ?? roleKey,
  decision: (id) => (id === decision.id ? decision : undefined),
  proposal: (id) => (id === proposal.id ? proposal : undefined),
};

let counter = 0;

function aMessage(threadId: string, at: string, draft: MessageDraft): Message {
  counter += 1;
  return { ...draft, id: `message-${counter}`, threadId, at: new Date(`2026-11-${at}Z`) };
}

const words = (message: Message): Pick<MessageInHistory, "speaker" | "text"> => {
  const { speaker, text } = messageInHistory(message, RECORDS);
  return { speaker, text };
};

function read(
  messages: readonly MessageInHistory[],
  fields: Partial<ThreadMessagesRead> = {},
): string {
  return threadHistoryWords({
    from: FROM,
    to: TO,
    filters: [],
    messages,
    subjects: new Map([
      ["thread-a", "Chat with Jim, the Developer"],
      ["thread-b", 'Jan, the Caretaker\'s Thread on the Task "Fix login" (Task task-1)'],
    ]),
    after: undefined,
    ...fields,
  });
}

/** A message in history of `length` characters' text. */
function aMessageInHistory(threadId: string, text: string, index: number): MessageInHistory {
  return {
    id: `message-${threadId}-${index}`,
    threadId,
    at: new Date(Date.UTC(2026, 10, 6, 9, index)),
    speaker: "the user",
    text,
  };
}

describe("messageInHistory", () => {
  it("names the user, the person by name and Role, and The Office as speakers", () => {
    expect(
      words(
        aMessage("a", "06T09:00:00", {
          kind: "user",
          text: "Hi",
          delivery: "delivered",
          writtenBy: ANN_LEE,
        }),
      ),
    ).toEqual({
      speaker: "the user Ann Lee",
      text: "Hi",
    });
    expect(
      words(aMessage("a", "06T09:01:00", { kind: "person", roleKey: "developer", text: "Hello" })),
    ).toEqual({
      speaker: "Jim, the Developer",
      text: "Hello",
    });
    expect(
      words(aMessage("a", "06T09:02:00", { kind: "failure", reason: "The engine stopped." })),
    ).toEqual({ speaker: "The Office", text: "Couldn't answer: The engine stopped." });
    expect(
      words(
        aMessage("a", "06T09:02:30", {
          kind: "usage-window-used-up",
          engineName: "Claude Code",
          window: "five-hour",
          resetsAt: "2026-11-13T14:00:00.000Z",
        }),
      ),
    ).toEqual({
      speaker: "The Office",
      text: "Claude Code's 5-hour window is used up until 2026-11-13 14:00 UTC.",
    });
  });

  it("shows tool activity as its one-line summary", () => {
    const longLine = "x".repeat(500);
    expect(
      words(
        aMessage("a", "06T09:03:00", {
          kind: "tool-activity",
          roleKey: "developer",
          tool: "Bash",
          summary: "npm test\ncd apps/service && npx vitest run",
        }),
      ),
    ).toEqual({ speaker: "Jim, the Developer", text: "[Bash] npm test …" });
    const { text } = words(
      aMessage("a", "06T09:04:00", {
        kind: "tool-activity",
        roleKey: "developer",
        tool: "Read",
        summary: longLine,
      }),
    );
    expect(text.length).toBeLessThan(220);
    expect(text).toMatch(/^\[Read\] x+…$/);
  });

  it("shows a Decision as its question with its answer, and a Proposal as what it changes with its state", () => {
    expect(
      words(
        aMessage("b", "06T09:05:00", {
          kind: "decision",
          roleKey: "developer",
          decisionId: decision.id,
        }),
      ).text,
    ).toBe(`Decision: ${decision.question} Answered: Every Project`);
    expect(
      words(
        aMessage("b", "06T09:06:00", {
          kind: "decision-answer",
          decisionId: decision.id,
          answer: { kind: "option", option: 1 },
        }),
      ),
    ).toEqual({
      speaker: "the user",
      text: `Answered the Decision "${decision.question}": Every Project`,
    });
    expect(
      words(
        aMessage("b", "06T09:07:00", {
          kind: "proposal",
          roleKey: "developer",
          proposalId: proposal.id,
        }),
      ).text,
    ).toBe("Proposal to hire Nina as Devops (applied).");
    expect(
      words(
        aMessage("b", "06T09:08:00", { kind: "decision", roleKey: undefined, decisionId: "gone" }),
      ),
    ).toEqual({ speaker: "The Office", text: "Opened a Decision." });
  });
});

describe("threadHistoryWords", () => {
  it("groups the messages by Thread, each from its first message on, oldest first, with its subject", () => {
    const messages = [
      aMessageInHistory("thread-a", "First in A.", 1),
      aMessageInHistory("thread-b", "First in B.", 2),
      aMessageInHistory("thread-a", "Second in A.", 3),
    ];

    const answer = read(messages);

    expect(answer).toBe(
      [
        "Thread messages logged from 2026-11-05 00:00 UTC to 2026-11-12 23:59 UTC: 3 in 2 Threads, grouped by Thread, the first logged first.",
        "",
        "## Chat with Jim, the Developer (Thread thread-a)",
        "",
        "- 2026-11-06 09:01 UTC · the user: First in A.",
        "- 2026-11-06 09:03 UTC · the user: Second in A.",
        "",
        '## Jan, the Caretaker\'s Thread on the Task "Fix login" (Task task-1) (Thread thread-b)',
        "",
        "- 2026-11-06 09:02 UTC · the user: First in B.",
      ].join("\n"),
    );
  });

  it("stays within its cap, saying how many messages it leaves out and the message to read on after", () => {
    const messages = Array.from({ length: 100 }, (_, index) =>
      aMessageInHistory(index % 2 === 0 ? "thread-a" : "thread-b", "y".repeat(1_000), index),
    );
    const byThread = [
      ...messages.filter(({ threadId }) => threadId === "thread-a"),
      ...messages.filter(({ threadId }) => threadId === "thread-b"),
    ];

    const answer = read(messages);
    const shown = answer.split("\n").filter((line) => line.startsWith("- ")).length;

    expect(answer.length).toBeLessThanOrEqual(THREAD_HISTORY_READ_LIMIT);
    expect(shown).toBeLessThan(100);
    const lastShown = byThread[shown - 1]?.id;
    expect(answer).toMatch(
      new RegExp(`… ${100 - shown} more messages are left out .*after: "${lastShown}"\\.$`),
    );

    const readOn = read(messages, { after: lastShown });
    expect(readOn).toContain(`read on after message ${lastShown}`);
    expect(readOn.split("\n").filter((line) => line.startsWith("- "))).toHaveLength(100 - shown);
    expect(readOn).not.toContain("left out");
  });

  it("cuts a long message, keeping its start and its end", () => {
    const text = `START${"z".repeat(10_000)}END`;

    const answer = read([aMessageInHistory("thread-a", text, 1)]);

    const line = answer
      .split("\n")
      .filter((each) => each.startsWith("- ") || each.startsWith("  "))
      .join("\n");
    expect(line).toContain("START");
    expect(line).toContain("END");
    expect(line).toMatch(/characters cut/);
    expect(line.length).toBeLessThan(MESSAGE_WORDS_LIMIT + 100);
  });

  it("answers a plain sentence for a range with no messages, and for a message to read on after it doesn't hold", () => {
    expect(read([], { filters: ["with Jim, the Developer"] })).toBe(
      "No Thread messages were logged from 2026-11-05 00:00 UTC to 2026-11-12 23:59 UTC, with Jim, the Developer.",
    );
    const messages = [aMessageInHistory("thread-a", "Only.", 1)];
    expect(read(messages, { after: "unknown" })).toMatch(
      /^No message unknown was logged .*: read without after/,
    );
    expect(read(messages, { after: "message-thread-a-1" })).toMatch(
      /^No more Thread messages were logged/,
    );
  });
});
