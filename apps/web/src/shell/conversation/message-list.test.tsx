import type { Message } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MessageList } from "./message-list.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// scrollIntoView scrolls the page around the list too; only the list may scroll.
Element.prototype.scrollIntoView = () => {
  throw new Error("Only the message list scrolls, never the page around it.");
};

it("scrolls only the list to its end as a message comes or the person starts to answer", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-01T10:00:00.000Z";
  const messages: Message[] = [];
  const show = (answering: boolean): void =>
    act(() =>
      root.render(
        <MessageList
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

it("shows the person working from the moment a turn starts, before any output", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const show = (answering: boolean): void =>
    act(() =>
      root.render(
        <MessageList
          messages={[]}
          personName="Jan"
          answering={answering}
          stageThread={false}
          details
        />,
      ),
    );

  show(true);
  expect(page.querySelector('[role="status"]')?.textContent).toBe("Jan is working");
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
      <MessageList
        messages={messages}
        personName="Jan"
        answering={false}
        stageThread={true}
        details
      />,
    ),
  );

  expect([...page.querySelectorAll(".message-line")].map((shown) => shown.textContent)).toEqual([
    "The MCP server github didn't start: It exited with code 1: token [a Server value] refused.",
    "The MCP server linear didn't start.",
  ]);
  act(() => root.unmount());
});

it("shows Allow changes switched on and off as The Office's lines", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const at = "2026-11-03T10:00:00.000Z";
  const messages: Message[] = [
    { at, id: "1", kind: "changes-allowed", allowed: true },
    { at, id: "2", kind: "changes-allowed", allowed: false },
  ];

  act(() =>
    root.render(
      <MessageList
        messages={messages}
        personName="Sam"
        answering={false}
        stageThread={false}
        details
      />,
    ),
  );

  expect([...page.querySelectorAll(".message-office")].map((shown) => shown.textContent)).toEqual([
    "Changes allowed",
    "Changes switched off",
  ]);
  act(() => root.unmount());
});
