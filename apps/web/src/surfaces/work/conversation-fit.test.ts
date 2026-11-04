import { describe, expect, it } from "vitest";
import { conversationHeight } from "./conversation-fit.ts";

const place = { pageHeight: 796, columnsTop: 200, scrolled: 0, stuckAt: 12 };

describe("conversationHeight", () => {
  it("reaches down to the window's edge when it fits under what's above it", () => {
    expect(conversationHeight(place)).toBe(572);
  });

  it("grows with the page's scrolling, up to filling the window once stuck", () => {
    expect(conversationHeight({ ...place, columnsTop: 100, scrolled: 100 })).toBe(672);
    expect(conversationHeight({ ...place, columnsTop: -300, scrolled: 500 })).toBe(760);
  });

  it("takes its height when stuck if it starts too low to fit", () => {
    expect(conversationHeight({ ...place, columnsTop: 700 })).toBe(760);
    expect(conversationHeight({ ...place, columnsTop: 500, scrolled: 200 })).toBe(760);
  });

  it("never passes the edge of a low window once stuck", () => {
    expect(conversationHeight({ ...place, pageHeight: 300, columnsTop: 12 })).toBe(264);
  });
});
