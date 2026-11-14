import { describe, expect, it } from "vitest";
import { StageRunInterruption } from "./stage-run-interruption.js";

describe("StageRunInterruption", () => {
  it("keeps a Stop over a later Pause, and tells a listener removed of nothing", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"))();

    interruption.request("stop");
    interruption.request("pause");

    expect([interruption.requested, stopped]).toEqual(["stop", []]);
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

  it("stops the Project commands on a restart, and keeps the user's Stop, which discards the edits, over it", () => {
    const interruption = new StageRunInterruption();
    const stopped: string[] = [];
    interruption.onNow(() => stopped.push("now"));

    interruption.request("stop");
    expect(interruption.commandsSignal.aborted).toBe(false);

    interruption.request("restart");
    interruption.request("stop");
    expect([interruption.requested, interruption.commandsSignal.aborted, stopped]).toEqual([
      "stop",
      true,
      ["now"],
    ]);
  });
});
