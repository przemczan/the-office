import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, PlainMark, Popover } from "./index.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

// jsdom has no layout, so nothing ever resizes.
globalThis.ResizeObserver = class {
  observe(): void {}
  unobserve(): void {}
  disconnect(): void {}
};

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
  vi.restoreAllMocks();
});

function show(element: ReactNode): void {
  act(() => root.render(element));
}

function blockers(label = "Blocked by 2 Tasks"): ReactNode {
  return (
    <Popover label={label} trigger="2" tooltip={`${label}: press for them`}>
      <a href="#import">Name the import formats</a>
      <a href="#export">Agree the export columns</a>
    </Popover>
  );
}

const trigger = (label = "Blocked by 2 Tasks"): HTMLButtonElement => {
  const found = document.querySelector<HTMLButtonElement>(`button[aria-label="${label}"]`);
  if (!found) throw new Error(`No ${label}`);
  return found;
};

const popovers = (): Element[] => [...document.querySelectorAll(".popover")];

/** A press with the pointer, which has a click count, unlike Enter or Space. */
function press(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true, detail: 1 }));
  });
}

function pressKey(key: string, target: Element = document.activeElement ?? document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("Popover", () => {
  it("opens on a press, on the body, named as its trigger, which says it is open", () => {
    show(blockers());
    expect(popovers()).toHaveLength(0);
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    press(trigger());

    const [popover] = popovers();
    expect(popover?.parentElement).toBe(document.body);
    expect(popover?.getAttribute("role")).toBe("dialog");
    expect(popover?.getAttribute("aria-label")).toBe("Blocked by 2 Tasks");
    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    expect(trigger().getAttribute("aria-controls")).toBe(popover?.id);
  });

  it("closes on a second press of its trigger", () => {
    show(blockers());
    press(trigger());

    press(trigger());

    expect(popovers()).toHaveLength(0);
  });

  it("closes on a press anywhere else, and stays for a press inside it", () => {
    show(
      <>
        {blockers()}
        <p data-elsewhere>Elsewhere</p>
      </>,
    );
    press(trigger());

    act(() => {
      popovers()[0]?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(popovers()).toHaveLength(1);

    act(() => {
      document
        .querySelector("[data-elsewhere]")
        ?.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
    });
    expect(popovers()).toHaveLength(0);
  });

  it("closes when one of its links is followed", () => {
    show(blockers());
    press(trigger());

    act(() => popovers()[0]?.querySelector("a")?.click());

    expect(popovers()).toHaveLength(0);
  });

  it("closes on Escape, giving focus back to its trigger, before the window under it", () => {
    const onClose = vi.fn<() => void>();
    show(
      <Dialog size="medium" title="A window" onClose={onClose}>
        {blockers()}
      </Dialog>,
    );
    press(trigger());

    pressKey("Escape", popovers()[0]);

    expect(popovers()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
    expect(onClose).not.toHaveBeenCalled();

    pressKey("Escape", trigger());
    expect(onClose).toHaveBeenCalledOnce();
  });

  it("is one at a time: opening another closes the first", () => {
    show(
      <>
        {blockers()}
        {blockers("Queued")}
      </>,
    );
    press(trigger());

    press(trigger("Queued"));

    expect(popovers()).toHaveLength(1);
    expect(popovers()[0]?.getAttribute("aria-label")).toBe("Queued");
  });

  it("takes focus to its first link when opened by keyboard, and back to its trigger before it", () => {
    show(blockers());
    act(() => trigger().focus());

    // Enter or Space on a button clicks it with no click count.
    act(() => trigger().click());

    const links = popovers()[0]?.querySelectorAll("a");
    expect(document.activeElement).toBe(links?.[0]);

    act(() => {
      links?.[0]?.dispatchEvent(
        new KeyboardEvent("keydown", { key: "Tab", shiftKey: true, bubbles: true }),
      );
    });
    expect(document.activeElement).toBe(trigger());
  });

  it("closes as Tab leaves its last link, from its trigger", () => {
    show(blockers());
    act(() => trigger().click());
    const last = popovers()[0]?.querySelectorAll("a")[1];
    act(() => last?.focus());

    pressKey("Tab", last);

    expect(popovers()).toHaveLength(0);
    expect(document.activeElement).toBe(trigger());
  });

  it("leaves a mouse press's focus where it is", () => {
    show(blockers());

    press(trigger());

    expect(popovers()[0]?.contains(document.activeElement)).toBe(false);
  });

  it("held open from elsewhere, asks for each change instead of making it", () => {
    const asked = vi.fn<(open: boolean) => void>();
    const held = (open: boolean): ReactNode => (
      <Popover label="Jim" trigger="Jim" open={open} onOpenChange={asked}>
        <a href="#task">A Stage of a Task</a>
      </Popover>
    );
    show(held(true));
    expect(popovers()).toHaveLength(1);

    pressKey("Escape");
    expect(asked).toHaveBeenLastCalledWith(false);
    expect(popovers()).toHaveLength(1);

    show(held(false));
    press(trigger("Jim"));
    expect(asked).toHaveBeenLastCalledWith(true);
    expect(popovers()).toHaveLength(0);
  });
});

describe("PlainMark", () => {
  it("is a focus stop named by its words, which show in the tooltip on focus", () => {
    show(<PlainMark words="Waiting on you">!</PlainMark>);
    const focusStop = document.querySelector<HTMLElement>(".tooltip-trigger");

    act(() => focusStop?.focus());

    expect(focusStop?.tabIndex).toBe(0);
    expect(document.querySelector('[role="img"]')?.getAttribute("aria-label")).toBe(
      "Waiting on you",
    );
    expect(document.querySelector('[role="tooltip"]')?.textContent).toBe("Waiting on you");
  });

  it("shows its words in a popover on a press on a screen without hover", () => {
    vi.spyOn(window, "matchMedia").mockImplementation(
      (query) =>
        ({
          matches: query === "(hover: none)",
          media: query,
          addEventListener: () => {},
          removeEventListener: () => {},
        }) as unknown as MediaQueryList,
    );
    show(<PlainMark words="Usage window used up · resumes 14:00">!</PlainMark>);

    press(trigger("Usage window used up · resumes 14:00"));

    expect(popovers()[0]?.textContent).toBe("Usage window used up · resumes 14:00");
  });
});
