import type { Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  endedRunReadingLook,
  threadReadingLook,
  type ContextReadingLook,
} from "./context-reading-words.ts";

type ReadThread = Pick<Thread, "context" | "state" | "stageThread">;

function aThread(
  context: Partial<Thread["context"]>,
  { state = "waiting", stageThread = false }: Partial<Omit<ReadThread, "context">> = {},
): ReadThread {
  return {
    state,
    stageThread,
    context: {
      move: "resume",
      reason: "cache-warm",
      cacheWarm: true,
      cacheWarmUntil: null,
      contextTokens: 41_234,
      contextWindow: 200_000,
      contextReported: true,
      briefTokens: null,
      alternatives: [],
      override: null,
      ...context,
    },
  };
}

/** The words a row of each width shows. */
function wordsAt(look: ContextReadingLook, width: "wide" | "medium" | "narrow"): string {
  const shows = {
    wide: ["always", "wide", "not-narrow"],
    medium: ["always", "not-narrow"],
    narrow: ["always", "narrow"],
  }[width];
  return look.parts
    .filter(({ shown }) => shows.includes(shown))
    .map(({ text }) => text)
    .join("");
}

describe("a Thread's context reading", () => {
  it("reads the size against the window, with the hand-off's mark, grey while small", () => {
    const look = threadReadingLook(aThread({}), "Pam");

    expect(wordsAt(look, "medium")).toBe("41k of 200k");
    expect(wordsAt(look, "wide")).toBe("41k of 200k context");
    expect(look).toMatchObject({
      near: false,
      label: "Context: 41k of 200k",
      meter: { kind: "filled", mark: true },
    });
    expect(look.tip).toBe(
      "41,234 of 200,000 tokens (21%), read after Pam's last turn. At 160k (80%), The Office asks Pam for a Handover note and the next message starts a fresh session.",
    );
  });

  it("turns amber from 70%, saying where it starts fresh on a wide row", () => {
    const look = threadReadingLook(aThread({ contextTokens: 152_000 }), "Pam");

    expect(look.near).toBe(true);
    expect(wordsAt(look, "wide")).toBe("152k of 200k · starts fresh at 160k");
    expect(wordsAt(look, "medium")).toBe("152k of 200k");
  });

  it("says the Handover note comes at the turn's end once a running turn passes the mark", () => {
    const look = threadReadingLook(
      aThread({ contextTokens: 163_000 }, { state: "answering" }),
      "Pam",
    );

    expect(wordsAt(look, "wide")).toBe("163k of 200k · Handover note at this turn's end");
    expect(look.tip).toMatch(
      /^163,000 of 200,000 tokens \(82%\), read live as Pam answers\. Past 160k/,
    );
  });

  it("follows the hand-off: the note being written, then a fresh session next", () => {
    const full = { move: "fresh", reason: "context-full", contextTokens: 171_000 } as const;

    const writing = threadReadingLook(aThread(full, { state: "answering" }), "Pam");
    expect(wordsAt(writing, "medium")).toBe("Writing a Handover note · 171k");
    expect(wordsAt(writing, "narrow")).toBe("Handing over");
    expect(writing.near).toBe(true);

    const next = threadReadingLook(aThread(full), "Pam");
    expect(wordsAt(next, "medium")).toBe("Fresh session next · was 171k");
    expect(next).toMatchObject({ quiet: true, meter: { kind: "empty", mark: true } });
  });

  it("says when there is no session yet, or nothing read from it yet", () => {
    const none = threadReadingLook(aThread({ reason: "new-thread", contextTokens: 0 }), "Pam");
    expect(wordsAt(none, "medium")).toBe("No session yet");
    expect(none.meter).toEqual({ kind: "empty", mark: true });

    const started = threadReadingLook(
      aThread({ contextTokens: 0, contextWindow: null }, { state: "answering", stageThread: true }),
      "Jim",
    );
    expect(wordsAt(started, "medium")).toBe("Not read yet");
    expect(started.meter).toEqual({ kind: "empty", mark: false });
  });

  it("shows the size alone for a session read before its window was kept", () => {
    const look = threadReadingLook(aThread({ contextWindow: null }), "Pam");

    expect(wordsAt(look, "medium")).toBe("41k context");
    expect(look.meter).toBeUndefined();
  });

  it("says an engine that can't report its context doesn't", () => {
    const look = threadReadingLook(aThread({ contextReported: false }), "Pam");

    expect(wordsAt(look, "medium")).toBe("Context size not reported");
    expect(look.meter).toBeUndefined();
  });

  it("gives a Stage's Thread no mark, amber only from 80%", () => {
    const stage = { stageThread: true, state: "answering" } as const;

    expect(threadReadingLook(aThread({ contextTokens: 150_000 }, stage), "Jim")).toMatchObject({
      near: false,
      meter: { mark: false },
    });
    expect(threadReadingLook(aThread({ contextTokens: 161_000 }, stage), "Jim").near).toBe(true);
  });
});

describe("an ended run's context reading", () => {
  it("keeps the run's last reading, its ending words left out on a phone", () => {
    const look = endedRunReadingLook(
      { context: { contextTokens: 132_000, contextWindow: 200_000 } },
      "Jim",
    );

    expect(wordsAt(look, "medium")).toBe("Ended at 132k of 200k");
    expect(wordsAt(look, "narrow")).toBe("132k of 200k");
    expect(look).toMatchObject({ near: false, meter: { kind: "filled", mark: false } });
  });

  it("says nothing was read for a run stopped before the model's first answer", () => {
    expect(wordsAt(endedRunReadingLook({ context: null }, "Jim"), "medium")).toBe("Not read");
  });
});
