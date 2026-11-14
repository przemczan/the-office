import type { Role } from "../domain/role.js";
import type { DutyAssignment } from "./duty-repository.js";

/** Where an Office set-up is kept: its hires and its duties, together (spec §2.2). */
export abstract class OfficeSetupRepository {
  /**
   * Keeps every newly hired Role with its card as version 1 and sets every duty, all of them or
   * none. False, saving nothing, when someone already fills one of the Roles.
   */
  abstract save(
    hired: readonly Role[],
    duties: readonly DutyAssignment[],
    at: Date,
  ): Promise<boolean>;
}
