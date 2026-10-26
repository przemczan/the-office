import type { RunPermission } from "../domain/allowed-commands.js";

/** A person who fills a Role, as an Agent Stage needs them. */
export interface KnownPerson {
  readonly card: {
    readonly name: string;
    readonly permissionProfile: {
      readonly edit: boolean;
      readonly run: RunPermission;
      readonly web: boolean;
    };
  };
}

/** The people who work Agent Stages, whom the People module keeps; the composition root binds it. */
export abstract class KnownPeople {
  /** Undefined when nobody fills the Role. */
  abstract find(roleKey: string): Promise<KnownPerson | undefined>;
}
