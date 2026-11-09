import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { SplitButton } from "./index.ts";

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

function renderMoveUp(): { moveUp: () => void; moveToTop: () => void } {
  const moveUp = vi.fn<() => void>();
  const moveToTop = vi.fn<() => void>();
  act(() =>
    root.render(
      <SplitButton
        onClick={moveUp}
        menuLabel="More ways to move up"
        items={[{ label: "Move to top", onSelect: moveToTop }]}
      >
        Move up
      </SplitButton>,
    ),
  );
  return { moveUp, moveToTop };
}

/** By its label, else its words, which Button follows with its spinner's style. */
function button(name: string): HTMLButtonElement {
  const found = [...page.querySelectorAll("button")].find((candidate) => {
    const label = candidate.getAttribute("aria-label");
    return label === null ? candidate.textContent.startsWith(name) : label === name;
  });
  if (!found) throw new Error(`No button "${name}"`);
  return found;
}

describe("SplitButton", () => {
  it("does its main action from the main half, with the menu closed", () => {
    const { moveUp, moveToTop } = renderMoveUp();

    act(() => button("Move up").click());

    expect(moveUp).toHaveBeenCalledOnce();
    expect(moveToTop).not.toHaveBeenCalled();
    expect(page.querySelector('[role="menu"]')).toBeNull();
  });

  it("opens its menu from the arrow, and closes it once an item is chosen", () => {
    const { moveUp, moveToTop } = renderMoveUp();
    const arrow = button("More ways to move up");

    expect(arrow.getAttribute("aria-haspopup")).toBe("menu");
    expect(arrow.getAttribute("aria-expanded")).toBe("false");

    act(() => arrow.click());

    expect(arrow.getAttribute("aria-expanded")).toBe("true");
    expect(page.querySelector('[role="menu"]')?.textContent).toBe("Move to top");

    act(() => button("Move to top").click());

    expect(moveToTop).toHaveBeenCalledOnce();
    expect(moveUp).not.toHaveBeenCalled();
    expect(page.querySelector('[role="menu"]')).toBeNull();
    expect(arrow.getAttribute("aria-expanded")).toBe("false");
  });
});
