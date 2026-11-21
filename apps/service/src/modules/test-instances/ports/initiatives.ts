/** An Initiative as its test instances need it: its state, and its branch in each Project. */
export interface InitiativeForTestInstances {
  readonly id: string;
  readonly name: string;
  readonly state: "shaping" | "active" | "done" | "dropped";
  /** When it moved to Done or Dropped; undefined while it hasn't. */
  readonly endedAt: Date | undefined;
  /** The Projects The Office made its branch in, each with the branch's name. */
  readonly branches: readonly { readonly projectId: string; readonly branch: string }[];
}

/** Work's Initiatives; bound to an adapter over Work's application service. */
export abstract class Initiatives {
  /** The Initiative; undefined when there is none by that id. */
  abstract find(id: string): Promise<InitiativeForTestInstances | undefined>;
}
