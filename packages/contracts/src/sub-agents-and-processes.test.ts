import { describe, expect, it } from "vitest";
import { withSubAgentOrProcess, type Process } from "./conversations.js";

const STARTED: Process = {
  kind: "process",
  callId: "bash-1",
  engineTaskId: "b1f9c2e07",
  startedBy: null,
  description: "Serve the app",
  state: "running",
  ending: null,
  startedAt: "2026-11-11T09:00:00.000Z",
  endedAt: null,
  revision: 0,
  lastSequence: 0,
  commandLine: "npm run dev",
  exitCode: null,
  earlierOutputNotKept: 0,
};

const ENDED: Process = {
  ...STARTED,
  state: "stopped",
  ending: { state: "stopped", by: "agent" },
  endedAt: "2026-11-11T09:05:00.000Z",
  revision: 1,
};

const OTHER: Process = { ...STARTED, callId: "bash-2", description: "Run the tests" };

/** Every order of the events, each applied to an empty list. */
function permutations<Item>(items: readonly Item[]): Item[][] {
  if (items.length <= 1) return [[...items]];
  return items.flatMap((item, index) =>
    permutations([...items.slice(0, index), ...items.slice(index + 1)]).map((rest) => [
      item,
      ...rest,
    ]),
  );
}

describe("withSubAgentOrProcess", () => {
  it("leaves the same list whatever order the start, change and end events come in", () => {
    const lists = permutations([STARTED, ENDED, OTHER]).map((events) =>
      events.reduce(withSubAgentOrProcess, []),
    );

    for (const list of lists) {
      expect(new Map(list.map((item) => [item.callId, item]))).toEqual(
        new Map([
          [ENDED.callId, ENDED],
          [OTHER.callId, OTHER],
        ]),
      );
    }
  });

  it("never puts an ended item back to Running, even from a copy with a higher revision", () => {
    const list = withSubAgentOrProcess([ENDED], { ...STARTED, revision: 5 });

    expect(list).toEqual([ENDED]);
  });
});
