import type { EngineId } from "@the-office/contracts";
import { act, type ReactNode } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { buttonNamed } from "./page.fixtures.tsx";
import {
  StandInEngineRows,
  withStandInMoved,
  type StandInEngineRow,
} from "./stand-in-engine-rows.tsx";

const ROWS: readonly StandInEngineRow[] = [
  { id: "work", name: "Work", kind: "claude-code" },
  { id: "codex", name: "Codex", kind: "codex", note: "Another engine type." },
  { id: "gone", name: "gone", kind: null },
];

let root: Root | undefined;

function shown(element: ReactNode): HTMLElement {
  const page = document.createElement("div");
  document.body.append(page);
  act(() => {
    root = createRoot(page);
    root.render(element);
  });
  return page;
}

function clicked(button: HTMLButtonElement | undefined): void {
  if (!button) throw new Error("There is no such button.");
  act(() => button.click());
}

describe("a Stand-in Engine list's rows (spec 5.4.6)", () => {
  afterEach(() => {
    act(() => root?.unmount());
    root = undefined;
    document.body.replaceChildren();
  });

  it("lists each engine in order with its type's icon and its note", () => {
    const page = shown(<StandInEngineRows rows={ROWS} empty="None." onChange={() => undefined} />);

    const rows = [...page.querySelectorAll("li")];
    expect(rows.map((row) => row.querySelector(".stand-in-engine-name")?.textContent)).toEqual([
      "Work",
      "Codex",
      "gone",
    ]);
    expect(
      rows.map((row) => row.querySelector('[role="img"]')?.getAttribute("aria-label")),
    ).toEqual(["Claude Code", "Codex", undefined]);
    expect(rows[0]?.querySelector(".stand-in-engine-note")).toBeNull();
    expect(rows[1]?.querySelector(".stand-in-engine-note")?.textContent).toBe(
      "Another engine type.",
    );
  });

  it("moves and removes, holding Move up on the first and Move down on the last", () => {
    const onChange = vi.fn<(standIns: readonly EngineId[]) => void>();
    const page = shown(<StandInEngineRows rows={ROWS} empty="None." onChange={onChange} />);

    expect(buttonNamed(page, "Move Work up")?.disabled).toBe(true);
    expect(buttonNamed(page, "Move gone down")?.disabled).toBe(true);
    clicked(buttonNamed(page, "Move Codex up"));
    clicked(buttonNamed(page, "Move Codex down"));
    clicked(buttonNamed(page, "Remove Work from the Stand-in Engines"));

    expect(onChange.mock.calls).toEqual([
      [["codex", "work", "gone"]],
      [["work", "gone", "codex"]],
      [["codex", "gone"]],
    ]);
  });

  it("is greyed and has no tools when read-only, and disables them while saving", () => {
    const readOnly = shown(<StandInEngineRows rows={ROWS} empty="None." readOnly />);
    expect(readOnly.querySelector("ol")?.hasAttribute("data-read-only")).toBe(true);
    expect(readOnly.querySelectorAll("button")).toHaveLength(0);
    act(() => root?.unmount());

    const saving = shown(<StandInEngineRows rows={ROWS} empty="None." disabled />);
    expect([...saving.querySelectorAll("button")].every((button) => button.disabled)).toBe(true);
  });

  it("says what its empty text says while nothing is listed", () => {
    const page = shown(<StandInEngineRows rows={[]} empty="No Stand-in Engine yet." />);
    expect(page.textContent).toBe("No Stand-in Engine yet.");
    expect(page.querySelector("ol")).toBeNull();
  });

  it("moves an engine up or down, never past either end", () => {
    expect(withStandInMoved(["a", "b", "c"], 1, -1)).toEqual(["b", "a", "c"]);
    expect(withStandInMoved(["a", "b", "c"], 1, 1)).toEqual(["a", "c", "b"]);
    expect(withStandInMoved(["a", "b"], 0, -1)).toEqual(["a", "b"]);
    expect(withStandInMoved(["a", "b"], 1, 1)).toEqual(["a", "b"]);
  });
});
