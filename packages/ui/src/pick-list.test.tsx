import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { PickList, PickListItem } from "./index.ts";

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

function rows(): HTMLElement[] {
  return [...page.querySelectorAll<HTMLElement>("nav li > *")];
}

describe("PickList", () => {
  it("is a named list with its count, its action and its foot, and a note under the card", () => {
    act(() =>
      root.render(
        <PickList
          name="Engines"
          count={1}
          action={<button type="button">Add an engine</button>}
          foot={<button type="button">Duplicate</button>}
          note="Each engine is one account."
        >
          <PickListItem picked={false} name="Claude Code" line="Signed in" onPick={vi.fn()} />
        </PickList>,
      ),
    );

    expect(page.querySelector("nav")?.getAttribute("aria-label")).toBe("Engines");
    expect(page.querySelector("h3")?.textContent).toBe("Engines1");
    expect(page.querySelector(".pick-list-head")?.textContent).toContain("Add an engine");
    expect(page.querySelector(".pick-list-foot")?.textContent).toBe("Duplicate");
    expect(page.querySelector(".pick-list-card + .pick-list-note")?.textContent).toBe(
      "Each engine is one account.",
    );
  });

  it("says what would fill it while it holds nothing", () => {
    act(() => root.render(<PickList name="Engines" count={0} empty="No engine yet." />));

    expect(page.querySelector("nav")?.textContent).toBe("No engine yet.");
    expect(page.querySelector("ul")).toBeNull();
  });

  it("draws a row as a button that picks, the picked one current", () => {
    const onPick = vi.fn<() => void>();
    act(() =>
      root.render(
        <PickList name="Engines" count={2}>
          <PickListItem picked name="Claude Code" line="Signed in" onPick={vi.fn()} />
          <PickListItem picked={false} name="Local LLM" line="3 models" onPick={onPick} />
        </PickList>,
      ),
    );

    const [picked, other] = rows();
    expect(picked?.tagName).toBe("BUTTON");
    expect(picked?.getAttribute("aria-current")).toBe("true");
    expect(picked?.classList.contains("picked")).toBe(true);
    expect(other?.hasAttribute("aria-current")).toBe(false);
    act(() => other?.click());
    expect(onPick).toHaveBeenCalledOnce();
  });

  it("draws a row as the caller's link, the picked one the current page", () => {
    act(() =>
      root.render(
        <PickList name="Pipelines" count={1}>
          <PickListItem
            picked
            name="Full"
            line="6 Stages"
            link={(parts) => <a href="/settings/pipelines/full" {...parts} />}
          />
        </PickList>,
      ),
    );

    const [link] = rows();
    expect(link?.tagName).toBe("A");
    expect(link?.getAttribute("href")).toBe("/settings/pipelines/full");
    expect(link?.getAttribute("aria-current")).toBe("page");
    expect(link?.className).toBe("pick-list-item picked");
    expect(link?.textContent).toBe("Full6 Stages");
  });

  it("starts the row's text with its name, then its kind, line, aside and warning", () => {
    act(() =>
      root.render(
        <PickList name="Engines" count={1}>
          <PickListItem
            picked={false}
            icon={{ glyph: <svg />, label: "Claude Code" }}
            name="Second account"
            line="Signed out"
            aside={<span>Office default</span>}
            warning="It has no folder to sign in yet"
            onPick={vi.fn()}
          />
        </PickList>,
      ),
    );

    const [row] = rows();
    expect(row?.textContent).toBe("Second accountClaude Code · Signed outOffice default");
    expect(row?.querySelector(".pick-list-icon")?.getAttribute("aria-hidden")).toBe("true");
    expect(row?.querySelector("[role=img]")?.getAttribute("aria-label")).toBe(
      "It has no folder to sign in yet",
    );
  });
});
