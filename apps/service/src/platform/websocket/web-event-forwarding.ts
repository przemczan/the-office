import { Injectable } from "@nestjs/common";
import type { WebEvent } from "@the-office/contracts";
import type { DomainEvent, DomainEventClass } from "../events/domain-event.js";

/**
 * Maps a domain event to the contract event the web receives; occurredAt is filled in. Undefined
 * keeps this one inside the service.
 */
export type ToWebEvent<Event extends DomainEvent> = (
  event: Event,
) => Omit<WebEvent, "occurredAt"> | undefined;

/**
 * Which domain events reach the web, and as what. A module registers its own events from its
 * WebSocket adapter; events nobody registers stay inside the service.
 */
@Injectable()
export class WebEventForwarding {
  private readonly mappings = new Map<DomainEventClass, Mapping<DomainEvent>>();

  /** Sends each event to every signed-in user's connections subscribed to its type. */
  forward<Event extends DomainEvent>(
    eventClass: DomainEventClass<Event>,
    toWebEvent: ToWebEvent<Event>,
  ): void {
    this.register(eventClass, { toWebEvent, recipientOf: undefined });
  }

  /** Sends each event only to the connections of the one user `recipientOf` names. */
  forwardToUser<Event extends DomainEvent>(
    eventClass: DomainEventClass<Event>,
    recipientOf: (event: Event) => string,
    toWebEvent: ToWebEvent<Event>,
  ): void {
    this.register(eventClass, { toWebEvent, recipientOf });
  }

  toWebEvent(event: DomainEvent): WebEvent | undefined {
    const webEvent = this.mappingOf(event)?.toWebEvent(event);
    return webEvent && { ...webEvent, occurredAt: event.occurredAt.toISOString() };
  }

  /** The user the event is for alone, by id; undefined when it goes to every user. */
  recipientOf(event: DomainEvent): string | undefined {
    return this.mappingOf(event)?.recipientOf?.(event);
  }

  private register<Event extends DomainEvent>(
    eventClass: DomainEventClass<Event>,
    mapping: Mapping<Event>,
  ): void {
    if (this.mappings.has(eventClass)) {
      throw new Error(`${eventClass.name} is already forwarded to the web.`);
    }
    // Safe: mappingOf below only passes this mapping events whose constructor is eventClass.
    this.mappings.set(eventClass, mapping as unknown as Mapping<DomainEvent>);
  }

  private mappingOf(event: DomainEvent): Mapping<DomainEvent> | undefined {
    return this.mappings.get(event.constructor as DomainEventClass);
  }
}

interface Mapping<Event extends DomainEvent> {
  readonly toWebEvent: ToWebEvent<Event>;
  readonly recipientOf: ((event: Event) => string) | undefined;
}
