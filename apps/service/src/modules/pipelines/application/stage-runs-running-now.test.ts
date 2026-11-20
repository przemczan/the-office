import { describe, expect, it } from "vitest";
import { StageRunsRunningNow } from "./stage-runs-running-now.js";

describe("StageRunsRunningNow", () => {
  it("counts the Agent and Script Stage runs until each ends, once", () => {
    const running = new StageRunsRunningNow();

    const agent = running.began("agent");
    const script = running.began("script");
    running.began("gate");

    expect(running.count()).toBe(2);
    agent();
    agent();
    expect(running.count()).toBe(1);
    script();
    expect(running.count()).toBe(0);
  });
});
