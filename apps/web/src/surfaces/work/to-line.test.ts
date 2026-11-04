import type { Thread } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import {
  liveThread,
  toLineNow,
  toLinePicked,
  workingThread,
  writableThreads,
  type ToLine,
} from "./to-line.ts";

function aThread(id: string, startedAt: string, fields: Partial<Thread> = {}): Thread {
  return { id, startedAt, stageThread: false, state: "waiting", ...fields } as Thread;
}

const planning = aThread("planning", "2026-11-04T09:00:00.000Z");
const consultation = aThread("consultation", "2026-11-04T09:30:00.000Z");
const stageEnded = aThread("review", "2026-11-04T10:00:00.000Z", { stageThread: true });
const stageRunning = aThread("implement", "2026-11-04T08:00:00.000Z", {
  stageThread: true,
  state: "answering",
});

const NO_DECISION = new Set<string>();

function onLive(threadId: string | undefined): ToLine {
  return toLinePicked(threadId, threadId);
}

describe("writableThreads", () => {
  it("leaves out a Stage Thread whose Stage doesn't run, the rest in order", () => {
    const writable = writableThreads([stageEnded, consultation, planning, stageRunning], undefined);
    expect(writable.map(({ id }) => id)).toEqual(["implement", "planning", "consultation"]);
  });

  it("keeps a person answering writable: a draft can wait for them", () => {
    const answering = aThread("planning", "2026-11-04T09:00:00.000Z", { state: "answering" });
    expect(writableThreads([answering], undefined)).toEqual([answering]);
  });

  it("has none once the record ended", () => {
    expect(writableThreads([planning, stageRunning], "This Task was dropped.")).toEqual([]);
  });
});

describe("liveThread", () => {
  it("is the running Stage's, over an open Decision and a newer Thread", () => {
    const writable = writableThreads([stageRunning, planning, consultation], undefined);
    expect(liveThread(writable, new Set(["planning"]))).toBe(stageRunning);
  });

  it("is the one with an open Decision when no Stage runs", () => {
    const writable = writableThreads([planning, consultation], undefined);
    expect(liveThread(writable, new Set(["planning"]))).toBe(planning);
  });

  it("passes over a closed Stage Thread holding a Decision", () => {
    const writable = writableThreads([planning, consultation, stageEnded], undefined);
    expect(liveThread(writable, new Set(["review"]))).toBe(consultation);
  });

  it("is the newest writable otherwise, and nothing with none", () => {
    const writable = writableThreads([consultation, planning], undefined);
    expect(liveThread(writable, NO_DECISION)).toBe(consultation);
    expect(liveThread([], NO_DECISION)).toBeUndefined();
  });
});

describe("toLineNow", () => {
  const ids = ["planning", "implement", "consultation"];

  it("starts on the live Thread", () => {
    expect(toLineNow(undefined, ids, "implement", false)).toEqual(onLive("implement"));
  });

  it("follows the live Thread", () => {
    expect(toLineNow(onLive("planning"), ids, "implement", false)).toEqual(onLive("implement"));
  });

  it("keeps a pick while the live Thread stays, even with nothing written", () => {
    const picked = toLinePicked("consultation", "implement");
    expect(toLineNow(picked, ids, "implement", false)).toBe(picked);
  });

  it("keeps a pick through a change of live Thread while the user has a draft", () => {
    const picked = toLinePicked("consultation", "planning");
    expect(toLineNow(picked, ids, "implement", true)).toBe(picked);
  });

  it("keeps a line the user didn't pick too, as they are typing to it", () => {
    const line = onLive("planning");
    expect(toLineNow(line, ids, "implement", true)).toBe(line);
  });

  it("takes the live Thread once that draft is gone", () => {
    const picked = toLinePicked("consultation", "planning");
    expect(toLineNow(picked, ids, "implement", false)).toEqual(onLive("implement"));
  });

  it("leaves a Thread that closed, saying so when it held a draft", () => {
    const picked = toLinePicked("implement", "implement");
    const writable = ["planning"];
    expect(toLineNow(picked, writable, "planning", false)).toEqual(onLive("planning"));
    expect(toLineNow(picked, writable, "planning", true)).toEqual({
      ...onLive("planning"),
      closedUnderDraft: "implement",
    });
  });

  it("stops saying so once the draft is gone", () => {
    const moved = { ...onLive("planning"), closedUnderDraft: "implement" };
    expect(toLineNow(moved, ["planning"], "planning", true)).toBe(moved);
    expect(toLineNow(moved, ["planning"], "planning", false)).toEqual(onLive("planning"));
  });

  it("holds a closed Thread with a draft when no Thread is left to take it", () => {
    const line = onLive("implement");
    expect(toLineNow(line, [], undefined, true)).toBe(line);
    expect(toLineNow(line, [], undefined, false)).toEqual(onLive(undefined));
  });

  it("names no Thread with none writable, and takes one that opens", () => {
    const none = onLive(undefined);
    expect(toLineNow(none, [], undefined, false)).toBe(none);
    expect(toLineNow(none, ["implement"], "implement", false)).toEqual(onLive("implement"));
  });
});

describe("workingThread", () => {
  const onPlanning = { ...planning, consultation: null };
  const onStage = { ...stageEnded, consultation: null };

  it("is the closed Stage Thread holding the Decision, not the Thread To writes to", () => {
    const working = workingThread([onPlanning, onStage], [onPlanning], new Set([onStage.id]));
    expect(working?.id).toBe(onStage.id);
  });

  it("is Planning while no Stage has run", () => {
    expect(workingThread([onPlanning], [onPlanning], NO_DECISION)?.id).toBe(onPlanning.id);
  });
});
