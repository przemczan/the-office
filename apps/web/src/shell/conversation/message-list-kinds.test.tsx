import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Decision, Message, MessageDelivery, Proposal } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it, vi } from "vitest";
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
const EVERY_KIND: { readonly [Kind in Message["kind"]]: readonly [Message, string] } = {
  user: [
    { at, id: "1", kind: "user", text: "Mine", delivery: "delivered", handoverNoteFrom: null },
    "Mine",
  ],
  person: [{ at, id: "2", kind: "person", roleKey: "developer", text: "Theirs" }, "Theirs"],
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
  held: [{ at, id: "8", kind: "held", heldBy: "pause", text: "Paused here" }, "Paused here"],
  decision: [{ at, id: "9", kind: "decision", roleKey: "developer", decision }, "A Decision card"],
  "decision-answer": [
    { at, id: "10", kind: "decision-answer", answer: { kind: "option", option: 0 }, decision },
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
  { details = true, answering = false } = {},
): HTMLElement {
  const page = document.createElement("div");
  act(() =>
    createRoot(page).render(
      <QueryClientProvider client={new QueryClient()}>
        <MessageList
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
  return { at, id, kind: "user", text, delivery, handoverNoteFrom: null };
}

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
});

describe("MessageList with Details off", () => {
  const [toolCall] = EVERY_KIND["tool-activity"];

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

  it("leaves the tool line to the log with Details on", () => {
    const working = shownLog([toolCall], { answering: true });
    expect(working.querySelector(".message-answering")?.textContent).not.toContain("Read");
  });
});
