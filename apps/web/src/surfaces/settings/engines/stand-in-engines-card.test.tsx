import type { EngineId } from "@the-office/contracts";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { shownText } from "../../../shell/page.fixtures.tsx";
import type { StandInChoice } from "./engine-settings-draft.ts";
import { StandInEnginesCard } from "./stand-in-engines-card.tsx";

const WORK: StandInChoice = { id: "work", name: "Work", kind: "claude-code" };
const CODEX: StandInChoice = { id: "codex", name: "Codex", kind: "codex" };

let root: Root | undefined;

function card(
  listed: readonly StandInChoice[],
  addable: readonly StandInChoice[],
  changeStandInEngines: (standInEngines: readonly EngineId[]) => void = () => undefined,
): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(
      <StandInEnginesCard
        listed={listed}
        addable={addable}
        askBeforeSwitchAbove="100000"
        changeStandInEngines={changeStandInEngines}
        changeAskBeforeSwitchAbove={() => undefined}
      />,
    );
  });
  return page;
}

describe("Settings › Engines' Stand-in Engines card", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it("says how another engine type stands in, and lists every type with its icon", () => {
    const page = card([WORK, CODEX], []);

    expect(shownText(page)).toContain(
      "On another engine type, a Thread or a new session starts fresh with each person's model and effort for it; a running Stage waits for the reset instead. A Project can use a list of its own.",
    );
    expect(
      [...page.querySelectorAll('li [role="img"]')].map((icon) => icon.getAttribute("aria-label")),
    ).toEqual(["Claude Code", "Codex"]);
  });

  it("says why work waits while nothing is listed", () => {
    const page = card([], [WORK]);

    expect(shownText(page)).toContain(
      "No Stand-in Engine yet, so work waits for its own engine's usage window to free up.",
    );
  });

  it("adds an engine of another type last", () => {
    const change = vi.fn<(standInEngines: readonly EngineId[]) => void>();
    const page = card([WORK], [CODEX], change);
    const add = page.querySelector("select");
    if (!add) throw new Error("There is no Add a stand-in.");

    act(() => {
      Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype, "value")?.set?.call(
        add,
        "codex",
      );
      add.dispatchEvent(new Event("change", { bubbles: true }));
    });

    expect(change).toHaveBeenCalledWith(["work", "codex"]);
  });
});
