import type { Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { takesMessages, writingPlaceholder } from "./thread-writing.ts";

function aThread(state: Thread["state"], stageThread: boolean): Thread {
  return { state, stageThread } as Thread;
}

describe("writing in a Thread", () => {
  it("takes a message while the person answers, in any Thread, and in a Stage Thread only then", () => {
    expect(takesMessages(aThread("answering", false))).toBe(true);
    expect(takesMessages(aThread("waiting", false))).toBe(true);
    expect(takesMessages(aThread("answering", true))).toBe(true);
    expect(takesMessages(aThread("waiting", true))).toBe(false);
  });

  it("says a message written while the person answers lands at the next safe point", () => {
    expect(writingPlaceholder({ state: "answering" }, "Jan")).toBe(
      "Write to Jan… (lands at the next safe point)",
    );
    expect(writingPlaceholder({ state: "waiting" }, "Jan")).toBe("Write to Jan…");
  });
});
