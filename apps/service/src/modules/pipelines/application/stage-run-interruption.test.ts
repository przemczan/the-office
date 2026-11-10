import { describe, expect, it } from "vitest";
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
});
