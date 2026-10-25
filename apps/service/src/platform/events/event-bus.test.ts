import { describe, expect, it, vi } from "vitest";
import { DomainEvent } from "./domain-event.js";
import { EventBus } from "./event-bus.js";

class ThingAdded extends DomainEvent {
  constructor(readonly name: string) {
    super();
  }
}

class SpecialThingAdded extends ThingAdded {}

class ThingRemoved extends DomainEvent {}

describe("EventBus", () => {
  it("passes an event to the handlers of exactly its class", async () => {
    const bus = new EventBus();
    const thingAdded = vi.fn<(event: ThingAdded) => void>();
    const thingRemoved = vi.fn<(event: ThingRemoved) => void>();
    bus.subscribe(ThingAdded, thingAdded);
    bus.subscribe(ThingRemoved, thingRemoved);
    const event = new ThingAdded("lamp");

    await bus.publish(event);
    await bus.publish(new SpecialThingAdded("desk"));

    expect(thingAdded.mock.calls).toEqual([[event]]);
    expect(thingRemoved).not.toHaveBeenCalled();
  });

  it("passes every event to a handler of every event", async () => {
    const bus = new EventBus();
    const everyEvent = vi.fn<(event: DomainEvent) => void>();
    bus.subscribeToEveryEvent(everyEvent);
    const added = new ThingAdded("lamp");
    const removed = new ThingRemoved();

    await bus.publish(added);
    await bus.publish(removed);

    expect(everyEvent.mock.calls).toEqual([[added], [removed]]);
  });

  it("stops passing events to an unsubscribed handler", async () => {
    const bus = new EventBus();
    const thingAdded = vi.fn<(event: ThingAdded) => void>();
    const everyEvent = vi.fn<(event: DomainEvent) => void>();
    bus.subscribe(ThingAdded, thingAdded)();
    bus.subscribeToEveryEvent(everyEvent)();

    await bus.publish(new ThingAdded("lamp"));

    expect(thingAdded).not.toHaveBeenCalled();
    expect(everyEvent).not.toHaveBeenCalled();
  });

  it("waits for asynchronous handlers, and a failing handler stops neither the others nor the publisher", async () => {
    const bus = new EventBus();
    const handled: string[] = [];
    bus.subscribe(ThingAdded, async () => {
      throw new Error("handler broke");
    });
    bus.subscribe(ThingAdded, async (event) => {
      await Promise.resolve();
      handled.push(event.name);
    });

    await expect(bus.publish(new ThingAdded("lamp"))).resolves.toBeUndefined();

    expect(handled).toEqual(["lamp"]);
  });
});
