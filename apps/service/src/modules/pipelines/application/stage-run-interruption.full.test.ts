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

  it("keeps a Stop over a later Pause, and tells a listener removed of nothing", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"))();

    interruption.request("stop");
    interruption.request("pause");

    expect([interruption.requested, stopped]).toEqual(["stop", []]);
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

  it("cuts short at the hard stop only a run held until its turn ends", () => {
    const untouched = new StageRunInterruption();
    const stoppedAlready = new StageRunInterruption();
    stoppedAlready.request("stop");

    untouched.hardStop();
    stoppedAlready.hardStop();

    expect([untouched.cutShortBy, untouched.now, stoppedAlready.cutShortBy]).toEqual([
      undefined,
      false,
      undefined,
    ]);
  });

  it("keeps a run the fire alarm holds held, cut short, as The Office restarts", () => {
    const interruption = new StageRunInterruption();

    interruption.request("alarm");
    interruption.request("restart");

    expect([interruption.requested, interruption.cutShortBy]).toEqual(["alarm", "restart"]);
  });

  it("stops the Project commands on a restart, which outranks a Stop without a second interrupt", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"));

    interruption.request("stop");
    expect(interruption.commandsSignal.aborted).toBe(false);

    interruption.request("restart");
    interruption.request("stop");
    expect([interruption.requested, interruption.commandsSignal.aborted, stopped]).toEqual([
      "restart",
      true,
      ["now"],
    ]);
  });
});
