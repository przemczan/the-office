import { DomainEvent } from "../../../platform/events/domain-event.js";

/** A template's text was saved or reset to its default; what renders it from now on gets it. */
export class PromptTemplateChanged extends DomainEvent {
  constructor(
    readonly key: string,
    readonly version: number,
  ) {
    super();
  }
}
