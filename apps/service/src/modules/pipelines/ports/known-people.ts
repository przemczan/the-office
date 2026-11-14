import type { RunPermission } from "../domain/allowed-commands.js";
import type { FollowedHardSwitches } from "../domain/followed-hard-switches.js";
import type { HardSwitchOnCard, StagePermissions } from "../domain/stage-permissions.js";

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
  /** Where an MCP tool the card leaves unset stands, as read now. */
  readonly mcpToolDefault: HardSwitchOnCard;
}

/** The people who work Agent Stages, whom the People module keeps; the composition root binds it. */
export abstract class KnownPeople {
  /** Undefined when nobody fills the Role. */
  abstract find(roleKey: string): Promise<KnownPerson | undefined>;

  /** The person let go from the Role, so a flag can tell that from a Role nobody was ever hired for. */
  abstract findLetGo(roleKey: string): Promise<{ readonly name: string } | undefined>;

  /** The Role's title, such as Devops, whether or not anyone fills it. */
  abstract roleTitle(roleKey: string): string;

  /** The key of the hired Role holding the duty keyed `duty`; undefined while nobody does. */
  abstract holderOf(duty: string): Promise<string | undefined>;

  /**
   * The key of the Role the duty keyed `duty` names, hired or not, so a flag can name a holder let
   * go; undefined while it is set to none.
   */
  abstract dutyRoleKey(duty: string): Promise<string | undefined>;

  /**
   * Why a Stage's narrowing of the Role's profile can't stand, in the UI's words; empty when it
   * can, or when nobody fills the Role.
   */
  abstract permissionNarrowingProblems(
    roleKey: string,
    narrowing: StagePermissions,
  ): Promise<string[]>;
}
