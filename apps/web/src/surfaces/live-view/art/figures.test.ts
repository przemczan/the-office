import { Avatar } from "@the-office/ui";
import { act, createElement } from "react";
import { createRoot } from "react-dom/client";
import { describe, expect, it } from "vitest";
import type { FigurePose } from "../live-view-types.ts";
import { type FigureLook, figureShape, lookOf } from "./figures.ts";
import { avatarToneIndex, toneColours } from "./palettes.ts";

declare global {
  var IS_REACT_ACT_ENVIRONMENT: boolean;
}
globalThis.IS_REACT_ACT_ENVIRONMENT = true;

const POSES: readonly FigurePose[] = ["stand-front", "sit-back", "sit-back-raise", "walk-front"];

/** The tint an Avatar renders for a name, by its initials' colour token (`var(--blue-700)` → "blue"). */
function renderedTone(name: string): string | null {
  const host = document.createElement("div");
  const root = createRoot(host);
  act(() => root.render(createElement(Avatar, { name })));
  const style = host.querySelector("span")?.getAttribute("style") ?? "";
  act(() => root.unmount());
  return /color:\s*var\(--([a-z]+)-700\)/.exec(style)?.[1] ?? null;
}

describe("figures", () => {
  it("gives a Role key the same look and the same pixels every time", () => {
    for (const roleKey of ["developer", "office-manager", "cto"]) {
      const look = lookOf(roleKey);
      // A fresh copy: the same draw from the seed, not the cached object.
      const again: FigureLook = { ...lookOf(roleKey) };
      expect(again).toEqual(look);
      for (const pose of POSES) {
        const first = figureShape(look, pose, 1).grid.cells;
        const second = figureShape(again, pose, 1).grid.cells;
        expect(Array.from(second)).toEqual(Array.from(first));
        expect(first.some((cell) => cell !== 0)).toBe(true);
      }
    }
  });

  it("spreads Role keys over several options of each part of the look", () => {
    const looks = Array.from({ length: 40 }, (_, i) => lookOf(`role-${i}`));
    const distinct = (field: keyof FigureLook): number =>
      new Set(looks.map((look) => look[field])).size;
    expect(distinct("build")).toBeGreaterThanOrEqual(3);
    expect(distinct("tall")).toBe(2);
    expect(distinct("skin")).toBeGreaterThanOrEqual(4);
    expect(distinct("hairStyle")).toBeGreaterThanOrEqual(5);
    expect(distinct("hair")).toBeGreaterThanOrEqual(4);
    expect(distinct("top")).toBe(3);
    expect(distinct("accessory")).toBeGreaterThanOrEqual(4);
    expect(distinct("trousers")).toBeGreaterThanOrEqual(3);
    expect(distinct("shoes")).toBeGreaterThanOrEqual(3);
  });

  it("tints a person's figure with the tone their Avatar shows", () => {
    const names = [
      "Pam",
      "Jan",
      "Michael",
      "Dwight",
      "Angela",
      "Jim",
      "Stanley",
      "Phyllis",
      "Oscar",
      "Kevin",
      "Creed",
      "Meredith",
      "Ryan",
      "Kelly",
      "Toby",
      "Andy",
      "Erin",
      "Darryl",
      "Holly",
      "Gabe",
      "Ada Lovelace",
      "Zoë",
    ];
    const tones = new Set<string>();
    for (const name of names) {
      const tone = toneColours(avatarToneIndex(name)).name;
      expect({ name, tone: renderedTone(name) }).toEqual({ name, tone });
      tones.add(tone);
    }
    expect(tones.size).toBeGreaterThanOrEqual(4);
  });
});
