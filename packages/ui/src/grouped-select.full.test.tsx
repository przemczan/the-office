import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupedSelect, type GroupedSelectGroup } from "./index.ts";

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

beforeEach(() => {
  page = document.createElement("div");
  document.body.append(page);
  root = createRoot(page);
});

afterEach(() => {
  act(() => root.unmount());
  page.remove();
});

const GROUPS: readonly GroupedSelectGroup[] = [
  {
    label: "the-office's Pipelines",
    options: [
      { value: "spec", label: "Spec change", disabledWhy: "Broken: Changes Produce." },
      {
        value: "linux",
        label: "Full with Linux check",
        line: "Implement → Tests",
        aside: "Default",
      },
    ],
  },
  {
    label: "Office-wide Pipelines",
    options: [{ value: "full", label: "Full", line: "Implement" }],
  },
  { label: "Empty", options: [] },
];

function rendered(
  value: string,
  onChange = vi.fn<(value: string) => void>(),
  { inWindow = false } = {},
) {
  const select = (
    <GroupedSelect
      label="Pipeline"
      placeholder="Choose a Pipeline"
      value={value}
      groups={GROUPS}
      onChange={onChange}
    />
  );
  act(() =>
    root.render(
      inWindow ? (
        <div role="dialog" aria-modal="true">
          <div className="dialog-body">{select}</div>
        </div>
      ) : (
        select
      ),
    ),
  );
  return onChange;
}

function trigger(): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>("[role=combobox]");
  if (!button) throw new Error("No combobox.");
  return button;
}

/** The open list, which lies apart from the field. */
function list(): HTMLElement | null {
  return document.querySelector("[role=listbox]");
}

function options(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>("[role=option]")];
}

function pressPointer(element: Element): void {
  act(() => {
    element.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true }));
  });
}

function press(element: Element, key: string): void {
  act(() => {
    element.dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true }));
  });
}

describe("GroupedSelect", () => {
  it("is a combobox named by its label, showing the placeholder or the chosen option", () => {
    rendered("");
    const label = page.querySelector("label");
    expect(label?.textContent).toBe("Pipeline");
    expect(label?.htmlFor).toBe(trigger().id);
    expect(trigger().textContent).toBe("Choose a Pipeline");
    expect(trigger().getAttribute("aria-expanded")).toBe("false");

    rendered("full");
    expect(trigger().textContent).toBe("Full");
  });

  it("opens a list of named groups, leaving an empty group out", () => {
    rendered("full");
    act(() => trigger().click());

    expect(trigger().getAttribute("aria-expanded")).toBe("true");
    const groups = [...document.querySelectorAll("[role=group]")];
    expect(
      groups.map((group) => group.querySelector(".grouped-select-group")?.textContent),
    ).toEqual(["the-office's Pipelines", "Office-wide Pipelines"]);
    const chosen = document.querySelector("[role=option][aria-selected=true]");
    expect(chosen?.textContent).toBe("FullImplement");
  });

  it("shows why a disabled option can't be chosen in place of its line, and ignores a press on it", () => {
    const onChange = rendered("");
    act(() => trigger().click());
    const broken = document.querySelector<HTMLElement>("[role=option][aria-disabled=true]");

    expect(broken?.querySelector(".grouped-select-line.why")?.textContent).toBe(
      "Broken: Changes Produce.",
    );
    const describedBy = broken?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("Broken: Changes Produce.");

    act(() => broken?.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).not.toBeNull();
  });

  it("moves through the options by the keyboard, reaching a disabled one without choosing it", () => {
    const onChange = rendered("");
    press(trigger(), "ArrowDown");
    const listbox = list();
    if (!listbox) throw new Error("No list.");
    expect(document.activeElement).toBe(listbox);
    const activeLabel = () =>
      document.getElementById(listbox.getAttribute("aria-activedescendant") ?? "")
        ?.firstElementChild?.nextElementSibling?.textContent;
    expect(activeLabel()).toBe("Full with Linux check");

    press(listbox, "ArrowUp");
    expect(activeLabel()).toBe("Spec change");
    press(listbox, "Enter");
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).not.toBeNull();

    press(listbox, "End");
    expect(activeLabel()).toBe("Full");
    press(listbox, "Enter");

    expect(onChange).toHaveBeenCalledWith("full");
    expect(list()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });

  it("closes on Escape without choosing", () => {
    const onChange = rendered("");
    act(() => trigger().click());
    const listbox = list();
    if (!listbox) throw new Error("No list.");
    press(listbox, "Escape");

    expect(list()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("chooses an option pressed", () => {
    const onChange = rendered("");
    act(() => trigger().click());
    const linux = options()[1];
    act(() => linux?.click());

    expect(onChange).toHaveBeenCalledWith("linux");
  });

  it("opens its list on the body, apart from the field, at least as wide as the field", () => {
    rendered("");
    act(() => trigger().click());

    const listbox = list();
    expect(listbox?.parentElement).toBe(document.body);
    expect(page.contains(listbox)).toBe(false);
    expect(trigger().getAttribute("aria-controls")).toBe(listbox?.id);
    expect(listbox?.style.minWidth).toBe(`${trigger().getBoundingClientRect().width}px`);
  });

  it("opens its list on the window holding the field, outside the window's body", () => {
    const onChange = rendered("", vi.fn<(value: string) => void>(), { inWindow: true });
    act(() => trigger().click());

    const holder = page.querySelector("[aria-modal=true]");
    const listbox = list();
    expect(listbox?.parentElement).toBe(holder);
    expect(page.querySelector(".dialog-body")?.contains(listbox)).toBe(false);
    expect(document.activeElement).toBe(listbox);

    // A press on an option is inside the list: it chooses, not closes.
    const linux = options()[1];
    if (!linux) throw new Error("No option.");
    pressPointer(linux);
    expect(list()).not.toBeNull();
    act(() => linux.click());
    expect(onChange).toHaveBeenCalledWith("linux");
    expect(list()).toBeNull();
  });

  it("closes on a press outside the field and its list, without choosing", () => {
    const onChange = rendered("", vi.fn<(value: string) => void>(), { inWindow: true });
    act(() => trigger().click());
    expect(list()).not.toBeNull();

    pressPointer(document.body);

    expect(list()).toBeNull();
    expect(onChange).not.toHaveBeenCalled();
  });

  it("closes on Tab, going on from the trigger", () => {
    rendered("");
    act(() => trigger().click());
    const listbox = list();
    if (!listbox) throw new Error("No list.");
    press(listbox, "Tab");

    expect(list()).toBeNull();
    expect(document.activeElement).toBe(trigger());
  });
});
