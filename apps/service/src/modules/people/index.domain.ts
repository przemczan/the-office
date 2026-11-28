/**
 * The domain entry of the module: the pure values and rules of its domain other modules' domain
 * layers use. It re-exports only its own `domain/`, so importing it loads no Nest module, no port
 * and no adapter (apps/service/docs/module-template.md). Everything here is in `index.ts` too.
 */
export {
  authorityWithHardSwitches,
  heldToCap,
  isAuthorityGroup,
  type Authority,
  type AuthorityGroup,
  type AuthorityInEffect,
  type AuthoritySetting,
  type AuthorityValue,
} from "./domain/authority.js";
export { DUTIES, type DutyKey } from "./domain/duties.js";
export { ASK_ME, type HardSwitches, type HardSwitchValue } from "./domain/hard-switches.js";
export { CARETAKER } from "./domain/known-roles.js";
export type { SetUpDuty, SetUpHire } from "./domain/office-setup.js";
export type { RoleCard } from "./domain/role-card.js";
