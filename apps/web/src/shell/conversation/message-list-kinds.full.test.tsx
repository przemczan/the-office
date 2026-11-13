import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Decision, Message, MessageDelivery, Proposal, Role } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { clockOf } from "../time.ts";
import { contextLabel } from "./context-words.ts";
import { MessageList } from "./message-list.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// The cards read the service and the router; here only their place in the log matters.
vi.mock("./decision-card.tsx", () => ({ DecisionInThread: (): ReactNode => "A Decision card" }));
vi.mock("./proposal-card.tsx", () => ({ ProposalCard: (): ReactNode => "A Proposal card" }));
vi.mock("./link-card.tsx", () => ({ LinkCard: (): ReactNode => "A Link card" }));
vi.mock("./idea-card.tsx", () => ({ IdeaCard: (): ReactNode => "An Idea card" }));
vi.mock("./office-status-card.tsx", () => ({
  OfficeStatusCard: (): ReactNode => "An Office status card",
}));

const at = "2026-11-04T10:00:00.000Z";
const decision = { options: ["This", "That"] } as Decision;
const proposal = {} as Proposal;
const contextLine: Extract<Message, { kind: "context" }> = {
  at,
  id: "5",
  kind: "context",
  move: "resume",
  reason: "cache-warm",
  contextTokens: 10,
  briefTokens: null,
  brief: null,
};

/** One of each kind, with words it must show: a kind added to the contract fails to compile here. */
const EVERY_KIND: {
  readonly [Kind in Message["kind"]]: readonly [Extract<Message, { kind: Kind }>, string];
} = {
  user: [
    {
      at,
      id: "1",
      kind: "user",
      text: "Mine",
      delivery: "delivered",
      handoverNoteFrom: null,
      openPage: null,
    },
    "Mine",
  ],
  person: [{ at, id: "2", kind: "person", roleKey: "developer", text: "Theirs" }, "Theirs"],
  "consultation-line": [
    {
      at,
      id: "c-1",
      kind: "consultation-line",
      decisionId: "d-1",
      text: "Your answer to Ada: Drafted it.",
    },
    "Your answer to Ada: Drafted it.",
  ],
  "handover-note": [
    { at, id: "3", kind: "handover-note", roleKey: "developer", text: "For the next" },
    "For the next",
  ],
  "tool-activity": [
    { at, id: "4", kind: "tool-activity", roleKey: "developer", tool: "Read", summary: "a.ts" },
    "a.ts",
  ],
  context: [contextLine, contextLabel(contextLine, "Jan")],
  "changes-allowed": [{ at, id: "6", kind: "changes-allowed", allowed: true }, "Changes allowed"],
  failure: [{ at, id: "7", kind: "failure", reason: "It broke" }, "It broke"],
  "usage-window-used-up": [
    {
      at,
      id: "7u",
      kind: "usage-window-used-up",
      engineName: "Claude Code",
      window: "five-hour",
      resetsAt: at,
    },
    "Claude Code's 5-hour window is used up until",
  ],
  held: [{ at, id: "8", kind: "held", heldBy: "pause", text: "Paused here" }, "Paused here"],
  decision: [{ at, id: "9", kind: "decision", roleKey: "developer", decision }, "A Decision card"],
  "decision-answer": [
    {
      at,
      id: "10",
      kind: "decision-answer",
      answer: { kind: "option", option: 0 },
      atUsersRequest: null,
      decision,
    },
    "You · answering the Decision",
  ],
  proposal: [{ at, id: "11", kind: "proposal", roleKey: "cto", proposal }, "A Proposal card"],
  "link-card": [
    {
      at,
      id: "12",
      kind: "link-card",
      roleKey: "office-manager",
      to: { roleKey: "developer", letGo: false },
      taskId: null,
      note: "",
    },
    "A Link card",
  ],
  idea: [{ at, id: "13", kind: "idea", roleKey: "cto", ideaId: "14" }, "An Idea card"],
  "office-status": [
    { at, id: "15", kind: "office-status", roleKey: "office-manager" },
    "An Office status card",
  ],
  refusal: [
    { at, id: "16", kind: "refusal", roleKey: "developer", tool: "Write", reason: "Not there" },
    "Write refused",
  ],
  "mcp-server-not-started": [
    { at, id: "17", kind: "mcp-server-not-started", server: "files", reason: null },
    "The MCP server files didn't start.",
  ],
};

function shownLog(
  messages: readonly Message[],
  {
    details = true,
    answering = false,
    roles,
  }: { details?: boolean; answering?: boolean; roles?: Role[] } = {},
): HTMLElement {
  const page = document.createElement("div");
  const queryClient = new QueryClient();
  if (roles) queryClient.setQueryData(roleQueries.list().queryKey, roles);
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={queryClient}>
        <MessageList
          roleKey="developer"
          messages={messages}
          personName="Jan"
          answering={answering}
          stageThread
          details={details}
        />
      </QueryClientProvider>,
    ),
  );
  return page;
}

function fromPerson(id: string, text: string): Message {
  return { at, id, kind: "person", roleKey: "developer", text };
}

function written(id: string, text: string, delivery: MessageDelivery): Message {
  return { at, id, kind: "user", text, delivery, handoverNoteFrom: null, openPage: null };
}

const LONG_COMMAND = `npm run build &&\n  ${"node scripts/deploy.ts --verbose ".repeat(8)}`;

describe("MessageList's kinds", () => {
  it("renders every message kind, none lost to the grouping", () => {
    const every = Object.values(EVERY_KIND);
    const log = shownLog(every.map(([message]) => message));
    for (const [, words] of every) expect(log.textContent).toContain(words);
  });

  it.each(["decision", "proposal", "link-card", "idea", "office-status"] as const)(
    "keeps a %s in its place between one person's messages",
    (kind) => {
      const [card, words] = EVERY_KIND[kind];
      const log = shownLog([fromPerson("a", "Before"), card, fromPerson("b", "After")]);
      const text = log.textContent;
      expect(log.querySelectorAll(".turn")).toHaveLength(2);
      expect(text.indexOf("Before")).toBeLessThan(text.indexOf(words));
      expect(text.indexOf(words)).toBeLessThan(text.indexOf("After"));
    },
  );

  it("shows a turn's author once, and each of the user's messages its own delivery mark", () => {
    const log = shownLog([written("a", "First", "delivered"), written("b", "Second", "waiting")]);
    expect(log.querySelectorAll(".turn-by")).toHaveLength(1);
    expect(
      [...log.querySelectorAll(".message-delivery")].map(({ textContent }) => textContent),
    ).toEqual(["Delivered", "Lands at the next safe point"]);
  });

  it("gives the user's turn and the person's the same row: avatar, name and time", () => {
    const log = shownLog([written("a", "Mine", "delivered"), fromPerson("b", "Theirs")]);
    const rows = [...log.querySelectorAll(".turn")].map((turn) => [
      turn.querySelector(".turn-avatar")?.textContent,
      turn.querySelector(".turn-author")?.textContent,
      turn.querySelector(".turn-by")?.textContent?.endsWith(clockOf(at)),
    ]);
    expect(rows).toEqual([
      ["Y", "You", true],
      ["J", "Jan", true],
    ]);
  });

  it("keeps the tint for people: the user's avatar is neutral, on all the user's turns", () => {
    const [answer] = EVERY_KIND["decision-answer"];
    const log = shownLog([written("a", "Mine", "delivered"), fromPerson("b", "Theirs"), answer]);
    const backgrounds = [...log.querySelectorAll<HTMLElement>(".turn-avatar > span")].map(
      ({ style }) => style.background,
    );
    expect(backgrounds[0]).toBe("var(--gray-100)");
    expect(backgrounds[1]).not.toBe("var(--gray-100)");
    expect(backgrounds[2]).toBe("var(--gray-100)");
  });

  it("names the person who answered a Decision at the user's request, in place of You", () => {
    const [answer] = EVERY_KIND["decision-answer"];
    if (answer?.kind !== "decision-answer") throw new Error("No decision-answer line.");
    const reviewer = { key: "reviewer", letGoAt: null, card: { name: "Michael" } };
    const log = shownLog(
      [{ ...answer, atUsersRequest: { roleKey: "reviewer", threadId: "chat-thread" } }],
      { roles: [reviewer as unknown as Role] },
    );
    expect(log.querySelector(".turn-avatar")?.textContent).toBe("M");
    expect(log.querySelector(".turn-by")?.textContent).toContain(
      "Michael · answering the Decision at your request",
    );
    expect(log.querySelector(".turn-by")?.textContent).not.toContain("You");
  });

  it("joins neighbouring messages into one turn under one avatar", () => {
    const log = shownLog([fromPerson("a", "First"), fromPerson("b", "Second")]);
    expect(log.querySelectorAll(".turn")).toHaveLength(1);
    expect(log.querySelectorAll(".turn-avatar")).toHaveLength(1);
    expect(log.querySelectorAll(".turn .message-text")).toHaveLength(2);
  });

  it("shows a tool call's whole command, line breaks included", () => {
    const [toolCall] = EVERY_KIND["tool-activity"];
    const log = shownLog([{ ...toolCall, summary: LONG_COMMAND }]);
    expect(log.querySelector(".tool-calls .message-summary")?.textContent).toBe(LONG_COMMAND);
  });

  it("shows a lone tool call with nothing to open", () => {
    const [toolCall] = EVERY_KIND["tool-activity"];
    expect(shownLog([toolCall]).querySelector("details")).toBeNull();
  });

  it("folds neighbouring tool calls to their count and the latest, opening to every call", () => {
    const [toolCall] = EVERY_KIND["tool-activity"];
    const log = shownLog([
      { ...toolCall, id: "first", summary: "a.ts" },
      { ...toolCall, id: "latest", summary: LONG_COMMAND },
    ]);
    const fold = log.querySelector<HTMLDetailsElement>("details.tool-calls");
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector(".tool-call-count")?.textContent).toBe("2 tool calls");
    expect(fold?.querySelector(".tool-call-latest")?.textContent).toBe(`Read ${LONG_COMMAND}`);
    expect(
      [...(fold?.querySelectorAll("li .message-summary") ?? [])].map((call) => call.textContent),
    ).toEqual(["a.ts", LONG_COMMAND]);
  });

  it("shows a failure and an MCP server that didn't start as a strip", () => {
    const log = shownLog([EVERY_KIND.failure[0], EVERY_KIND["mcp-server-not-started"][0]]);
    expect(log.querySelectorAll(".message-notice.failed")).toHaveLength(2);
    expect(log.querySelector(".message-line")).toBeNull();
  });

  it("gives a refusal's reason the words' own span, to wrap beside its icon", () => {
    const [refusal] = EVERY_KIND.refusal;
    const notice = shownLog([refusal]).querySelector(".message-notice.refused");
    expect(notice?.querySelector("span")?.textContent).toBe(
      `${refusal.tool} refused: ${refusal.reason}`,
    );
  });

  it("opens each day of a Thread that spans days with a day line", () => {
    const [said] = EVERY_KIND.person;
    const today = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);
    const log = shownLog([
      { ...said, id: "before", at: yesterday.toISOString() },
      { ...said, id: "after", at: today.toISOString() },
    ]);
    expect(log.querySelectorAll(".turn")).toHaveLength(2);
    expect([...log.querySelectorAll(".message-log-line")].map((line) => line.textContent)).toEqual([
      "Yesterday",
      "Today",
    ]);
  });

  it("has no day line in a Thread of one day", () => {
    const [said] = EVERY_KIND.person;
    expect(shownLog([said]).querySelector(".message-log-line")).toBeNull();
  });
});

describe("MessageList with Details off", () => {
  const [toolCall] = EVERY_KIND["tool-activity"];

  it("hides neighbouring tool calls, fold and all", () => {
    const log = shownLog(
      [
        { ...toolCall, id: "first" },
        { ...toolCall, id: "latest" },
      ],
      { details: false },
    );
    expect(log.querySelector(".tool-calls")).toBeNull();
  });

  it("shows every kind but tool activity and context lines", () => {
    const { "tool-activity": tool, context, ...shown } = EVERY_KIND;
    const every = Object.values(EVERY_KIND);
    const log = shownLog(
      every.map(([message]) => message),
      { details: false },
    );
    for (const [, words] of Object.values(shown)) expect(log.textContent).toContain(words);
    expect(log.textContent).not.toContain(tool[1]);
    expect(log.textContent).not.toContain(context[1]);
  });

  it("keeps the delivery marks", () => {
    const log = shownLog([written("a", "First", "not-delivered")], { details: false });
    expect(log.querySelector(".message-delivery")?.textContent).toContain("Not delivered");
  });

  it("joins a turn across a hidden line", () => {
    const log = shownLog([fromPerson("a", "Before"), toolCall, fromPerson("b", "After")], {
      details: false,
    });
    expect(log.querySelectorAll(".turn")).toHaveLength(1);
  });

  it("shows the latest tool line beside is working", () => {
    const working = shownLog([toolCall], { details: false, answering: true });
    expect(working.querySelector(".message-answering")?.textContent).toContain("Read");
  });

  it("folds the command beside is working to one line, opening to it whole", () => {
    const working = shownLog([{ ...toolCall, summary: LONG_COMMAND }], {
      details: false,
      answering: true,
    });
    const fold = working.querySelector<HTMLDetailsElement>(".message-answering details");
    expect(fold?.open).toBe(false);
    expect(fold?.querySelector("summary .tool-call-latest")?.textContent).toBe(
      `Read ${LONG_COMMAND}`,
    );
    expect(fold?.querySelector(".tool-call-count")).toBeNull();
    expect(fold?.querySelector("li .message-summary")?.textContent).toBe(LONG_COMMAND);
  });

  it("has nothing to open for a tool call with no command", () => {
    const working = shownLog([{ ...toolCall, summary: "" }], { details: false, answering: true });
    expect(working.querySelector(".message-answering details")).toBeNull();
    expect(working.querySelector(".message-answering .message-tool")?.textContent).toBe("Read");
  });

  it("leaves the tool line to the log with Details on", () => {
    const working = shownLog([toolCall], { answering: true });
    expect(working.querySelector(".message-answering")?.textContent).not.toContain("Read");
  });
});
