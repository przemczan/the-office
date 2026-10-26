import type { RunPermission } from "../domain/allowed-commands.js";
import type { FollowedHardSwitches } from "../domain/followed-hard-switches.js";

/** A followed Hard switch's value as the Role card keeps it: Consult names a Role by its key. */
export type HardSwitchOnCard =
  | { readonly kind: "allowed" }
  | { readonly kind: "consult"; readonly role: string }
  | { readonly kind: "ask-me" }
  | { readonly kind: "never" };

/** A person who fills a Role, as an Agent Stage needs them. */
export interface KnownPerson {
  readonly card: {
    readonly name: string;
    readonly permissionProfile: {
      readonly edit: boolean;
      readonly run: RunPermission;
      readonly web: boolean;
    };
    readonly hardSwitches: Readonly<Record<keyof FollowedHardSwitches, HardSwitchOnCard>>;
  };
}

/** The people who work Agent Stages, whom the People module keeps; the composition root binds it. */
export abstract class KnownPeople {
  /** Undefined when nobody fills the Role. */
  abstract find(roleKey: string): Promise<KnownPerson | undefined>;

  /** The Role's title, such as Devops, whether or not anyone fills it. */
  abstract roleTitle(roleKey: string): string;
}
