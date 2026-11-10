import { describe, expect, it } from "vitest";
import { HISTORY_LENGTH, withRead, type WorkstationRead } from "./workstation-history.ts";

function readAt(percent: number): WorkstationRead {
  return { cpuPercent: percent, memoryPercent: percent };
}

describe("the workstation history", () => {
  it("keeps each read, oldest first", () => {
    expect(withRead(withRead([], readAt(1)), readAt(2))).toEqual([readAt(1), readAt(2)]);
  });

  it(`keeps at most ${HISTORY_LENGTH} reads, dropping the oldest first`, () => {
    let history: readonly WorkstationRead[] = [];
    for (let read = 1; read <= HISTORY_LENGTH + 5; read++)
      history = withRead(history, readAt(read));

    expect(history).toHaveLength(HISTORY_LENGTH);
    expect(history[0]).toEqual(readAt(6));
    expect(history.at(-1)).toEqual(readAt(HISTORY_LENGTH + 5));
  });
});
