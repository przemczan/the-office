import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import type { Message } from "@the-office/contracts";
import { act, type ComponentProps, type ReactNode } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { roleQueries } from "../../api/people.ts";
import { MessageList } from "./message-list.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// scrollIntoView scrolls the page around the list too; only the list may scroll.
Element.prototype.scrollIntoView = () => {
  throw new Error("Only the message list scrolls, never the page around it.");
};

function toolCall(id: string, summary: string): Message {
  return {
    at: "2026-11-01T10:00:00.000Z",
    id,
    kind: "tool-activity",
    roleKey: "developer",
    tool: "Bash",
    summary,
  };
}

const queryClient = new QueryClient();
queryClient.setQueryData(roleQueries.list().queryKey, []);

/** The list of the developer's Thread, with no Avatar to fetch. */
function RenderedList(props: Omit<ComponentProps<typeof MessageList>, "roleKey">): ReactNode {
  return (
    <QueryClientProvider client={queryClient}>
      <MessageList roleKey="developer" {...props} />
    </QueryClientProvider>
  );
}

it("scrolls only the list to its end as a message comes or the person starts to answer", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-01T10:00:00.000Z";
  const messages: Message[] = [];
  const show = (answering: boolean): void =>
    act(() =>
      root.render(
        <RenderedList
          messages={[...messages]}
          personName="Jan"
          answering={answering}
          stageThread={false}
          details
        />,
      ),
    );
  show(false);
  const list = page.querySelector<HTMLElement>(".message-list");
  if (list === null) throw new Error("No message list.");
  // jsdom lays nothing out: the list says how tall its lines are.
  let height = 0;
  Object.defineProperty(list, "scrollHeight", { get: () => height });

  height = 300;
  messages.push({ at, id: "1", kind: "person", roleKey: "developer", text: "Hello" });
  show(false);
  expect(list.scrollTop).toBe(300);

  height = 500;
  show(true);
  expect(list.scrollTop).toBe(500);
  act(() => root.unmount());
});

it("leaves a reader who scrolled up where they are, until they send something themselves", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-01T10:00:00.000Z";
  const messages: Message[] = [{ at, id: "1", kind: "person", roleKey: "developer", text: "One" }];
  const show = (): void =>
    act(() =>
      root.render(
        <RenderedList
          messages={[...messages]}
          personName="Jan"
          answering={false}
          stageThread
          details
          leavesReaderBe
        />,
      ),
    );
  show();
  const list = page.querySelector<HTMLElement>(".message-list");
  if (list === null) throw new Error("No message list.");
  Object.defineProperty(list, "scrollHeight", { get: () => 1000 });

  list.scrollTop = 100;
  act(() => void list.dispatchEvent(new Event("scroll")));
  messages.push({ at, id: "2", kind: "person", roleKey: "developer", text: "Two" });
  show();
  expect(list.scrollTop).toBe(100);

  messages.push({
    at,
    id: "3",
    kind: "user",
    text: "Three",
    writtenBy: null,
    handoverNoteFrom: null,
    openPage: null,
    images: [],
    delivery: "waiting",
  });
  show();
  expect(list.scrollTop).toBe(1000);
  act(() => root.unmount());
});

it("brings an opened tool call into view and follows the next, unless the reader left the end", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const show = (call: Message): void =>
    act(() =>
      root.render(
        <RenderedList
          messages={[call]}
          personName="Jan"
          answering
          stageThread={false}
          details={false}
        />,
      ),
    );
  show(toolCall("1", "first"));
  const list = page.querySelector<HTMLElement>(".message-list");
  if (list === null) throw new Error("No message list.");
  let height = 300;
  Object.defineProperty(list, "scrollHeight", { get: () => height });
  const fold = (): HTMLDetailsElement => {
    const shown = page.querySelector("details");
    if (shown === null) throw new Error("No fold.");
    return shown;
  };
  const toggleFold = (open: boolean): void => {
    fold().open = open;
    act(() => void fold().dispatchEvent(new Event("toggle")));
  };
  const scrollListTo = (top: number): void => {
    list.scrollTop = top;
    act(() => void list.dispatchEvent(new Event("scroll")));
  };

  list.scrollTop = 0;
  show(toolCall("2", "closed, so it moves nothing"));
  expect(list.scrollTop).toBe(0);

  toggleFold(true);
  expect(list.scrollTop).toBe(300);

  height = 500;
  show(toolCall("3", "second"));
  expect(fold().open).toBe(true);
  expect(fold().querySelector(".message-summary")?.textContent).toBe("second");
  expect(list.scrollTop).toBe(500);

  scrollListTo(100);
  height = 700;
  show(toolCall("4", "third"));
  expect(list.scrollTop).toBe(100);

  show(toolCall("5", ""));
  expect(page.querySelector("details")).toBeNull();
  show(toolCall("6", "fourth"));
  expect(fold().open).toBe(true);
  expect(list.scrollTop).toBe(100);

  toggleFold(false);
  toggleFold(true);
  expect(list.scrollTop).toBe(700);
  act(() => root.unmount());
});

it("shows a Handover note's first lines and the way to it when it reads whole elsewhere", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-01T10:00:00.000Z";
  const messages: Message[] = [
    { at, id: "1", kind: "handover-note", roleKey: "developer", text: "Held by a run" },
    { at, id: "2", kind: "handover-note", roleKey: "developer", text: "Held by no run" },
  ];
  const read: string[] = [];
  act(() =>
    root.render(
      <RenderedList
        messages={messages}
        personName="Jan"
        answering={false}
        stageThread
        details
        handoverNoteReader={(note) =>
          note === "Held by a run" ? () => void read.push(note) : undefined
        }
      />,
    ),
  );

  const [held, alone] = page.querySelectorAll(".handover-note");
  expect(held?.querySelector(".handover-note-start")).not.toBeNull();
  expect(alone?.querySelector(".handover-note-start")).toBeNull();
  expect(alone?.querySelector("button")).toBeNull();
  const readInFull = held?.querySelector("button");
  expect(readInFull?.textContent).toBe("Read it in full");
  act(() => readInFull?.click());
  expect(read).toEqual(["Held by a run"]);
  act(() => root.unmount());
});

it("shows the person working from the moment a turn starts, before any output", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const show = (answering: boolean): void =>
    act(() =>
      root.render(
        <RenderedList
          messages={[]}
          personName="Jan"
          answering={answering}
          stageThread={false}
          details
        />,
      ),
    );

  show(true);
  expect(page.querySelector('[role="status"] > span:not([aria-hidden])')?.textContent).toBe(
    "Jan is working",
  );
  show(false);
  expect(page.querySelector('[role="status"]')).toBeNull();
  act(() => root.unmount());
});

it("shows an MCP server that didn't start as The Office's line, with why when the engine said", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-01T10:00:00.000Z";
  const messages: Message[] = [
    {
      at,
      id: "1",
      kind: "mcp-server-not-started",
      server: "github",
      reason: "It exited with code 1: token [a Server value] refused.",
    },
    { at, id: "2", kind: "mcp-server-not-started", server: "linear", reason: null },
  ];

  act(() =>
    root.render(
      <RenderedList
        messages={messages}
        personName="Jan"
        answering={false}
        stageThread={true}
        details
      />,
    ),
  );

  expect([...page.querySelectorAll(".failed")].map((shown) => shown.textContent)).toEqual([
    "The MCP server github didn't start: It exited with code 1: token [a Server value] refused.",
    "The MCP server linear didn't start.",
  ]);
  act(() => root.unmount());
});

it("shows Allow changes and a held Stage as The Office's small notes, a run on a hairline", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-03T10:00:00.000Z";
  const messages: Message[] = [
    { at, id: "1", kind: "changes-allowed", allowed: true, by: null },
    { at, id: "2", kind: "changes-allowed", allowed: false, by: null },
    { at, id: "3", kind: "held", heldBy: "pause", text: "Paused by you" },
  ];

  act(() =>
    root.render(
      <RenderedList
        messages={messages}
        personName="Sam"
        answering={false}
        stageThread={false}
        details
        logLines={[{ id: "run", at, words: "Implement · run 2 done" }]}
      />,
    ),
  );

  expect([...page.querySelectorAll(".message-office")].map((shown) => shown.textContent)).toEqual([
    "Changes allowed",
    "Changes switched off",
    "Paused by you",
  ]);
  expect(page.querySelector(".message-log-line")?.textContent).toBe("Implement · run 2 done");
  act(() => root.unmount());
});

it("rules off a new session after /clear and folds the earlier one, closed, until opened", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-03T10:00:00.000Z";
  const contextLine = (
    id: string,
    move: "fresh" | "hand-off",
    reason: "new-thread" | "your-choice",
    contextTokens: number,
  ): Message => ({
    at,
    id,
    kind: "context",
    move,
    reason,
    contextTokens,
    briefTokens: 3_000,
    brief: `The Brief of ${id}`,
  });
  const messages: Message[] = [
    contextLine("c1", "fresh", "new-thread", 0),
    { at, id: "1", kind: "person", roleKey: "developer", text: "Before" },
    { at, id: "2", kind: "person", roleKey: "developer", text: "Still before" },
    toolCall("3", "npm test"),
    contextLine("c2", "fresh", "your-choice", 85_000),
    { at, id: "4", kind: "person", roleKey: "developer", text: "After" },
  ];
  const show = (details: boolean): void =>
    act(() =>
      root.render(
        <RenderedList
          messages={messages}
          personName="Jan"
          answering={false}
          stageThread={false}
          details={details}
        />,
      ),
    );

  show(false);
  const rule = page.querySelector(".session-rule");
  expect(rule?.querySelector(".session-rule-line")?.textContent).toBe(
    "New session · you chose it · brief ~3k",
  );
  expect(rule?.querySelector(".message-brief summary")?.textContent).toBe("Brief");
  const earlier = page.querySelector<HTMLDetailsElement>("details.earlier-session");
  expect(earlier?.open).toBe(false);
  expect(earlier?.querySelector("summary")?.textContent).toBe(
    "Earlier session · 2 messages · ended at 85k context",
  );
  // The current session stays open, after the rule.
  expect(page.querySelector(".message-list > .turn")?.textContent).toContain("After");

  if (!earlier) throw new Error("No earlier session.");
  earlier.open = true;
  act(() => void earlier.dispatchEvent(new Event("toggle")));
  // Opened, the earlier session shows as before: one turn of both messages.
  const turns = earlier.querySelectorAll(".earlier-session-log > .turn");
  expect(turns).toHaveLength(1);
  expect(turns[0]?.textContent).toContain("Still before");

  // With Details on, its context line and tool call count too.
  show(true);
  expect(earlier.querySelector("summary")?.textContent).toBe(
    "Earlier session · 4 messages · ended at 85k context",
  );
  expect(page.querySelectorAll(".session-rule")).toHaveLength(1);
  act(() => root.unmount());
});

it("shows a Thread with one session as a plain log", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-03T10:00:00.000Z";
  const messages: Message[] = [
    {
      at,
      id: "c1",
      kind: "context",
      move: "fresh",
      reason: "new-thread",
      contextTokens: 0,
      briefTokens: null,
      brief: null,
    },
    { at, id: "1", kind: "person", roleKey: "developer", text: "Hello" },
  ];

  act(() =>
    root.render(
      <RenderedList
        messages={messages}
        personName="Jan"
        answering={false}
        stageThread={false}
        details
      />,
    ),
  );

  expect(page.querySelector(".session-rule, .earlier-session")).toBeNull();
  expect(page.querySelector(".message-list > .message-office")?.textContent).toBe(
    "Fresh · new Thread",
  );
  act(() => root.unmount());
});
