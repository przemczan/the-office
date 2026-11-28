import { beforeEach, describe, expect, it } from "vitest";
import { EventBus } from "../../../platform/events/event-bus.js";
import { BusyWork, ScheduledExitHold } from "../../busy-work/index.js";
import { OfficeRestartScheduled } from "../domain/office-update-events.js";
import type { OfficeScheduledExit } from "../domain/scheduled-exit.js";
import { ScheduledExits, type GoAhead } from "./scheduled-exits.js";

const RESTART: OfficeScheduledExit = {
  kind: "restart",
  scheduledAt: new Date("2026-11-28T09:00Z"),
};
const TURN = { kind: "turn", label: "Jim's turn in Implement on the Task 'Add login'" } as const;

let busyWork: BusyWork;
let hold: ScheduledExitHold;
let exits: ScheduledExits;
let handedOver: OfficeScheduledExit[];
let exitsCalled: number;

/** Registers the restart's go-ahead: `goAhead`, after noting each hand-over. */
function restartGoesAhead(goAhead: GoAhead = () => Promise.resolve("exit")): void {
  exits.carryOut("restart", (exit) => {
    handedOver.push(exit);
    return goAhead(exit);
  });
}

/** Lets the bus's handlers, which a change runs in the background, settle. */
async function settled(): Promise<void> {
  await new Promise((resolve) => setImmediate(resolve));
}

beforeEach(() => {
  const events = new EventBus();
  busyWork = new BusyWork(events);
  hold = new ScheduledExitHold();
  exits = new ScheduledExits(hold, busyWork, events);
  exits.onModuleInit();
  handedOver = [];
  exitsCalled = 0;
  exits.onReadyToExit(() => {
    exitsCalled += 1;
  });
});

describe("ScheduledExits", () => {
  it("holds new work and hands the exit over at once when nothing is busy, then exits", async () => {
    restartGoesAhead();

    await exits.schedule(RESTART, new OfficeRestartScheduled());

    expect(hold.scheduled).toEqual(RESTART);
    expect(handedOver).toEqual([RESTART]);
    expect(exits.underWay).toBe(true);
    expect(exitsCalled).toBe(1);
  });

  it("waits for the busy work to end before it hands the exit over", async () => {
    restartGoesAhead();
    const endTurn = busyWork.begin(TURN);

    await exits.schedule(RESTART, new OfficeRestartScheduled());
    expect(handedOver).toEqual([]);
    endTurn();
    await settled();

    expect(handedOver).toEqual([RESTART]);
    expect(exitsCalled).toBe(1);
  });

  it("exits only once work begun while the exit was handed over has ended", async () => {
    let endTurn: (() => void) | undefined;
    restartGoesAhead(() => {
      endTurn = busyWork.begin(TURN);
      return Promise.resolve("exit");
    });

    await exits.schedule(RESTART, new OfficeRestartScheduled());
    await settled();
    expect(handedOver).toEqual([RESTART]);
    expect(exitsCalled).toBe(0);
    endTurn?.();
    await settled();

    expect(handedOver).toEqual([RESTART]);
    expect(exitsCalled).toBe(1);
  });

  it("never exits for an exit carried on while the service runs", async () => {
    restartGoesAhead(() => Promise.resolve("stay"));

    await exits.schedule(RESTART, new OfficeRestartScheduled());

    expect(handedOver).toEqual([RESTART]);
    expect(exitsCalled).toBe(0);
  });

  it("leaves an exit that wasn't handed over scheduled, and tries again at the next change", async () => {
    let failing = true;
    restartGoesAhead(() =>
      failing ? Promise.reject(new Error("The launcher isn't there.")) : Promise.resolve("exit"),
    );

    await exits.schedule(RESTART, new OfficeRestartScheduled());
    expect(exits.underWay).toBe(false);
    expect(hold.scheduled).toEqual(RESTART);
    failing = false;
    busyWork.begin(TURN)();
    await settled();

    expect(handedOver).toEqual([RESTART, RESTART]);
    expect(exitsCalled).toBe(1);
  });

  it("lets go of what it held once cancelled, and never exits for it", async () => {
    restartGoesAhead();
    const endTurn = busyWork.begin(TURN);
    await exits.schedule(RESTART, new OfficeRestartScheduled());

    await exits.cancel();
    endTurn();
    await settled();

    expect(hold.scheduled).toBeUndefined();
    expect(handedOver).toEqual([]);
    expect(exitsCalled).toBe(0);
  });
});
