import type { Role } from "../domain/role.js";
import type { DutyAssignment, DutyRepository } from "./duty-repository.js";
import { OfficeSetupRepository } from "./office-setup-repository.js";
import type { RoleRepository } from "./role-repository.js";

/**
 * An Office set-up kept through the test's own repositories, such as `DutyRepositoryForTests`, so
 * no duty stays set on the shared database. All or none as far as the Roles go: a Role filled
 * already saves nothing.
 */
export class OfficeSetupRepositoryForTests extends OfficeSetupRepository {
  constructor(
    private readonly roles: RoleRepository,
    private readonly duties: DutyRepository,
  ) {
    super();
  }

  async save(
    hired: readonly Role[],
    duties: readonly DutyAssignment[],
    at: Date,
  ): Promise<boolean> {
    for (const role of hired) if (await this.roles.find(role.key)) return false;
    for (const role of hired) await this.roles.add(role);
    await this.duties.assignAll(duties, at);
    return true;
  }
}
