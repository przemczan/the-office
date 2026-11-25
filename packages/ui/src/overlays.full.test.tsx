import { act, useRef, useState, type ReactNode } from "react";
import { createPortal, flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Drawer, Tooltip, useCloseOnEscape, useEscapeWaitsFor } from "./index.ts";

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
});

function show(element: ReactNode): void {
  act(() => root.render(element));
}

/** As a real key press: from the page up to `window`, where the design system's Drawer listens. */
function pressEscape(target: Element = document.body): void {
  act(() => {
    target.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  });
}

function pressOn(element: Element | null | undefined): void {
  if (!element) throw new Error("Nothing to press");
  act(() => element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true })));
}

function dispatch(element: Element, type: string): void {
  act(() => element.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true })));
}

/**
 * As a real press: `pointerdown` where it starts, `pointerup` where it ends, and the click on what
 * holds both, as a browser sends it.
 */
function pressFrom(
  start: Element | null | undefined,
  end: Element | null | undefined = start,
  clicked: Element | null | undefined = end,
): void {
  if (!start || !end || !clicked) throw new Error("Nothing to press");
  dispatch(start, "pointerdown");
  dispatch(end, "pointerup");
  dispatch(clicked, "click");
}

function typeInto(field: Element | null | undefined): void {
  if (!field) throw new Error("Nothing to type into");
  act(() => field.dispatchEvent(new Event("input", { bubbles: true })));
}

const backdrop = (): Element | null | undefined =>
  document.querySelector("[role=dialog]")?.parentElement;

const backdrops = (): Element[] =>
  [...document.querySelectorAll("[role=dialog]")].flatMap(({ parentElement }) =>
    parentElement ? [parentElement] : [],
  );

// The design system's Button carries its own <style>, which isn't part of its name.
const nameOf = (button: Element): string =>
  button.getAttribute("aria-label") ??
  [...button.childNodes]
    .filter((node) => node.nodeName !== "STYLE")
    .map((node) => node.textContent)
    .join("")
    .trim();

const button = (scope: string, name: string): Element | undefined =>
  [...document.querySelectorAll(`${scope} button`)].find((candidate) => nameOf(candidate) === name);

const barButtons = (): string[] => [...document.querySelectorAll(".dialog-bar button")].map(nameOf);

const frame = (): Element | null => document.querySelector("[role=dialog]");

/** A preview kept mounted while closed, as a window opened and closed again. */
function Preview({ open }: { readonly open: boolean }): ReactNode {
  return (
    <Dialog open={open} size="extra-large" maximizable title="report.html" onClose={() => {}} />
  );
}

describe.each([
  [
    "Dialog",
    (onClose: () => void) => <Dialog size="small" title="Remove Project" onClose={onClose} />,
  ],
  ["Drawer", (onClose: () => void) => <Drawer title="New Task" onClose={onClose} />],
])("%s", (_, overlay) => {
  it("closes on a press on its backdrop", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    pressFrom(backdrop());

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("stays open on a press that starts inside it and ends on its backdrop", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    // The click lands on what holds both ends of the press: the backdrop.
    pressFrom(document.querySelector("[role=dialog] h2, [role=dialog] h3"), backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open on a press that starts on its backdrop and ends inside it", () => {
    const onClose = vi.fn<() => void>();
    show(overlay(onClose));

    pressFrom(backdrop(), document.querySelector("[role=dialog] h2, [role=dialog] h3"), backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });

  it("stays open on a press on its backdrop while a menu inside is open, which closes alone", () => {
    const onClose = vi.fn<() => void>();
    show(
      <>
        {overlay(onClose)}
        <div role="menu" />
      </>,
    );

    pressFrom(backdrop());

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

    pressEscape();

    expect(onClose).toHaveBeenCalledOnce();
  });
});

const stepText = (): string | null | undefined =>
  document.querySelector(".dialog-step")?.textContent;

function NewTask({
  onClose,
  unsavedChanges,
}: {
  readonly onClose: () => void;
  readonly unsavedChanges?: boolean;
}): ReactNode {
  return (
    <Dialog
      size="medium"
      title="New Task"
      actions={<button>Create</button>}
      unsavedChanges={unsavedChanges}
      onClose={onClose}
    >
      <input aria-label="Title" />
    </Dialog>
  );
}

describe("a press outside a window holding unsaved input", () => {
  it("asks first in a step over the bar once something was typed", () => {
    const onClose = vi.fn<() => void>();
    show(<NewTask onClose={onClose} />);
    typeInto(document.querySelector("input"));

    pressFrom(backdrop());

    expect(onClose).not.toHaveBeenCalled();
    expect(stepText()).toBe("Close without saving? What you entered here will be lost.");
    expect(barButtons()).toEqual(["Close without saving", "Cancel", "Close"]);
  });

  it("keeps the window and what was typed on Cancel", () => {
    const onClose = vi.fn<() => void>();
    show(<NewTask onClose={onClose} />);
    const title = document.querySelector("input");
    if (title) title.value = "Fix the login";
    typeInto(title);
    pressFrom(backdrop());

    pressOn(button(".dialog-bar", "Cancel"));

    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelector(".dialog-step")).toBeNull();
    expect(barButtons()).toEqual(["Create", "Close"]);
    expect(document.querySelector("input")?.value).toBe("Fix the login");
  });

  it("closes on Close without saving", () => {
    const onClose = vi.fn<() => void>();
    show(<NewTask onClose={onClose} />);
    typeInto(document.querySelector("input"));
    pressFrom(backdrop());

    pressOn(button(".dialog-bar", "Close without saving"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("counts input in a picker portalled out of the window", () => {
    const onClose = vi.fn<() => void>();
    const picker = document.createElement("div");
    document.body.append(picker);
    show(
      <Dialog size="medium" title="New Task" onClose={onClose}>
        {createPortal(<input aria-label="Find a Project" />, picker)}
      </Dialog>,
    );
    typeInto(picker.querySelector("input"));

    pressFrom(backdrop());

    expect(onClose).not.toHaveBeenCalled();
    expect(stepText()).toContain("Close without saving?");
    picker.remove();
  });

  it("closes without asking when the window says nothing is lost, as a search", () => {
    const onClose = vi.fn<() => void>();
    show(<NewTask onClose={onClose} unsavedChanges={false} />);
    typeInto(document.querySelector("input"));

    pressFrom(backdrop());

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("asks without anything typed when the window says it holds unsaved input", () => {
    const onClose = vi.fn<() => void>();
    show(<NewTask onClose={onClose} unsavedChanges />);

    pressFrom(backdrop());

    expect(onClose).not.toHaveBeenCalled();
    expect(stepText()).toContain("Close without saving?");
  });

  it("takes the place of the window's own step, which Cancel brings back as it was", () => {
    const onCancel = vi.fn<() => void>();
    show(
      <Dialog
        size="small"
        title="Drop"
        step={{
          content: <textarea aria-label="Reason" />,
          actions: <button>Drop</button>,
          onCancel,
        }}
        onClose={() => {}}
      />,
    );
    const reason = document.querySelector("textarea");
    if (reason) reason.value = "Done elsewhere";
    typeInto(reason);
    pressFrom(backdrop());

    expect(document.querySelector(".dialog-step:not([hidden]) textarea")).toBeNull();
    expect(barButtons()).toEqual(["Close without saving", "Cancel", "Close"]);

    pressOn(button(".dialog-bar", "Cancel"));

    expect(onCancel).not.toHaveBeenCalled();
    expect(document.querySelectorAll(".dialog-step")).toHaveLength(1);
    expect(
      document.querySelector<HTMLTextAreaElement>(".dialog-step:not([hidden]) textarea")?.value,
    ).toBe("Done elsewhere");
    expect(barButtons()).toEqual(["Drop", "Cancel", "Close"]);
  });

  it("leaves Escape, the X and Close to close at once", () => {
    for (const close of [
      () => pressEscape(),
      () => pressOn(button(".dialog-head", "Close (Esc)")),
      () => pressOn(button(".dialog-bar", "Close")),
    ]) {
      const onClose = vi.fn<() => void>();
      show(<NewTask onClose={onClose} />);
      typeInto(document.querySelector("input"));

      close();

      expect(onClose).toHaveBeenCalledOnce();
      act(() => root.render(null));
    }
  });

  it("opens again with nothing entered after it was closed", () => {
    const onClose = vi.fn<() => void>();
    show(
      <Dialog open size="medium" title="New Task" onClose={onClose}>
        <input aria-label="Title" />
      </Dialog>,
    );
    typeInto(document.querySelector("input"));
    show(<Dialog open={false} size="medium" title="New Task" onClose={onClose} />);
    show(<Dialog open size="medium" title="New Task" onClose={onClose} />);

    pressFrom(backdrop());

    expect(onClose).toHaveBeenCalledOnce();
  });
});

describe("a press outside a window over another", () => {
  it("closes only the Attachment viewer over a window", () => {
    const onCloseUnder = vi.fn<() => void>();
    show(<WindowWithViewer onCloseUnder={onCloseUnder} />);
    pressOn(button(".dialog-body", "View today.png"));

    pressFrom(backdrops().at(-1));

    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(onCloseUnder).not.toHaveBeenCalled();
  });

  it("closes only the window over the Needs you panel", () => {
    const onClosePanel = vi.fn<() => void>();
    show(<PanelWithWindow onClosePanel={onClosePanel} />);
    pressOn(button("aside", "Open details"));

    pressFrom(document.querySelector(".dialog-backdrop"));

    expect(document.querySelector(".dialog-frame")).toBeNull();
    expect(onClosePanel).not.toHaveBeenCalled();
  });

  it("waits for a picker inside that isn't the design system's", () => {
    const onClose = vi.fn<() => void>();
    show(
      <Dialog size="medium" title="New Task" onClose={onClose}>
        <MenuOfItsOwn />
      </Dialog>,
    );

    pressFrom(backdrop());

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("Dialog's frame", () => {
  it("shows its title in the head, named by it, with an X that closes it", () => {
    const onClose = vi.fn<() => void>();
    show(<Dialog size="medium" title="New Task" onClose={onClose} />);

    const dialog = document.querySelector("[role=dialog]");
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

    expect(document.querySelector(".dialog-body")?.textContent).toBe("Waits for your review");
  });

  it.each(["small", "medium", "large", "extra-large"] as const)("takes its size: %s", (size) => {
    show(<Dialog size={size} title="Drop" onClose={() => {}} />);

    expect(document.querySelector("[role=dialog]")?.className).toBe(`dialog-frame ${size}`);
  });

  it("offers no Maximize unless it is maximizable", () => {
    show(<Dialog size="extra-large" title="report.html" onClose={() => {}} />);

    expect(button(".dialog-head", "Maximize")).toBeUndefined();
  });

  it("maximizes, and Restore brings back its own size", () => {
    show(<Dialog size="extra-large" maximizable title="report.html" onClose={() => {}} />);

    pressOn(button(".dialog-head", "Maximize"));

    expect(frame()?.className).toBe("dialog-frame extra-large maximized");
    expect(backdrop()?.className).toBe("dialog-backdrop maximized");
    expect(button(".dialog-head", "Maximize")).toBeUndefined();

    pressOn(button(".dialog-head", "Restore"));

    expect(frame()?.className).toBe("dialog-frame extra-large");
    expect(backdrop()?.className).toBe("dialog-backdrop");
    expect(button(".dialog-head", "Maximize")).toBeDefined();
  });

  it("opens again at its own size after it was closed maximized", () => {
    show(<Preview open />);
    pressOn(button(".dialog-head", "Maximize"));

    show(<Preview open={false} />);
    show(<Preview open />);

    expect(document.querySelector("[role=dialog]")?.className).toBe("dialog-frame extra-large");
  });

  it("closes from its X while maximized", () => {
    const onClose = vi.fn<() => void>();
    show(<Dialog size="extra-large" maximizable title="report.html" onClose={onClose} />);
    pressOn(button(".dialog-head", "Maximize"));

    pressOn(button(".dialog-head", "Close (Esc)"));

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("keeps one height when large and asked to", () => {
    show(<Dialog size="large" keepsHeight title="Stage history" onClose={() => {}} />);

    expect(document.querySelector("[role=dialog]")?.className).toBe(
      "dialog-frame large keeps-height",
    );
  });

  it("keeps one height when medium and asked to", () => {
    show(<Dialog size="medium" keepsHeight title="Add a Project" onClose={() => {}} />);

    expect(document.querySelector("[role=dialog]")?.className).toBe(
      "dialog-frame medium keeps-height",
    );
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

    expect(document.querySelector(".dialog-step textarea")).not.toBeNull();
    expect(barButtons()).toEqual(["Send back", "Cancel", "Close"]);

    pressOn(button(".dialog-bar", "Cancel"));

    expect(onCancel).toHaveBeenCalledOnce();
  });

  it("shows nothing while not open, and Escape doesn't reach its onClose", () => {
    const onClose = vi.fn<() => void>();
    show(<Dialog open={false} size="small" title="Drop" onClose={onClose} />);

    pressEscape();

    expect(document.querySelector("[role=dialog]")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();
  });

  it("sits on the body, over the whole page, not where it was opened", () => {
    show(<Dialog size="small" title="Drop" onClose={() => undefined} />);

    expect(document.querySelector("[role=dialog]")?.closest("body > *")).not.toBe(page);
  });

  it("leaves Escape to a window opened over it, such as the Attachment viewer", () => {
    const onCloseUnder = vi.fn<() => void>();
    const onCloseOver = vi.fn<() => void>();
    show(<Dialog size="large" title="Decision" onClose={onCloseUnder} />);
    show(
      <Dialog size="large" title="Decision" onClose={onCloseUnder}>
        <Dialog size="large" title="today.png" onClose={onCloseOver} />
      </Dialog>,
    );

    pressEscape();

    expect(onCloseOver).toHaveBeenCalledOnce();
    expect(onCloseUnder).not.toHaveBeenCalled();
  });

  // A real key press lets React commit between two listeners, which flushSync stands in for here.
  // Showing the windows again moves the one under to listen last, as any re-render of it does.
  it("stays open when the window over it closes on the same Escape, before its turn", () => {
    const onCloseUnder = vi.fn<() => void>();
    const windows = (): ReactNode => <WindowWithViewer onCloseUnder={() => onCloseUnder()} />;
    show(windows());
    pressOn(button(".dialog-body", "View today.png"));
    show(windows());

    pressEscape();

    expect(document.querySelectorAll("[role=dialog]")).toHaveLength(1);
    expect(onCloseUnder).not.toHaveBeenCalled();
  });

  it("closes alone over a panel, and the next Escape closes the panel", () => {
    const onClosePanel = vi.fn<() => void>();
    show(<PanelWithWindow onClosePanel={onClosePanel} />);
    pressOn(button("aside", "Open details"));

    pressEscape();

    expect(document.querySelector(".dialog-frame")).toBeNull();
    expect(onClosePanel).not.toHaveBeenCalled();

    pressEscape();

    expect(onClosePanel).toHaveBeenCalledOnce();
  });

  it("leaves the panel's X working after an Escape closed the window over it", () => {
    const onClosePanel = vi.fn<() => void>();
    show(<PanelWithWindow onClosePanel={onClosePanel} />);
    pressOn(button("aside", "Open details"));
    pressEscape();

    pressOn(document.querySelector('aside button[aria-label="Close"]'));

    expect(onClosePanel).toHaveBeenCalledOnce();
  });
});

describe("useCloseOnEscape", () => {
  it("closes a panel that is no window, from anywhere on the page", () => {
    const onClose = vi.fn<() => void>();
    show(<SidePanel onClose={onClose} />);

    pressEscape();

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("leaves a window opened from the panel to close alone, with focus still in the panel", () => {
    const onClose = vi.fn<() => void>();
    show(<SidePanel onClose={onClose} />);
    const opener = document.querySelector(".side-panel button") ?? document.body;
    pressOn(opener);

    pressEscape(opener);

    expect(document.querySelector(".dialog-frame")).toBeNull();
    expect(onClose).not.toHaveBeenCalled();

    pressEscape(opener);

    expect(onClose).toHaveBeenCalledOnce();
  });

  it("does nothing while closed", () => {
    const onClose = vi.fn<() => void>();
    show(<SidePanel open={false} onClose={onClose} />);

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });
});

describe("the order of the side panels", () => {
  it("closes the one opened last, one a press, whichever kind it is", () => {
    const closed: string[] = [];
    show(<OpeningPanels onClose={(name) => closed.push(name)} />);
    openPanel("chat");
    openPanel("needs-you");
    openPanel("conversation");

    pressEscape();
    expect(closed).toEqual(["conversation"]);
    pressEscape();
    expect(closed).toEqual(["conversation", "needs-you"]);
    pressEscape();
    expect(closed).toEqual(["conversation", "needs-you", "chat"]);
  });

  it("follows the order they opened in, not their place in the document", () => {
    const closed: string[] = [];
    show(<OpeningPanels onClose={(name) => closed.push(name)} />);
    openPanel("conversation");
    openPanel("chat");

    pressEscape();

    expect(closed).toEqual(["chat"]);
  });

  it("goes back to the earlier one when a later one closes by other means", () => {
    const closed: string[] = [];
    show(<OpeningPanels onClose={(name) => closed.push(name)} />);
    openPanel("chat");
    openPanel("needs-you");
    openPanel("needs-you");

    pressEscape();

    expect(closed).toEqual(["chat"]);
  });

  it("lets a window over them close first, with the design system's Drawer among them", () => {
    const onClosePanel = vi.fn<() => void>();
    const onCloseDrawer = vi.fn<() => void>();
    const onCloseWindow = vi.fn<() => void>();
    show(
      <>
        <SidePanelInOrder onClose={onClosePanel} />
        <Drawer title="Needs you" onClose={onCloseDrawer} />
        <Dialog size="small" title="Allow changes" onClose={onCloseWindow} />
      </>,
    );

    pressEscape();

    expect(onCloseWindow).toHaveBeenCalledOnce();
    expect(onCloseDrawer).not.toHaveBeenCalled();
    expect(onClosePanel).not.toHaveBeenCalled();
  });

  it("leaves Escape to an open menu, which closes on `window`, with nothing else closing", () => {
    const onClosePanel = vi.fn<() => void>();
    const onCloseMenu = vi.fn<() => void>();
    window.addEventListener("keydown", onCloseMenu);
    show(
      <>
        <SidePanelInOrder onClose={onClosePanel} />
        <div role="menu" />
      </>,
    );

    pressEscape();

    expect(onCloseMenu).toHaveBeenCalledOnce();
    expect(onClosePanel).not.toHaveBeenCalled();
    window.removeEventListener("keydown", onCloseMenu);
  });

  it("keeps the design system's Drawer open as Escape passes it for a menu", () => {
    const onClose = vi.fn<() => void>();
    show(
      <Drawer title="Needs you" onClose={onClose}>
        <div role="menu" />
      </Drawer>,
    );

    pressEscape();

    expect(onClose).not.toHaveBeenCalled();
  });

  it("waits the same for a menu that isn't the design system's", () => {
    const onClosePanel = vi.fn<() => void>();
    show(
      <>
        <SidePanelInOrder onClose={onClosePanel} />
        <MenuOfItsOwn />
      </>,
    );

    pressEscape();

    expect(onClosePanel).not.toHaveBeenCalled();
  });
});

function trigger(): HTMLElement {
  const found = document.querySelector<HTMLElement>("button[data-trigger]");
  if (found === null) throw new Error("No trigger on the page");
  return found;
}

function tooltip(): HTMLElement | null {
  return document.querySelector('[role="tooltip"]');
}

function hover(): void {
  act(() => {
    trigger().dispatchEvent(new MouseEvent("mouseover", { bubbles: true }));
  });
}

function scroll(selector: string): void {
  act(() => {
    document.querySelector(selector)?.dispatchEvent(new Event("scroll"));
  });
}

function tooltipOn(open?: boolean): ReactNode {
  return (
    <Tooltip content="All the tokens" open={open}>
      <button type="button" data-trigger>
        Tokens
      </button>
    </Tooltip>
  );
}

/** A Tooltip held open on a trigger with no size, as a chart's hovered point holds one. */
function heldOpen(point: string): ReactNode {
  return (
    <Tooltip content={point} open>
      <span />
    </Tooltip>
  );
}

describe("Tooltip", () => {
  it("shows on hover and goes when the pointer leaves", () => {
    show(tooltipOn());
    expect(tooltip()).toBeNull();

    hover();
    expect(tooltip()?.textContent).toBe("All the tokens");

    act(() => {
      trigger().dispatchEvent(
        new MouseEvent("mouseout", { bubbles: true, relatedTarget: document.body }),
      );
    });
    expect(tooltip()).toBeNull();
  });

  it("shows on focus and goes on blur", () => {
    show(tooltipOn());

    act(() => trigger().focus());
    expect(tooltip()).not.toBeNull();

    act(() => trigger().blur());
    expect(tooltip()).toBeNull();
  });

  it("sits on the body, placed, not inside its trigger", () => {
    show(tooltipOn());
    hover();

    expect(tooltip()?.parentElement).toBe(document.body);
    expect(tooltip()?.style.visibility).toBe("");
    expect(tooltip()?.style.left).not.toBe("");
  });

  it("follows `open` over the pointer", () => {
    show(tooltipOn(false));
    hover();
    expect(tooltip()).toBeNull();

    show(tooltipOn(true));
    expect(tooltip()).not.toBeNull();
  });

  it("is placed when it mounts open, and moves with its trigger while held open", () => {
    vi.spyOn(document.documentElement, "clientWidth", "get").mockReturnValue(1_000);
    vi.spyOn(document.documentElement, "clientHeight", "get").mockReturnValue(800);
    let triggerLeft = 100;
    vi.spyOn(HTMLElement.prototype, "getBoundingClientRect").mockImplementation(function (
      this: HTMLElement,
    ) {
      const left = this.classList.contains("tooltip-trigger") ? triggerLeft : 0;
      const width = this.classList.contains("tooltip") ? 40 : 0;
      return DOMRect.fromRect({ x: left, y: 400, width, height: 0 });
    });
    try {
      show(heldOpen("first point"));
      expect(tooltip()?.style.visibility).toBe("");
      expect(tooltip()?.style.left).toBe("80px");

      triggerLeft = 500;
      show(heldOpen("second point"));
      expect(tooltip()?.textContent).toBe("second point");
      expect(tooltip()?.style.left).toBe("480px");
    } finally {
      vi.restoreAllMocks();
    }
  });

  it("closes when what holds the trigger scrolls, and stays for any other scroller", () => {
    show(
      <>
        <div data-scroller>{tooltipOn()}</div>
        <div data-log />
      </>,
    );
    hover();

    scroll("[data-log]");
    expect(tooltip()).not.toBeNull();

    scroll("[data-scroller]");
    expect(tooltip()).toBeNull();
  });

  it("closes when the window resizes", () => {
    show(tooltipOn());
    hover();

    act(() => {
      window.dispatchEvent(new Event("resize"));
    });
    expect(tooltip()).toBeNull();
  });

  it("goes with its trigger", () => {
    show(tooltipOn());
    hover();

    show(null);
    expect(tooltip()).toBeNull();
  });

  it("shows over a window without becoming what Escape closes", () => {
    const onClose = vi.fn<() => void>();
    show(
      <Dialog size="small" title="Usage" onClose={onClose}>
        {tooltipOn()}
      </Dialog>,
    );
    hover();

    expect(tooltip()?.parentElement).toBe(document.body);
    pressEscape(trigger());
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function PanelWithWindow({ onClosePanel }: { readonly onClosePanel: () => void }): ReactNode {
  const [details, setDetails] = useState(false);
  return (
    <Drawer title="Needs you" onClose={onClosePanel}>
      <button onClick={() => setDetails(true)}>Open details</button>
      {details && (
        <Dialog
          size="large"
          title="Decision"
          onClose={() => {
            flushSync(() => setDetails(false));
          }}
        />
      )}
    </Drawer>
  );
}

const PANELS = ["chat", "needs-you", "conversation"] as const;
type PanelName = (typeof PANELS)[number];

function openPanel(name: PanelName): void {
  pressOn(document.querySelector(`[data-toggle='${name}']`));
}

/** Side panels in a fixed place in the document, each opened by its own button. */
function OpeningPanels({ onClose }: { readonly onClose: (name: PanelName) => void }): ReactNode {
  const [opened, setOpened] = useState<readonly PanelName[]>([]);
  const toggle = (name: PanelName): void =>
    setOpened(opened.includes(name) ? opened.filter((each) => each !== name) : [...opened, name]);
  return (
    <>
      {PANELS.map((name) => (
        <span key={name}>
          <button data-toggle={name} onClick={() => toggle(name)} />
          <NamedPanel
            name={name}
            open={opened.includes(name)}
            onClose={() => {
              onClose(name);
              toggle(name);
            }}
          />
        </span>
      ))}
    </>
  );
}

function NamedPanel({
  name,
  open: isOpen,
  onClose,
}: {
  readonly name: PanelName;
  readonly open: boolean;
  readonly onClose: () => void;
}): ReactNode {
  const panel = useRef<HTMLElement>(null);
  useCloseOnEscape(isOpen, onClose, panel, "side-panel");
  return isOpen ? <aside ref={panel} data-panel={name} /> : null;
}

function SidePanelInOrder({ onClose }: { readonly onClose: () => void }): ReactNode {
  const panel = useRef<HTMLElement>(null);
  useCloseOnEscape(true, onClose, panel, "side-panel");
  return <aside ref={panel} />;
}

function MenuOfItsOwn(): ReactNode {
  useEscapeWaitsFor(true);
  return <div />;
}

function SidePanel({
  open = true,
  onClose,
}: {
  readonly open?: boolean;
  readonly onClose: () => void;
}): ReactNode {
  const panel = useRef<HTMLElement>(null);
  const [details, setDetails] = useState(false);
  useCloseOnEscape(open, onClose, panel);
  return (
    <aside ref={panel} className="side-panel">
      <button onClick={() => setDetails(true)}>Open details</button>
      {details && <Dialog size="large" title="Decision" onClose={() => setDetails(false)} />}
    </aside>
  );
}

function WindowWithViewer({ onCloseUnder }: { readonly onCloseUnder: () => void }): ReactNode {
  const [viewing, setViewing] = useState(false);
  return (
    <Dialog size="large" title="Decision" onClose={onCloseUnder}>
      <button onClick={() => setViewing(true)}>View today.png</button>
      {viewing && (
        <Dialog
          size="large"
          title="today.png"
          onClose={() => {
            flushSync(() => setViewing(false));
          }}
        />
      )}
    </Dialog>
  );
}
