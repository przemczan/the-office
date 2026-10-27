import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { Now } from "./now.js";

/** Now or the status strip changed: what needs the user, what runs, or the Office's figures. */
export class NowChanged extends DomainEvent {
  constructor(readonly now: Now) {
    super();
  }
}
