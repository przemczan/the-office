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
