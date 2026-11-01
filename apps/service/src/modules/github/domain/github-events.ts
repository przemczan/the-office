import { DomainEvent } from "../../../platform/events/domain-event.js";
import type { SignedOutReason } from "./sign-in.js";

/** The GitHub App was registered by its manifest, replacing any registered before. */
export class GitHubAppRegistered extends DomainEvent {
  constructor(
    readonly slug: string,
    readonly owner: string,
  ) {
    super();
  }
}

/** The user authorized the App on GitHub, and The Office keeps their token. */
export class GitHubSignedIn extends DomainEvent {
  constructor(readonly login: string) {
    super();
  }
}

/** The user is signed out: by the user when there is no reason, otherwise by The Office, saying why. */
export class GitHubSignedOut extends DomainEvent {
  constructor(readonly reason: SignedOutReason | undefined) {
    super();
  }
}
