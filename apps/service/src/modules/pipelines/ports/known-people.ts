import type { RunPermission } from "../domain/allowed-commands.js";
import type { FollowedHardSwitches } from "../domain/followed-hard-switches.js";
import type { HardSwitchOnCard } from "../domain/stage-permissions.js";

/** A person who fills a Role, as an Agent Stage needs them. */
export interface KnownPerson {
  readonly card: {
    readonly name: string;
    /** "none" when the person only talks and no Pipeline may name the Role (spec §2.2). */
    readonly taskLimit: number | "none";
    readonly permissionProfile: {
      readonly edit: boolean;
      readonly run: RunPermission;
      readonly web: boolean;
      /** The MCP tools the user set, keyed `server/tool`; any other is at the default. */
      readonly mcpTools: Readonly<Record<string, HardSwitchOnCard>>;
    };
    readonly hardSwitches: Readonly<Record<keyof FollowedHardSwitches, HardSwitchOnCard>>;
  };
}

/** The people who work Agent Stages, whom the People module keeps; the composition root binds it. */
export abstract class KnownPeople {
  /** Undefined when nobody fills the Role. */
  abstract find(roleKey: string): Promise<KnownPerson | undefined>;

  /** The person let go from the Role, so a flag can tell that from a Role nobody was ever hired for. */
  abstract findLetGo(roleKey: string): Promise<{ readonly name: string } | undefined>;

  /** The Role's title, such as Devops, whether or not anyone fills it. */
  abstract roleTitle(roleKey: string): string;
}
