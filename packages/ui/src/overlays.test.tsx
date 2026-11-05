import { act, useRef, useState, type ReactNode } from "react";
import { flushSync } from "react-dom";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Dialog, Drawer, useCloseOnEscape } from "./index.ts";

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

const backdrop = (): Element | null | undefined =>
  document.querySelector("[role=dialog]")?.parentElement;

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

describe.each([
  [
    "Dialog",
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

    pressEscape();

    expect(onClose).toHaveBeenCalledOnce();
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

  it.each(["small", "medium", "large"] as const)("takes its size: %s", (size) => {
    show(<Dialog size={size} title="Drop" onClose={() => {}} />);

    expect(document.querySelector("[role=dialog]")?.className).toBe(`dialog-frame ${size}`);
  });

  it("keeps one height when large and asked to", () => {
    show(<Dialog size="large" keepsHeight title="Stage history" onClose={() => {}} />);

    expect(document.querySelector("[role=dialog]")?.className).toBe(
      "dialog-frame large keeps-height",
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
