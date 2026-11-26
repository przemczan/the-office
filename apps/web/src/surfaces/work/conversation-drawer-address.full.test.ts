import { describe, expect, it } from "vitest";
import { drawerMoveOn, type DrawerAddress } from "./conversation-drawer-address.ts";

const NOTHING: DrawerAddress = {
  threadId: undefined,
  decisionId: undefined,
  decisionIsOpen: false,
};

describe("drawerMoveOn", () => {
  it("opens for a Thread arriving, on a page opened at it too", () => {
    const atThread = { ...NOTHING, threadId: "thread-1" };
    expect(drawerMoveOn(NOTHING, atThread)).toBe("open");
    expect(drawerMoveOn(undefined, atThread)).toBe("open");
  });

  it("leaves the drawer as the reader put it while the address stays", () => {
    const atThread = { ...NOTHING, threadId: "thread-1" };
    expect(drawerMoveOn(atThread, atThread)).toBe("stay");
    expect(drawerMoveOn(atThread, NOTHING)).toBe("stay");
  });

  it("closes for an open Decision arriving, whatever Thread comes with it", () => {
    const atDecision = {
      threadId: "thread-1",
      decisionId: "decision-1",
      decisionIsOpen: true,
    };
    expect(drawerMoveOn(NOTHING, atDecision)).toBe("close");
  });

  it("leaves the drawer as it is on a page opened at an open Decision, which it starts closed", () => {
    const atDecision = {
      threadId: "thread-1",
      decisionId: "decision-1",
      decisionIsOpen: true,
    };
    // The reader may have opened it while the page loaded.
    expect(drawerMoveOn(undefined, atDecision)).toBe("stay");
  });

  it("opens for an answered Decision, which lands in its Thread", () => {
    const atAnswered = {
      threadId: "thread-1",
      decisionId: "decision-1",
      decisionIsOpen: false,
    };
    expect(drawerMoveOn(NOTHING, atAnswered)).toBe("open");
  });

  it("opens for a Thread arriving beside an open Decision already in the address", () => {
    const atDecision = {
      threadId: "thread-1",
      decisionId: "decision-1",
      decisionIsOpen: true,
    };
    expect(drawerMoveOn(atDecision, { ...atDecision, threadId: "thread-2" })).toBe("open");
  });
});
