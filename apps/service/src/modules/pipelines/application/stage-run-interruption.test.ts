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
});
