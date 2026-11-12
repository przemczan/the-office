import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GroupedSelect, type GroupedSelectGroup } from "./index.ts";

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

function rendered(value: string, onChange = vi.fn<(value: string) => void>()) {
  act(() =>
    root.render(
      <GroupedSelect
        label="Pipeline"
        placeholder="Choose a Pipeline"
        value={value}
        groups={GROUPS}
        onChange={onChange}
      />,
    ),
  );
  return onChange;
}

function trigger(): HTMLButtonElement {
  const button = page.querySelector<HTMLButtonElement>("[role=combobox]");
  if (!button) throw new Error("No combobox.");
  return button;
}

function list(): HTMLElement | null {
  return page.querySelector("[role=listbox]");
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
    const groups = [...page.querySelectorAll("[role=group]")];
    expect(
      groups.map((group) => group.querySelector(".grouped-select-group")?.textContent),
    ).toEqual(["the-office's Pipelines", "Office-wide Pipelines"]);
    const chosen = page.querySelector("[role=option][aria-selected=true]");
    expect(chosen?.textContent).toBe("FullImplement");
  });

  it("shows why a disabled option can't be chosen in place of its line, and ignores a press on it", () => {
    const onChange = rendered("");
    act(() => trigger().click());
    const broken = page.querySelector<HTMLElement>("[role=option][aria-disabled=true]");

    expect(broken?.querySelector(".grouped-select-line.why")?.textContent).toBe(
      "Broken: Changes Produce.",
    );
    const describedBy = broken?.getAttribute("aria-describedby") ?? "";
    expect(document.getElementById(describedBy)?.textContent).toBe("Broken: Changes Produce.");

    act(() => broken?.click());
    expect(onChange).not.toHaveBeenCalled();
    expect(list()).not.toBeNull();
  });

  it("moves through the choosable options by the keyboard, skipping a disabled one", () => {
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
    expect(activeLabel()).toBe("Full with Linux check");
    press(listbox, "ArrowDown");
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
    const linux = [...page.querySelectorAll<HTMLElement>("[role=option]")][1];
    act(() => linux?.click());

    expect(onChange).toHaveBeenCalledWith("linux");
  });
});
