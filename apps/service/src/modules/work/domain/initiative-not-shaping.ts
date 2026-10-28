import type { InitiativeState } from "./initiative.js";
import { InitiativeRefused } from "./initiative-refused.js";

/**
 * A change made only while an Initiative is being shaped, asked of one in `state`; refused, with the
 * state kept for whoever decides what to do instead.
 */
export class InitiativeNotShaping extends InitiativeRefused {
  constructor(
    readonly state: Exclude<InitiativeState, "shaping">,
    change: string,
  ) {
    super([`The Initiative is ${state}: ${change} only while it is being shaped.`]);
    this.name = "InitiativeNotShaping";
  }
}
