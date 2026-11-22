import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { TestTargetsChat } from "./test-targets-chat.js";

/** The Project page asked someone to set up the Project's test targets in a new chat Thread. */
export class TestTargetsChatAsked extends DomainEvent {
  constructor(readonly chat: TestTargetsChat) {
    super(chat.askedAt);
  }
}
