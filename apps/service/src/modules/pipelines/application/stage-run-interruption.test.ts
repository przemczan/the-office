import { describe, expect, it } from "vitest";
import { closingOf, interruptedOutcome } from "../domain/stage-interruption.js";
import { StageRunInterruption } from "./stage-run-interruption.js";

describe("StageRunInterruption", () => {
  it("waits for the turn on a Pause, and stops it now once a Stop follows", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"));

    interruption.request("pause");
    expect([interruption.requested, interruption.now, stopped]).toEqual(["pause", false, []]);

    interruption.request("stop");
    expect([interruption.requested, interruption.now, stopped]).toEqual(["stop", true, ["now"]]);
  });

  it("cuts a paused run's turn short on a restart, keeping it paused", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"));

    interruption.request("pause");
    interruption.request("restart");

    expect([
      interruption.requested,
      interruption.cutShortBy,
      interruption.now,
      interruption.commandsSignal.aborted,
      stopped,
    ]).toEqual(["pause", "restart", true, true, ["now"]]);
  });

  it("holds a run for the fire alarm after the turn, its commands stopped now, and cuts the turn short at the hard stop", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"));

    interruption.request("pause");
    interruption.request("alarm");
    const held = [interruption.requested, interruption.now, interruption.commandsSignal.aborted];
    interruption.hardStop();
    interruption.hardStop();

    expect(held).toEqual(["alarm", false, true]);
    expect([interruption.cutShortBy, interruption.now, stopped]).toEqual(["alarm", true, ["now"]]);
  });

  it("holds a run refused for a used-up usage window after its turn, its commands left, and a Stop outranks it", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"));

    interruption.request("pause");
    interruption.request("usage-window");
    expect([
      interruption.requested,
      interruption.now,
      interruption.commandsSignal.aborted,
      stopped,
    ]).toEqual(["usage-window", false, false, []]);

    interruption.request("pause");
    expect(interruption.requested).toBe("usage-window");

    interruption.request("stop");
    expect([interruption.requested, interruption.now, stopped]).toEqual(["stop", true, ["now"]]);
  });

  it("closes a run held by the usage window as held, not as a failure", () => {
    const refused = {
      message: "work" as const,
      sessionLeft: true,
      engineName: "Claude Code",
      windowWords: "5-hour window",
      resetsAt: "2026-11-13T14:00:00.000Z",
    };

    const outcome = interruptedOutcome("usage-window", [], { refused });

    expect(outcome).toMatchObject({
      status: "failed",
      interrupted: "usage-window",
      refused,
      error: expect.stringContaining(
        "Paused: Claude Code's 5-hour window is used up until 2026-11-13 14:00 UTC.",
      ) as string,
    });
    // The Thread's used-up line just before it names the reset in the reader's own time.
    expect(closingOf(outcome)).toEqual({
      kind: "held",
      heldBy: "usage-window",
      text: "Held until the window resets: the Stage's uncommitted edits stay in the worktree, and it goes on in its own Thread then.",
    });
    expect(closingOf(interruptedOutcome("restart", []))).toMatchObject({ kind: "failure" });
  });
});
