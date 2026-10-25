import { Injectable } from "@nestjs/common";
import type { WebEvent } from "@the-office/contracts";
import type { DomainEvent, DomainEventClass } from "../events/domain-event.js";

/** Maps a domain event to the contract event the web receives; occurredAt is filled in. */
export type ToWebEvent<Event extends DomainEvent> = (event: Event) => Omit<WebEvent, "occurredAt">;

/**
 * Which domain events reach the web, and as what. A module registers its own events from its
 * WebSocket adapter; events nobody registers stay inside the service.
 */
@Injectable()
export class WebEventForwarding {
  private readonly mappings = new Map<DomainEventClass, ToWebEvent<DomainEvent>>();

  forward<Event extends DomainEvent>(
    eventClass: DomainEventClass<Event>,
    toWebEvent: ToWebEvent<Event>,
  ): void {
    if (this.mappings.has(eventClass)) {
      throw new Error(`${eventClass.name} is already forwarded to the web.`);
    }
    // Safe: toWebEvent below only passes this mapping events whose constructor is eventClass.
    this.mappings.set(eventClass, toWebEvent as ToWebEvent<DomainEvent>);
  }

  toWebEvent(event: DomainEvent): WebEvent | undefined {
    const toWebEvent = this.mappings.get(event.constructor as DomainEventClass);
    return toWebEvent && { ...toWebEvent(event), occurredAt: event.occurredAt.toISOString() };
  }
}
