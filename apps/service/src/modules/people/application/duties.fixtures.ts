import { EventBus } from "../../../platform/events/event-bus.js";
import type { Role } from "../domain/role.js";
import { DutyRepositoryForTests } from "../ports/duty-repository.fixtures.js";
import type { RoleRepository } from "../ports/role-repository.js";
import { Duties } from "./duties.js";
import { DutyChangeChecks } from "./duty-change-checks.js";

/** Duties over `roles` as they are, none set until the test sets one on `repository`. */
export function dutiesOver(
  roles: readonly Role[],
  repository = new DutyRepositoryForTests(),
  events = new EventBus(),
  checks = new DutyChangeChecks(),
): Duties {
  const people: Pick<RoleRepository, "list"> = { list: () => Promise.resolve(roles) };
  return new Duties(repository, people as RoleRepository, checks, events);
}
