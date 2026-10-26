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
      interruption.cutShort,
      interruption.now,
      interruption.commandsSignal.aborted,
      stopped,
    ]).toEqual(["pause", true, true, true, ["now"]]);
  });

  it("stops the Project commands only on a restart, which outranks a Stop without a second interrupt", () => {
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
