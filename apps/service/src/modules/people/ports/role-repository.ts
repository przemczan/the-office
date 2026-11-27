import type { HardSwitches } from "../domain/hard-switches.js";
import type { Role, RoleCardVersion } from "../domain/role.js";
import type { EarlierEngineFields, RoleChange } from "../domain/role-changes.js";
import type {
  RoleAvatarChanged,
  RoleCardChanged,
  RoleHiredBack,
  RoleLetGo,
} from "../domain/role-events.js";

/** The Role after a change, with its event, or undefined when nothing changed. */
export interface RoleUpdate<Event = RoleCardChanged> {
  readonly role: Role;
  readonly event: Event | undefined;
}

/** Where Roles are kept, with every version of each card. */
export abstract class RoleRepository {
  /**
   * Keeps a newly hired Role with its card as version 1. False when someone already fills the
   * Role, which then stays as it was.
   */
  abstract add(role: Role): Promise<boolean>;

  abstract find(key: string): Promise<Role | undefined>;

  /** Every Role, in the order they were hired. */
  abstract list(): Promise<readonly Role[]>;

  /**
   * Applies `change` to the Role as stored, holding it against other changes until the new card
   * version is saved with its changes, so two changes at once never lose one. Saves nothing when
   * `change` returns undefined; throws RoleNotFound when nobody fills the Role.
   */
  abstract update(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate>;

  /**
   * The keys of every Role whose current card version is from before `engineSettings`, people let
   * go and the Caretaker included, in the order they were hired.
   */
  abstract rolesToMoveOver(): Promise<readonly string[]>;

  /**
   * Applies `change` to the Role as stored with the earlier fields its current card version keeps,
   * holding it against other changes, and saves the new card version, carrying those fields forward
   * unread. Saves nothing when the version already has `engineSettings`, moved over meanwhile;
   * throws RoleNotFound when the Role was never hired.
   */
  abstract moveOver(
    key: string,
    change: (role: Role, earlier: EarlierEngineFields) => RoleChange<RoleCardChanged>,
  ): Promise<RoleUpdate>;

  /**
   * The keys of every Role whose current card version is from before Authority, saved with Hard
   * switches only, people let go and the Caretaker included, in the order they were hired.
   */
  abstract rolesToMoveAuthorityOver(): Promise<readonly string[]>;

  /**
   * Applies `change` to the Role as stored with the Hard switches its current card version keeps (a
   * missing Change Project settings read as Ask me), holding it against other changes, and saves
   * the new card version. Saves nothing when the version already has an Authority, moved over
   * meanwhile; throws RoleNotFound when the Role was never hired.
   */
  abstract moveAuthorityOver(
    key: string,
    change: (role: Role, switches: HardSwitches) => RoleChange<RoleCardChanged>,
  ): Promise<RoleUpdate>;

  /**
   * The keys of every Role the second Authority move-over hasn't given its duties' jobs yet, people
   * let go included, in the order they were hired. A Role hired since is never among them.
   */
  abstract rolesToGiveDutiesJobs(): Promise<readonly string[]>;

  /**
   * Applies `change` to the Role as stored, holding it against other changes, saves the new card
   * version when it returns one, and marks the Role given, so it is never among
   * `rolesToGiveDutiesJobs` again. Saves nothing when it was given meanwhile; throws RoleNotFound
   * when the Role was never hired.
   */
  abstract giveDutiesJobs(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate>;

  /**
   * The keys of every Role whose current card version still holds a row of the retired
   * `propose_project_commands`, `propose_test_targets` or `propose_actions` tools at Proposal, in the
   * order they were hired.
   */
  abstract rolesWithRetiredProposalRows(): Promise<readonly string[]>;

  /**
   * Applies `change` to the Role as stored, holding it against other changes, when its current card
   * version still holds such a row, and saves the new card version, which holds none. Saves nothing
   * when `change` returns undefined or the rows are gone meanwhile; throws RoleNotFound when the
   * Role was never hired.
   */
  abstract moveProjectSettingProposalsOver(
    key: string,
    change: (role: Role) => RoleChange<RoleCardChanged> | undefined,
  ): Promise<RoleUpdate>;

  /**
   * Applies `change`, which lets the person go or hires them back, to the Role as stored, holding
   * it against other changes. Throws RoleNotFound when the Role was never hired.
   */
  abstract changeStanding<Event extends RoleLetGo | RoleHiredBack>(
    key: string,
    change: (role: Role) => RoleChange<Event>,
  ): Promise<RoleChange<Event>>;

  /**
   * Applies `change` to the Role as stored, holding it against other changes, with no new card
   * version. Saves nothing when `change` returns undefined; throws RoleNotFound when the Role was
   * never hired.
   */
  abstract changeAvatar(
    key: string,
    change: (role: Role) => RoleChange<RoleAvatarChanged> | undefined,
  ): Promise<RoleUpdate<RoleAvatarChanged>>;

  /** Undefined when the Role has no such version. */
  abstract version(key: string, version: number): Promise<RoleCardVersion | undefined>;

  /** Every version of the Role's card, newest first. */
  abstract versions(key: string): Promise<readonly RoleCardVersion[]>;
}
