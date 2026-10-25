/**
 * A state change a module announces (spec §5.3). Each module's domain layer defines one subclass per
 * kind of change; subscribers name the subclass they want, importing another module's events from
 * its index.ts (apps/service/README.md).
 */
export abstract class DomainEvent {
  constructor(readonly occurredAt: Date = new Date()) {}
}

export type DomainEventClass<Event extends DomainEvent = DomainEvent> = abstract new (
  ...args: never[]
) => Event;
