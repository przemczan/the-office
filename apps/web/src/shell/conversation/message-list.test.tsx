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
