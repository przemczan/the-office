import { describe, expect, it } from "vitest";
import { BargeIns } from "./barge-ins.js";

const ANN = { userId: "00000000-0000-4000-8000-0000000005e1", name: "Ann Lee" };
const BEN = { userId: "00000000-0000-4000-8000-0000000005e2", name: "Ben Ito" };

describe("who wrote the barge-in before, in a Stage's session", () => {
  it("is nobody for the session's first, then the writer of the one before", () => {
    const bargeIns = new BargeIns(() => undefined);

    expect(bargeIns.writerBefore(ANN)).toBeUndefined();
    expect(bargeIns.writerBefore(ANN)).toEqual(ANN);
    expect(bargeIns.writerBefore(BEN)).toEqual(ANN);
  });

  it("starts again with each session, whoever wrote in the one before", () => {
    new BargeIns(() => undefined).writerBefore(ANN);

    expect(new BargeIns(() => undefined).writerBefore(ANN)).toBeUndefined();
  });
});
