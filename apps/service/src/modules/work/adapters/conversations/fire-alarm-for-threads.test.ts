import { describe, expect, it } from "vitest";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { FireAlarmInThreads } from "../../../conversations/index.js";
import type { FireAlarmService } from "../../application/fire-alarm-service.js";
import type { FireAlarm, FireAlarmWay } from "../../domain/fire-alarm.js";
import { AlarmSounded } from "../../domain/fire-alarm-events.js";
import { FireAlarmForThreads } from "./fire-alarm-for-threads.js";

const SINCE = new Date("2026-11-21T09:00:00.000Z");

function threadsOn(alarm: FireAlarm): { inThreads: FireAlarmInThreads; events: EventBus } {
  const inThreads = new FireAlarmInThreads();
  const events = new EventBus();
  const fireAlarm = { read: () => Promise.resolve(alarm) } as unknown as FireAlarmService;
  new FireAlarmForThreads(fireAlarm, inThreads, events).onModuleInit();
  return { inThreads, events };
}

describe("FireAlarmForThreads", () => {
  it("shows Threads the alarm on, cutting chats' tools and stopping Consultations, only once it is ASAP", async () => {
    for (const way of ["after-stages", "after-tasks"] as const satisfies FireAlarmWay[]) {
      expect(await threadsOn({ on: true, since: SINCE, way }).inThreads.read()).toEqual({
        on: false,
      });
    }
    expect(await threadsOn({ on: true, since: SINCE, way: "asap" }).inThreads.read()).toEqual({
      on: true,
      since: SINCE,
    });
    expect(await threadsOn({ on: false }).inThreads.read()).toEqual({ on: false });
  });

  it("tells Threads it sounded only for ASAP, as a softer alarm is made ASAP too", async () => {
    const { inThreads, events } = threadsOn({ on: true, since: SINCE, way: "asap" });
    const sounded: string[] = [];
    inThreads.whenSounded(async () => {
      sounded.push("sounded");
    });

    await events.publish(new AlarmSounded("after-tasks", undefined, SINCE));
    await events.publish(new AlarmSounded("after-stages", undefined, SINCE));
    await events.publish(new AlarmSounded("asap", new Date(SINCE.getTime() + 60_000), SINCE));

    expect(sounded).toEqual(["sounded"]);
  });
});
