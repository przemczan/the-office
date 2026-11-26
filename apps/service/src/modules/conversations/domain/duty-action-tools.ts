import type { HeldDuties } from "./session-instructions.js";

/**
 * The Office actions' tools a duty's holder is offered beside their Authority, as they were before
 * Authority ruled every call. Spec 6 keeps them until "People and Memory for Agents" stops duties
 * granting tools, so a holder whose row says Never keeps their reach.
 */
const DUTY_ACTION_TOOLS: Readonly<Record<string, readonly string[]>> = {
  "shapes-initiatives": [
    "add_dependency",
    "remove_dependency",
    "add_to_initiative",
    "take_out_of_initiative",
  ],
  plans: ["add_dependency", "remove_dependency", "add_to_initiative", "take_out_of_initiative"],
  "onboards-projects": ["rerun_ci_run", "start_workflow"],
};

/** The Office actions' tools the held duties grant, by name. */
export function dutyActionTools(held: HeldDuties): ReadonlySet<string> {
  return new Set(held.flatMap((duty) => DUTY_ACTION_TOOLS[duty] ?? []));
}
