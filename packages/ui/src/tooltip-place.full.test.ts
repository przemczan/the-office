import { describe, expect, it } from "vitest";
import { popoverPlace, tooltipPlace } from "./tooltip-place.ts";

const VIEW = { width: 1000, height: 800 };
const TOOLTIP = { width: 100, height: 30 };

function boxAt(left: number, top: number): Parameters<typeof tooltipPlace>[0] {
  const [width, height] = [40, 20];
  return { left, top, width, height, right: left + width, bottom: top + height };
}

describe("tooltipPlace", () => {
  it("centres on the side asked for, clear of the trigger", () => {
    const trigger = boxAt(480, 400);

    expect(tooltipPlace(trigger, TOOLTIP, "top", VIEW)).toEqual({ left: 450, top: 364 });
    expect(tooltipPlace(trigger, TOOLTIP, "bottom", VIEW)).toEqual({ left: 450, top: 426 });
    expect(tooltipPlace(trigger, TOOLTIP, "left", VIEW)).toEqual({ left: 374, top: 395 });
    expect(tooltipPlace(trigger, TOOLTIP, "right", VIEW)).toEqual({ left: 526, top: 395 });
  });

  it("flips to the other side when the window has no room on the one asked for", () => {
    expect(tooltipPlace(boxAt(480, 10), TOOLTIP, "top", VIEW).top).toBe(36);
    expect(tooltipPlace(boxAt(480, 770), TOOLTIP, "bottom", VIEW).top).toBe(734);
    expect(tooltipPlace(boxAt(950, 400), TOOLTIP, "right", VIEW).left).toBe(844);
    expect(tooltipPlace(boxAt(10, 400), TOOLTIP, "left", VIEW).left).toBe(56);
  });

  it("stays on the side asked for when the other has less room", () => {
    const short = { width: 1000, height: 60 };

    expect(tooltipPlace(boxAt(480, 28), { width: 100, height: 40 }, "top", short).top).toBe(8);
  });

  it("shifts along its side to stay within the window", () => {
    expect(tooltipPlace(boxAt(4, 400), TOOLTIP, "top", VIEW).left).toBe(8);
    expect(tooltipPlace(boxAt(956, 400), TOOLTIP, "top", VIEW).left).toBe(892);
    expect(tooltipPlace(boxAt(4, 2), TOOLTIP, "right", VIEW).top).toBe(8);
  });

  it("keeps its start in the window when it is wider than the window", () => {
    expect(tooltipPlace(boxAt(480, 400), { width: 1200, height: 30 }, "top", VIEW).left).toBe(8);
  });
});

describe("popoverPlace", () => {
  const POPOVER = { width: 240, height: 120 };

  it("sits under its trigger, their left edges together", () => {
    expect(popoverPlace(boxAt(300, 400), POPOVER, VIEW)).toEqual({ left: 300, top: 426 });
  });

  it("sits over its trigger when only that has the room", () => {
    expect(popoverPlace(boxAt(300, 700), POPOVER, VIEW)).toEqual({ left: 300, top: 574 });
  });

  it("shifts left to stay within the window", () => {
    expect(popoverPlace(boxAt(900, 400), POPOVER, VIEW).left).toBe(752);
  });
});
