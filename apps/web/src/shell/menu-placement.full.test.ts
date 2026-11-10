import { describe, expect, it } from "vitest";
import { menuPlacement } from "./menu-placement.ts";

const WINDOW = { width: 1000, height: 800 };
const MENU = { width: 220, height: 200 };

function triggerAt(top: number, left: number): Parameters<typeof menuPlacement>[0] {
  return { top, bottom: top + 24, left, right: left + 24 };
}

describe("menuPlacement", () => {
  it("opens below the trigger, lined up with its end", () => {
    expect(menuPlacement(triggerAt(100, 500), MENU, WINDOW, "end")).toEqual({
      top: 128,
      left: 304,
    });
  });

  it("lines up with the trigger's start when asked", () => {
    expect(menuPlacement(triggerAt(100, 500), MENU, WINDOW, "start").left).toBe(500);
  });

  it("flips up when there is no room below and more above", () => {
    expect(menuPlacement(triggerAt(700, 500), MENU, WINDOW, "end").top).toBe(496);
  });

  it("stays below when there is less room above than below", () => {
    const short = { width: 1000, height: 260 };
    expect(menuPlacement(triggerAt(40, 500), MENU, short, "end").top).toBe(68);
  });

  it("keeps the menu inside the window's sides", () => {
    expect(menuPlacement(triggerAt(100, 10), MENU, WINDOW, "end").left).toBe(8);
    expect(menuPlacement(triggerAt(100, 950), MENU, WINDOW, "start").left).toBe(772);
  });
});
