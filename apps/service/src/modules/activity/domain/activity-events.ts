import { DomainEvent } from "../../../platform/events/domain-event.js";

/**
 * Something Activity lists may have changed, or a user marked items seen. It carries nothing: what
 * was seen differs per user, so each reads Activity again.
 */
export class ActivityChanged extends DomainEvent {}
