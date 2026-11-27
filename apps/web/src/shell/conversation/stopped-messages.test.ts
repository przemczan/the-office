import type { Message } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { stoppedMessages } from "./stopped-messages.ts";

const BASE = { at: "2026-11-27T14:00:00.000Z", sequence: 1 };

function user(id: string, text: string, delivery: "waiting" | "delivered" | "not-delivered") {
  return { ...BASE, id, kind: "user", text, delivery } as unknown as Message;
}
function stoppedLine(id: string) {
  return {
    ...BASE,
    id,
    kind: "held",
    heldBy: "stop",
    text: "You stopped Pam",
  } as unknown as Message;
}

describe("the messages a Stop kept from landing", () => {
  it("names a not delivered message with the stopped line after it, and offers Send again", () => {
    const log = [user("a", "Skip Linux", "not-delivered"), stoppedLine("s")];

    expect([...stoppedMessages(log, false)]).toEqual([["a", true]]);
  });

  it("leaves a message the person finished before, with no stopped line, as it was", () => {
    expect(stoppedMessages([user("a", "Skip Linux", "not-delivered")], false).size).toBe(0);
  });

  it("stops at a message that landed in between", () => {
    const log = [
      user("a", "One", "not-delivered"),
      user("b", "Two", "delivered"),
      stoppedLine("s"),
    ];

    expect(stoppedMessages(log, false).has("a")).toBe(false);
  });

  it("offers no Send again once a later message of the user's has the same words", () => {
    const log = [
      user("a", "Skip Linux", "not-delivered"),
      stoppedLine("s"),
      user("b", "Skip Linux", "delivered"),
    ];

    expect([...stoppedMessages(log, false)]).toEqual([["a", false]]);
  });

  it("names none in a Stage Thread", () => {
    const log = [user("a", "Skip Linux", "not-delivered"), stoppedLine("s")];

    expect(stoppedMessages(log, true).size).toBe(0);
  });
});
