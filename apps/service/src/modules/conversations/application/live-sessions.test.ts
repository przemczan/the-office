import { describe, expect, it } from "vitest";
import type { EngineSessions } from "../../engine/index.js";
import { LiveSessions, OpeningStopped } from "./live-sessions.js";

type EngineSession = Awaited<ReturnType<EngineSessions["start"]>>;

const THREAD = "thread-1";

/** The lifecycle alone reads and writes no Thread: barge-ins have their own tests. */
function lives(): LiveSessions {
  return new LiveSessions({} as never, {} as never, {} as never, {} as never);
}

/** An engine session that only counts its ends. */
function aSession(): EngineSession & { readonly ends: () => number } {
  let ends = 0;
  const session = {
    end: () => {
      ends += 1;
      return Promise.resolve();
    },
    send: () => undefined,
    ends: () => ends,
  };
  return session as unknown as EngineSession & { readonly ends: () => number };
}

describe("a Thread's session's life", () => {
  it("opens, runs a turn, idles between turns and ends", async () => {
    const owner = lives();
    const opening = owner.beginOpening(THREAD, "thread-runner");
    expect(owner.phaseOf(THREAD)).toBe("opening");

    const session = aSession();
    await owner.run(opening, session);
    owner.settle(opening);
    expect(owner.phaseOf(THREAD)).toBe("running");
    owner.turnEnded(THREAD, session);
    expect(owner.phaseOf(THREAD)).toBe("idle");
    owner.turnBegan(THREAD, session);
    expect(owner.phaseOf(THREAD)).toBe("running");

    await owner.endSession(THREAD);
    expect(session.ends()).toBe(1);
    expect(owner.phaseOf(THREAD)).toBeUndefined();
  });

  it("stops an opening, which throws at its next step and ends the session it got instead of running it", async () => {
    const owner = lives();
    const opening = owner.beginOpening(THREAD, "thread-runner");
    const ending = owner.end(THREAD, "Changes were switched off, so the answer stopped.");

    expect(() => opening.check()).toThrow(OpeningStopped);
    const session = aSession();
    await expect(owner.run(opening, session)).rejects.toThrow(
      "Changes were switched off, so the answer stopped.",
    );
    expect(session.ends()).toBe(1);
    expect(owner.sessionOf(THREAD)).toBeUndefined();
    owner.settle(opening);
    await ending;
    expect(owner.phaseOf(THREAD)).toBeUndefined();
  });

  it("waits for a stopped opening to be settled before it has ended", async () => {
    const owner = lives();
    const opening = owner.beginOpening(THREAD, "thread-runner");
    let ended = false;
    const ending = owner.end(THREAD, "The chat was deleted.").then(() => (ended = true));

    await Promise.resolve();
    expect(ended).toBe(false);
    owner.settle(opening);
    await ending;
    expect(ended).toBe(true);
  });

  it("ends an idle session without stopping the opening that goes on in it, which opens again", async () => {
    const owner = lives();
    const first = owner.beginOpening(THREAD, "thread-runner");
    const session = aSession();
    await owner.run(first, session);
    owner.settle(first);
    owner.turnEnded(THREAD, session);

    const next = owner.beginOpening(THREAD, "thread-runner");
    await owner.endSession(THREAD);

    expect(owner.goOn(next, session)).toBe(false);
    expect(next.stopped).toBe(false);
  });

  it("ends only the owner's sessions as the service stops", async () => {
    const owner = lives();
    const chat = aSession();
    const stage = aSession();
    const chatOpening = owner.beginOpening("chat", "thread-runner");
    await owner.run(chatOpening, chat);
    owner.settle(chatOpening);
    const stageOpening = owner.beginOpening("stage", "stage-threads");
    await owner.run(stageOpening, stage);
    owner.settle(stageOpening);
    const opening = owner.beginOpening("opening", "thread-runner");

    await owner.endEvery("thread-runner", "The Office stopped before the session opened.");

    expect(chat.ends()).toBe(1);
    expect(stage.ends()).toBe(0);
    expect(opening.stopped).toBe(true);
  });
});
