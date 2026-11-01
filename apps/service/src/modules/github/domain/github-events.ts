import { DomainEvent } from "../../../platform/events/domain-event.js";

/** The GitHub App was registered by its manifest, replacing any registered before. */
export class GitHubAppRegistered extends DomainEvent {
  constructor(
    readonly slug: string,
    readonly owner: string,
  ) {
    super();
  }
}
