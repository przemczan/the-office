import { describe, expect, it } from "vitest";
import { onWorkWithPersonal } from "./stand-ins-at-start.fixtures.js";
import { NO_STAND_INS } from "./stand-ins-at-start.js";
import { startPastUsageCaps } from "./start-past-usage-caps.js";
import type { HeldAtStart, StartConditions } from "./task-start.js";
import { aTask, NO_USAGE_AT_START } from "./work.fixtures.js";

const ready = aTask({ id: "task-ready", state: "ready", projectId: "admin-panel" });

const conditions: StartConditions = {
  stages: [{ name: "Implement", role: "developer" }],
  person: { name: "Ada", taskLimit: 2 },
  officeWideLimit: 3,
  project: { name: "Admin panel", projectLimit: 2 },
  usage: NO_USAGE_AT_START,
  standIns: NO_STAND_INS,
  scheduledExitWait: undefined,
};

const nothingHeld: HeldAtStart = {
  startedTasks: [],
  blockers: [],
  fireAlarmOn: false,
  initiativePaused: false,
};

/** Work over its 80% cap and Personal, its Stand-in Engine, over its own. */
const bothCapped: StartConditions = { ...conditions, ...onWorkWithPersonal(60, 70) };

const SATURDAY = new Date("2026-10-31T08:00:00.000Z");
const workUsedUpUntilSaturday = { engineId: "work", windowWords: "7-day window", until: SATURDAY };

describe("startPastUsageCaps", () => {
  it("offers to start on the cascade's engine past the caps, naming each it passes", () => {
    expect(startPastUsageCaps(ready, bothCapped, nothingHeld)).toEqual({
      passes: ["Work: 5-hour window cap (80%) · resets 12:00"],
      engines: [{ name: "Work", standingInFor: undefined }],
      refusals: [],
    });
  });

  it("starts on the Stand-in Engine whose window isn't used up, in place of a used-up one", () => {
    const workUsedUp: StartConditions = {
      ...bothCapped,
      usage: { ...bothCapped.usage, usedUp: [workUsedUpUntilSaturday] },
    };

    expect(startPastUsageCaps(ready, workUsedUp, nothingHeld)).toEqual({
      passes: ["Personal: 5-hour window cap (80%) · resets 12:00"],
      engines: [{ name: "Personal", standingInFor: "Work" }],
      refusals: [],
    });
  });

  it("can't start while every engine's window is used up, saying why", () => {
    const { usage, standIns } = bothCapped;
    const allUsedUp: StartConditions = {
      ...bothCapped,
      usage: { ...usage, usedUp: [workUsedUpUntilSaturday] },
      standIns: {
        ...standIns,
        standIns: standIns.standIns.map((standIn) => ({
          ...standIn,
          usedUp: { engineId: "personal", windowWords: "5-hour window", until: SATURDAY },
        })),
      },
    };

    expect(startPastUsageCaps(ready, allUsedUp, nothingHeld)?.refusals).toEqual([
      "Work's 7-day window is used up until Sat 31 Oct 08:00.",
      "No Stand-in Engine has room either: Personal: 5-hour window used up · until Sat 31 Oct 08:00.",
    ]);
  });

  it("offers nothing while its usage holds nothing, or anything else holds it too", () => {
    const fireAlarm = { ...nothingHeld, fireAlarmOn: true };
    const atTheLimit = { ...bothCapped, officeWideLimit: 0 };

    expect(startPastUsageCaps(ready, conditions, nothingHeld)).toBeUndefined();
    expect(startPastUsageCaps(ready, bothCapped, fireAlarm)).toBeUndefined();
    expect(startPastUsageCaps(ready, atTheLimit, nothingHeld)).toBeUndefined();
  });
});
