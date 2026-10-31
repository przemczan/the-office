import type { Message } from "@the-office/contracts";
import { act } from "react";
import { createRoot } from "react-dom/client";
import { expect, it } from "vitest";
import { MessageList } from "./message-list.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom lays nothing out; the list scrolls to its end as lines come.
Element.prototype.scrollIntoView = () => undefined;

it("shows the person working from the moment a turn starts, before any output", () => {
  const page = document.createElement("div");
  const root = createRoot(page);
  const show = (answering: boolean): void =>
    act(() =>
      root.render(
        <MessageList messages={[]} personName="Jan" answering={answering} stageThread={false} />,
      ),
    );

  show(true);
  expect(page.querySelector('[role="status"]')?.textContent).toBe("Jan is working…");
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
      <MessageList messages={messages} personName="Jan" answering={false} stageThread={true} />,
    ),
  );

  expect([...page.querySelectorAll(".message-line")].map((shown) => shown.textContent)).toEqual([
    "The MCP server github didn't start: It exited with code 1: token [a Server value] refused.",
    "The MCP server linear didn't start.",
  ]);
  act(() => root.unmount());
});
