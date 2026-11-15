import type { Light } from "./live-view-types.ts";

const DAY_LIGHT: Light = { phase: "day", tint: 0xffffff, lampsOn: false };

/**
 * The hour's light. Always day for now: this is the one seam the day-and-night Task replaces with
 * the sun's height at the browser's zone (design decision 11), so the stage and the words read the
 * light only from here.
 */
export function lightAt(_now: Date): Light {
  return DAY_LIGHT;
}
