import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { FloatingMenu } from "./floating-menu.tsx";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;
// jsdom has no ResizeObserver; the list's placing only needs it to exist.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

let page: HTMLDivElement;
let root: Root;
const archived = vi.fn<() => void>();

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
  act(() =>
    root.render(
      <FloatingMenu
        trigger={<button type="button">More</button>}
        items={[
          { heading: "Priority" },
          { label: "High" },
          { label: "Low", disabled: true },
          { divider: true },
          { label: "Archive", onSelect: archived },
          { label: "Drop…", danger: true },
        ]}
      />,
    ),
  );
});

afterEach(() => {
  act(() => root.unmount());
  document.body.replaceChildren();
  archived.mockReset();
});

function trigger(): HTMLButtonElement {
  const found = page.querySelector("button");
  if (found === null) throw new Error("The menu has no trigger.");
  return found;
}

function focusedLabel(): string | null | undefined {
  return document.activeElement?.textContent;
}

function press(key: string): void {
  act(() => {
    document.activeElement?.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

function opened(): void {
  act(() => trigger().focus());
  act(() => trigger().click());
}

it("lists its items as a menu's, and takes focus to the first as it opens", () => {
  opened();

  const items = [...document.body.querySelectorAll('[role="menu"] [role="menuitem"]')];
  expect(items.map(({ textContent }) => textContent)).toEqual(["High", "Low", "Archive", "Drop…"]);
  expect(focusedLabel()).toBe("High");
});

it("moves focus with the arrow keys, Home and End, skipping what can't be chosen and going round", () => {
  opened();

  press("ArrowDown");
  expect(focusedLabel()).toBe("Archive");
  press("End");
  expect(focusedLabel()).toBe("Drop…");
  press("ArrowDown");
  expect(focusedLabel()).toBe("High");
  press("ArrowUp");
  expect(focusedLabel()).toBe("Drop…");
  press("Home");
  expect(focusedLabel()).toBe("High");
});

it("closes on Escape, giving focus back to its trigger", () => {
  opened();

  press("Escape");

  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});

it("closes once an item is chosen, giving focus back to its trigger", () => {
  opened();
  press("ArrowDown");

  act(() => (document.activeElement as HTMLButtonElement).click());

  expect(archived).toHaveBeenCalledOnce();
  expect(document.body.querySelector('[role="menu"]')).toBeNull();
  expect(document.activeElement).toBe(trigger());
});
