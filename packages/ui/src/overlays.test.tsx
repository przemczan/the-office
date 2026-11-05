import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Drawer } from "./index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

let page: HTMLDivElement;
let root: Root;

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
});

function show(element: ReactNode): void {
  act(() => root.render(element));
}

function pressOn(element: Element | null | undefined): void {
  if (!element) throw new Error("Nothing to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

const backdrop = (): Element | null | undefined =>
  page.querySelector("[role=dialog]")?.parentElement;

// The design system's Button carries its own <style>, which isn't part of its name.
const nameOf = (button: Element): string =>
  button.getAttribute("aria-label") ??
  [...button.childNodes]
    .filter((node) => node.nodeName !== "STYLE")
    .map((node) => node.textContent)
    .join("")
    .trim();

const button = (scope: string, name: string): Element | undefined =>
  [...page.querySelectorAll(`${scope} button`)].find((candidate) => nameOf(candidate) === name);

const barButtons = (): string[] => [...page.querySelectorAll(".dialog-bar button")].map(nameOf);

describe.each([
  ["Dialog", (onClose: () => void) => <Dialog title="Remove Project" onClose={onClose} />],
  [
    "Dialog with the frame",
    (onClose: () => void) => <Dialog size="small" title="Remove Project" onClose={onClose} />,
  ],
  ["Drawer", (onClose: () => void) => <Drawer title="New Task" onClose={onClose} />],
])("%s", (_, overlay) => {
  it("stays open on a press on its backdrop", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    pressOn(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("closes on its Close button", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    pressOn(button("[role=dialog]", "Close"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("closes on Escape", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("Dialog's frame", () => {
  it("shows its title in the head, named by it, with an X that closes it", () => {
    const onClose = vi.fn<() => void>();
    show(<Dialog size="medium" title="New Task" onClose={onClose} />);

    const dialog = page.querySelector("[role=dialog]");
    const title = dialog?.querySelector(".dialog-head h2");
    expect(title?.textContent).toBe("New Task");
    expect(dialog?.getAttribute("aria-labelledby")).toBe(title?.id);

    pressOn(button(".dialog-head", "Close (Esc)"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("puts its actions on the left of the bar and Close on the right", () => {
    show(
      <Dialog
        size="small"
        title="Drop the Task"
        actions={
          <>
            <button>Keep it</button>
            <button>Drop</button>
          </>
        }
        onClose={() => {}}
      />,
    );

    expect(barButtons()).toEqual(["Keep it", "Drop", "Close"]);
  });

  it("keeps Close in the bar when it has no other actions", () => {
    show(<Dialog size="large" title="Stage history" onClose={() => {}} />);

    expect(barButtons()).toEqual(["Close"]);
  });

  it("holds its content in a body apart from the head and the bar", () => {
    show(
      <Dialog size="large" title="Gate" onClose={() => {}}>
        <p>Waits for your review</p>
      </Dialog>,
    );

    expect(page.querySelector(".dialog-body")?.textContent).toBe("Waits for your review");
  });

  it.each(["small", "medium", "large"] as const)("takes its size: %s", (size) => {
    show(<Dialog size={size} title="Drop" onClose={() => {}} />);

    expect(page.querySelector("[role=dialog]")?.className).toBe(`dialog-frame ${size}`);
  });

  it("keeps one height when large and asked to", () => {
    show(<Dialog size="large" keepsHeight title="Stage history" onClose={() => {}} />);

    expect(page.querySelector("[role=dialog]")?.className).toBe("dialog-frame large keeps-height");
  });

  it("opens a step over the bar, whose actions and Cancel take the place of the bar's", () => {
    const onCancel = vi.fn<() => void>();
    show(
      <Dialog
        size="large"
        title="Gate"
        actions={<button>Send back with notes…</button>}
        step={{
          content: <textarea aria-label="Notes" />,
          actions: <button>Send back</button>,
          onCancel,
        }}
        onClose={() => {}}
      />,
    );

    expect(page.querySelector(".dialog-step textarea")).not.toBeNull();
    expect(barButtons()).toEqual(["Send back", "Cancel", "Close"]);

    pressOn(button(".dialog-bar", "Cancel"));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows nothing while not open, and Escape doesn't reach its onClose", () => {
    const onClose = vi.fn<() => void>();
    show(<Dialog open={false} size="small" title="Drop" onClose={onClose} />);

    act(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })));

    expect(page.querySelector("[role=dialog]")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });
});
