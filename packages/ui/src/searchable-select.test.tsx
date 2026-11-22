import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SearchableSelect, type SearchableSelectOption } from "./index.ts";

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

const OPTIONS: readonly SearchableSelectOption[] = [
  { value: "offline", label: "Offline sync" },
  { value: "invoices", label: "Sync the invoices" },
  { value: "billing", label: "Billing" },
  ...Array.from({ length: 12 }, (_, index) => ({ value: `more-${index}`, label: `More ${index}` })),
];

function rendered(value: string, onChange = vi.fn<(value: string) => void>()) {
  act(() =>
    root.render(
      <SearchableSelect
        label="Initiative"
        labelHidden
        placeholder="Any Initiative"
        value={value}
        options={OPTIONS}
        onChange={onChange}
        clearLabel="Clear the Initiative filter"
        noMatches="No Initiative matches"
      />,
    ),
  );
  return onChange;
}

function box(): HTMLInputElement {
  const found = page.querySelector<HTMLInputElement>('input[role="combobox"]');
  if (!found) throw new Error("No box");
  return found;
}

function optionNames(): string[] {
  return [...document.querySelectorAll('[role="listbox"] [role="option"]')].map(
    (option) => option.textContent ?? "",
  );
}

function type(text: string): void {
  const input = box();
  act(() => {
    input.focus();
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set?.call(input, text);
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

function press(key: string): void {
  act(() => box().dispatchEvent(new KeyboardEvent("keydown", { key, bubbles: true })));
}

describe("SearchableSelect", () => {
  it("is a combobox named by its label, showing the placeholder until something is chosen", () => {
    rendered("");

    expect(box().getAttribute("aria-label")).toBe("Initiative");
    expect(box().placeholder).toBe("Any Initiative");
    expect(box().value).toBe("");
    expect(page.querySelector('[aria-label="Clear the Initiative filter"]')).toBeNull();
  });

  it("lists the best matches of what is typed, and chooses one on a click", () => {
    const onChange = rendered("");

    type("sync");

    expect(box().getAttribute("aria-expanded")).toBe("true");
    expect(optionNames()).toEqual(["Sync the invoices", "Offline sync"]);
    act(() => (document.querySelectorAll('[role="option"]')[1] as HTMLElement).click());
    expect(onChange).toHaveBeenCalledWith("offline");
    expect(box().getAttribute("aria-expanded")).toBe("false");
  });

  it("shows at most ten options", () => {
    rendered("");

    act(() => box().click());

    expect(optionNames()).toHaveLength(10);
  });

  it("moves through the matches by the arrows and chooses by Enter", () => {
    const onChange = rendered("");

    type("sync");
    press("ArrowDown");
    press("Enter");

    expect(onChange).toHaveBeenCalledWith("offline");
  });

  it("closes on Escape and shows the choice again", () => {
    const onChange = rendered("billing");
    expect(box().value).toBe("Billing");

    type("sy");
    press("Escape");

    expect(box().getAttribute("aria-expanded")).toBe("false");
    expect(box().value).toBe("Billing");
    expect(onChange).not.toHaveBeenCalled();
  });

  it("says when nothing matches", () => {
    rendered("");

    type("zzz");

    expect(optionNames()).toEqual(["No Initiative matches"]);
    press("Enter");
    expect(box().getAttribute("aria-expanded")).toBe("true");
  });

  it("clears the choice by its clear button", () => {
    const onChange = rendered("billing");

    act(() =>
      page.querySelector<HTMLButtonElement>('[aria-label="Clear the Initiative filter"]')?.click(),
    );

    expect(onChange).toHaveBeenCalledWith("");
  });

  it("offers the words typed as its own value, with ownValue", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() =>
      root.render(
        <SearchableSelect
          label="Found in version"
          value=""
          options={[{ value: "v1.14.2", label: "v1.14.2" }]}
          onChange={onChange}
          clearLabel="Remove the version"
          noMatches="No tag matches"
          ownValue={{ maxLength: 64 }}
        />,
      ),
    );

    type("v1.14");
    expect(optionNames()).toEqual(["v1.14.2", "Use “v1.14”"]);
    press("ArrowDown");
    press("Enter");
    expect(onChange).toHaveBeenCalledWith("v1.14");

    type("v1.14.2");
    expect(optionNames()).toEqual(["v1.14.2"]);
  });

  it("shows a value of the user's own words as written, which can be cleared", () => {
    const onChange = vi.fn<(value: string) => void>();
    act(() =>
      root.render(
        <SearchableSelect
          label="Found in version"
          value="nightly"
          options={[]}
          onChange={onChange}
          clearLabel="Remove the version"
          noMatches="No tag matches"
          ownValue={{}}
        />,
      ),
    );

    expect(box().value).toBe("nightly");
    act(() => page.querySelector<HTMLButtonElement>('[aria-label="Remove the version"]')?.click());
    expect(onChange).toHaveBeenCalledWith("");
  });

  it("lists its matches in their groups, found by other words too, with no clear button when unasked", () => {
    act(() =>
      root.render(
        <SearchableSelect
          label="Branch"
          value="b:main"
          options={[
            { value: "b:main", label: "main", group: "Branches" },
            { value: "b:fix", label: "initiative/checkout", group: "Branches" },
            {
              value: "i:1",
              label: "Checkout",
              group: "Initiatives",
              alsoMatches: ["initiative/checkout"],
              line: "initiative/checkout",
              title: "Its branch",
            },
          ]}
          onChange={vi.fn<(value: string) => void>()}
          noMatches="No branch matches"
        />,
      ),
    );
    expect(page.querySelector(".searchable-select-clear")).toBeNull();

    type("checkout");
    const groups = [...document.querySelectorAll('[role="listbox"] [role="group"]')];
    expect(
      groups.map((group) => group.querySelector(".grouped-select-group")?.textContent),
    ).toEqual(["Branches", "Initiatives"]);
    const initiative = groups[1]?.querySelector<HTMLElement>('[role="option"]');
    expect(initiative?.title).toBe("Its branch");
    expect(initiative?.querySelector(".grouped-select-line")?.textContent).toBe(
      "initiative/checkout",
    );
  });
});
