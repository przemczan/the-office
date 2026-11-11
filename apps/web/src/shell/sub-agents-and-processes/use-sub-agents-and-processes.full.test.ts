import type { SubAgentOrProcess, WebEvent } from "@the-office/contracts";
import { describe, expect, it } from "vitest";
import { aProcess, aSubAgent, endedAfter, itemEvent } from "./sub-agents-and-processes.fixtures.ts";
import { listWithEvent } from "./use-sub-agents-and-processes.ts";

const started = aSubAgent({ revision: 0 });
const changed = aSubAgent({ revision: 1, engineTaskId: "a1b2c3", background: true });
const ended = aSubAgent({
  revision: 2,
  engineTaskId: "a1b2c3",
  background: true,
  state: "finished",
  ending: { state: "finished" },
  endedAt: endedAfter(60_000),
});
const theEvents: readonly WebEvent[] = [
  itemEvent("thread.sub-agent-started", started),
  itemEvent("thread.sub-agent-changed", changed),
  itemEvent("thread.sub-agent-ended", ended),
  itemEvent("thread.process-started", aProcess()),
];

function applied(events: readonly WebEvent[]): SubAgentOrProcess[] {
  return events.reduce<SubAgentOrProcess[]>(listWithEvent, []);
}

describe("the list kept by events", () => {
  it("ends the same in whatever order the events come", () => {
    const inOrder = applied(theEvents);
    expect(inOrder.find(({ kind }) => kind === "sub-agent")).toEqual(ended);
    for (const order of [
      [2, 1, 0, 3],
      [1, 3, 2, 0],
      [3, 0, 2, 1],
    ]) {
      const list = applied(order.map((index) => theEvents[index]!));
      expect(list.toSorted((first, second) => first.callId.localeCompare(second.callId))).toEqual(
        inOrder.toSorted((first, second) => first.callId.localeCompare(second.callId)),
      );
    }
  });

  it("leaves the list as it is for any other event", () => {
    const list = applied(theEvents);
    expect(
      listWithEvent(list, { type: "thread.turn-ended", occurredAt: endedAfter(0) } as WebEvent),
    ).toEqual(list);
  });
});
