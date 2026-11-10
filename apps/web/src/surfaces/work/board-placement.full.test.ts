import type { Task } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { placementAmong } from "./board-placement.ts";

const card = (id: string): Task => ({ id }) as Task;
const [first, second, third] = [card("first"), card("second"), card("third")];
const cards = [first, second, third];

describe("placementAmong", () => {
  it("puts a card dropped on the first at the top of what shows", () => {
    expect(placementAmong(cards, third, "first")).toEqual({ above: null, below: "first" });
  });

  it("puts a card dropped on another between it and the card above it", () => {
    expect(placementAmong(cards, first, "third")).toEqual({ above: "second", below: "third" });
  });

  it("puts a card dropped past the last at the end", () => {
    expect(placementAmong(cards, first, undefined)).toEqual({ above: "third", below: null });
  });

  it("leaves a card dropped back onto its place", () => {
    expect(placementAmong(cards, second, "third")).toBeUndefined();
    expect(placementAmong(cards, third, undefined)).toBeUndefined();
  });

  it("leaves a card dropped on itself", () => {
    expect(placementAmong(cards, second, "second")).toBeUndefined();
  });

  it("leaves a card dropped on one that has since gone", () => {
    expect(placementAmong(cards, third, "gone")).toBeUndefined();
  });
});
