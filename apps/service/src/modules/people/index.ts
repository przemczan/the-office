export { RoleCards, type Consultant, type SessionRole } from "./application/role-cards.js";
export { RoleService } from "./application/role-service.js";
export { MemoryService } from "./application/memory-service.js";
export { RoleCardChanged, RoleHired, RoleHiredBack, RoleLetGo } from "./domain/role-events.js";
export {
  hardSwitchInEffect,
  HARD_SWITCH_LABELS,
  type HardSwitchKey,
  type HardSwitchValue,
} from "./domain/hard-switches.js";
export { CTO, OFFICE_MANAGER } from "./domain/known-roles.js";
export type { RoleCard } from "./domain/role-card.js";
export { RoleNotFound } from "./domain/role-not-found.js";
export { RoleRefused } from "./domain/role-refused.js";
export { PeopleModule } from "./people.module.js";
