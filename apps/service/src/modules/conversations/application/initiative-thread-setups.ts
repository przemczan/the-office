import { Injectable } from "@nestjs/common";

/** A Thread on an Initiative, as the module keeping Initiatives sets its session up. */
export interface InitiativeThreadRequest {
  readonly threadId: string;
  readonly initiativeId: string;
  /** Who answers in it, by the key of the Role they fill. */
  readonly roleKey: string;
}

/**
 * What a session of a Thread on an Initiative works with, from the Initiative's record. An
 * Initiative spans Projects, so the session reads every Project's base branch, as a chat does.
 */
export interface InitiativeThreadSetup {
  /**
   * What the person does in the Thread, shaping the Initiative, added to their standing
   * instructions. The same for every session of the Thread, so it stays in the cached prefix.
   */
  readonly instructions: string;
  readonly officeTools: readonly string[];
  /** The Initiative's record as a new session picks it up (spec §2.5): never a transcript. */
  readonly record: string;
}

/** Sets up the sessions of Threads on Initiatives. */
export interface InitiativeThreadSource {
  setUp(thread: InitiativeThreadRequest): Promise<InitiativeThreadSetup>;
}

/**
 * Where the module keeping Initiatives gives Conversations what a Thread on one works with,
 * registering as it starts for the same reason as TaskThreadSetups.
 */
@Injectable()
export class InitiativeThreadSetups {
  private source: InitiativeThreadSource | undefined;

  provide(source: InitiativeThreadSource): void {
    if (this.source) throw new Error("Threads on Initiatives are set up by one module only.");
    this.source = source;
  }

  /** Asked as each session starts, after every module has registered. */
  async of(thread: InitiativeThreadRequest): Promise<InitiativeThreadSetup> {
    if (!this.source) throw new Error("No module sets up the sessions of Threads on Initiatives.");
    return this.source.setUp(thread);
  }
}
