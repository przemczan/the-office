import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { DutyKey } from "./duties.js";

/**
 * The user set a duty to another Role, or to none: the values it names, each a Role key (the
 * default while never set) or `null` for none, hired or not. Hiring, letting go and hiring back change who holds a duty in effect
 * without this event, so a subscriber that cares hears `RoleHired`, `RoleLetGo` and
 * `RoleHiredBack` too.
 */
export class DutyHolderChanged extends DomainEvent {
  constructor(
    readonly duty: DutyKey,
    readonly from: string | null,
    readonly to: string | null,
    changedAt: Date,
  ) {
    super(changedAt);
  }
}
