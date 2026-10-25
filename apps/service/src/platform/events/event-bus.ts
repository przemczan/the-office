import { Injectable, Logger } from "@nestjs/common";
import type { DomainEvent, DomainEventClass } from "./domain-event.js";

export type EventHandler<Event extends DomainEvent> = (event: Event) => void | Promise<void>;
export type Unsubscribe = () => void;

/** The in-process bus every module publishes its domain events on. */
@Injectable()
export class EventBus {
  private readonly logger = new Logger(EventBus.name);
  private readonly handlersByClass = new Map<DomainEventClass, Set<EventHandler<DomainEvent>>>();
  private readonly handlersOfEveryEvent = new Set<EventHandler<DomainEvent>>();

  /** Handles events of exactly this class, not of its subclasses. */
  subscribe<Event extends DomainEvent>(
    eventClass: DomainEventClass<Event>,
    handler: EventHandler<Event>,
  ): Unsubscribe {
    const handlers = this.handlersByClass.get(eventClass) ?? new Set();
    this.handlersByClass.set(eventClass, handlers);
    // Safe: publish only passes this handler events whose constructor is eventClass.
    const anyEventHandler = handler as EventHandler<DomainEvent>;
    handlers.add(anyEventHandler);
    return () => handlers.delete(anyEventHandler);
  }

  /** Handles every event, for consumers such as the WebSocket push and telemetry. */
  subscribeToEveryEvent(handler: EventHandler<DomainEvent>): Unsubscribe {
    this.handlersOfEveryEvent.add(handler);
    return () => this.handlersOfEveryEvent.delete(handler);
  }

  /**
   * Runs every handler of the event and resolves when all have settled. A handler that fails is
   * logged and stops neither the others nor the publisher.
   */
  async publish(event: DomainEvent): Promise<void> {
    const handlers = [
      ...(this.handlersByClass.get(event.constructor as DomainEventClass) ?? []),
      ...this.handlersOfEveryEvent,
    ];
    const results = await Promise.allSettled(handlers.map(async (handler) => handler(event)));
    for (const result of results) {
      if (result.status === "rejected") {
        this.logger.error(`A ${event.constructor.name} handler failed`, stackOf(result.reason));
      }
    }
  }
}

function stackOf(reason: unknown): string {
  return reason instanceof Error ? (reason.stack ?? reason.message) : String(reason);
}
