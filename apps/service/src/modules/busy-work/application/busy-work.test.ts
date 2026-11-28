import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { BusyItem } from "../domain/busy-item.js";
import { BusyWorkChanged } from "../domain/busy-work-events.js";
import { BusyWork } from "./busy-work.js";

const TURN: BusyItem = { kind: "turn", label: "Jim's turn in Implement on the Task 'Add login'" };
const PUBLISH: BusyItem = { kind: "publish", label: "Publish of the Task 'Add login'" };

let busyWork: BusyWork;
let counts: number[];

beforeEach(() => {
  const events = new EventBus();
  busyWork = new BusyWork(events);
  counts = [];
  events.subscribe(BusyWorkChanged, ({ count }) => {
    counts.push(count);
  });
});

describe("BusyWork", () => {
  it("counts an item as busy until its end is called, announcing each change", () => {
    const endTurn = busyWork.begin(TURN);
    const endPublish = busyWork.begin(PUBLISH);

    expect(busyWork.list()).toEqual([TURN, PUBLISH]);
    endTurn();
    expect(busyWork.list()).toEqual([PUBLISH]);
    endPublish();

    expect(busyWork.list()).toEqual([]);
    expect(counts).toEqual([1, 2, 1, 0]);
  });

  it("ends an item once, however often its end is called", () => {
    const end = busyWork.begin(TURN);

    end();
    end();

    expect(busyWork.list()).toEqual([]);
    expect(counts).toEqual([1, 0]);
  });

  it("counts work while it runs and ends it however it ends", async () => {
    let listedDuring: readonly BusyItem[] = [];

    const answer = await busyWork.during(TURN, () => {
      listedDuring = busyWork.list();
      return Promise.resolve("done");
    });
    const failure = busyWork.during(PUBLISH, () => Promise.reject(new Error("The push failed.")));

    expect(answer).toBe("done");
    expect(listedDuring).toEqual([TURN]);
    await expect(failure).rejects.toThrow("The push failed.");
    expect(busyWork.list()).toEqual([]);
  });
});
