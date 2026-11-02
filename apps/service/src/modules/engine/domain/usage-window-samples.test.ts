import { describe, expect, it } from "vitest";
import { pooledRatios, sampleBetween, type PairedReading } from "./usage-window-samples.js";

const EARLIER: PairedReading = {
  fiveHour: { percentUsed: 10, resetsAt: new Date("2026-11-02T15:00:00Z") },
  sevenDay: { percentUsed: 30, resetsAt: new Date("2026-11-06T09:00:00Z") },
  source: "rate-limit-headers",
  readAt: new Date("2026-11-02T12:00:00Z"),
  officeTokens: 1_000,
};

function laterBy(changes: Partial<PairedReading>): PairedReading {
  return {
    ...EARLIER,
    fiveHour: { ...EARLIER.fiveHour, percentUsed: 11 },
    sevenDay: { ...EARLIER.sevenDay, percentUsed: 30 },
    readAt: new Date("2026-11-02T12:05:00Z"),
    officeTokens: 5_000,
    ...changes,
  };
}

describe("a pair of readings", () => {
  it("counts the Office's tokens between them and each window's change, 0 too", () => {
    expect(sampleBetween(EARLIER, laterBy({}))).toEqual({
      readAt: new Date("2026-11-02T12:05:00Z"),
      tokens: 4_000,
      fiveHour: 1,
      sevenDay: 0,
    });
  });

  it("counts only readings of one known source", () => {
    expect(sampleBetween(EARLIER, laterBy({ source: "usage-endpoint" }))).toBeUndefined();
    const unknown = { ...EARLIER, source: undefined };
    expect(sampleBetween(unknown, laterBy({ source: undefined }))).toBeUndefined();
  });

  it("counts only when the Office's tokens went up", () => {
    expect(sampleBetween(EARLIER, laterBy({ officeTokens: 1_000 }))).toBeUndefined();
    expect(sampleBetween(EARLIER, laterBy({ officeTokens: 500 }))).toBeUndefined();
  });

  it("leaves out a window that reset between them, the other standing", () => {
    const sample = sampleBetween(
      EARLIER,
      laterBy({
        readAt: new Date("2026-11-02T15:01:00Z"),
        fiveHour: { percentUsed: 1, resetsAt: new Date("2026-11-02T20:00:00Z") },
        sevenDay: { ...EARLIER.sevenDay, percentUsed: 31 },
      }),
    );
    expect(sample).toMatchObject({ fiveHour: undefined, sevenDay: 1 });
  });

  it("leaves out a window that went down, and the pair when no window counts", () => {
    const fiveHourDown = laterBy({ fiveHour: { ...EARLIER.fiveHour, percentUsed: 9 } });
    expect(sampleBetween(EARLIER, fiveHourDown)).toMatchObject({
      fiveHour: undefined,
      sevenDay: 0,
    });
    const bothDown = laterBy({
      fiveHour: { ...EARLIER.fiveHour, percentUsed: 9 },
      sevenDay: { ...EARLIER.sevenDay, percentUsed: 29 },
    });
    expect(sampleBetween(EARLIER, bothDown)).toBeUndefined();
  });

  it("counts a window begun between them from 0", () => {
    const notBegun = { ...EARLIER, fiveHour: { percentUsed: 0, resetsAt: undefined } };
    expect(sampleBetween(notBegun, laterBy({}))).toMatchObject({ fiveHour: 11 });
  });
});

describe("the pooled ratios", () => {
  it("sum each window's changes over the tokens of the pairs that give it", () => {
    const readAt = new Date("2026-11-02T12:00:00Z");
    expect(
      pooledRatios([
        { readAt, tokens: 4_000, fiveHour: 1, sevenDay: 0 },
        { readAt, tokens: 6_000, fiveHour: 0, sevenDay: undefined },
      ]),
    ).toEqual({ fiveHour: 1 / 10_000, sevenDay: 0 });
  });

  it("give none with no pair", () => {
    expect(pooledRatios([])).toEqual({ fiveHour: undefined, sevenDay: undefined });
  });
});
