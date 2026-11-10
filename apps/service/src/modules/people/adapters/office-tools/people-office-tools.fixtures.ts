import { OfficeToolRegistry } from "../../../engine/index.js";
import { PersonRecords } from "../../application/person-records.js";
import type { RoleService, RoleWithAssignments } from "../../application/role-service.js";
import { RoleNotFound } from "../../domain/role-not-found.js";
import { PeopleOfficeTools } from "./people-office-tools.js";

export function toolsOver(roles: RoleWithAssignments[]): PeopleOfficeTools {
  const service: Pick<RoleService, "list" | "read"> = {
    list: () => Promise.resolve(roles),
    read: (key) => {
      const found = roles.find(({ role }) => role.key === key);
      return found ? Promise.resolve(found) : Promise.reject(new RoleNotFound(key));
    },
  };
  const roleService = service as RoleService;
  return new PeopleOfficeTools(
    new OfficeToolRegistry(),
    roleService,
    new PersonRecords(roleService),
  );
}
