import type { CpuInfo } from "node:os";
import { describe, expect, it } from "vitest";
import { coreTimesOf, cpuUseBetween } from "./cpu-use.js";

describe("cpuUseBetween", () => {
  it("has nothing to measure on the first read", () => {
    expect(cpuUseBetween(undefined, [{ total: 1000, idle: 500 }])).toBeNull();
  });

  it("gives each core's use since the earlier read, and the overall use by time", () => {
    const earlier = [
      { total: 1000, idle: 1000 },
      { total: 1000, idle: 1000 },
    ];
    const later = [
      { total: 2000, idle: 1750 },
      { total: 1500, idle: 1000 },
    ];

    expect(cpuUseBetween(earlier, later)).toEqual({ percent: 50, perCore: [25, 100] });
  });

  it("has nothing to measure when no time passed", () => {
    const cores = [{ total: 1000, idle: 400 }];

    expect(cpuUseBetween(cores, cores)).toBeNull();
  });

  it("gives a core no time passed on 0% while the others measure", () => {
    const earlier = [
      { total: 1000, idle: 1000 },
      { total: 1000, idle: 1000 },
    ];
    const later = [
      { total: 1000, idle: 1000 },
      { total: 2000, idle: 1000 },
    ];

    expect(cpuUseBetween(earlier, later)).toEqual({ percent: 100, perCore: [0, 100] });
  });

  it("has nothing to measure when the cores changed between reads", () => {
    expect(cpuUseBetween([{ total: 1, idle: 1 }], [])).toBeNull();
    expect(
      cpuUseBetween(
        [{ total: 1000, idle: 1000 }],
        [
          { total: 2000, idle: 1000 },
          { total: 2000, idle: 1000 },
        ],
      ),
    ).toBeNull();
  });
});

describe("coreTimesOf", () => {
  it("counts every kind of time in the total", () => {
    const cpu: CpuInfo = {
      model: "Test CPU",
      speed: 3000,
      times: { user: 10, nice: 1, sys: 5, idle: 80, irq: 4 },
    };

    expect(coreTimesOf([cpu])).toEqual([{ total: 100, idle: 80 }]);
  });
});
