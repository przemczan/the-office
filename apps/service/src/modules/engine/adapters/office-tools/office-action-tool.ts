import type { OfficeAction } from "@the-office/contracts";
import type { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";

/**
 * What every Office action's tool tells the Agent besides its own description: it changes the
 * record at once, so the person's Role authority (and the Hard switches) gate it, never a Proposal.
 */
export const FOLLOW_YOUR_AUTHORITY =
  "It changes the record straight away, as the user's own click does, with no Proposal: act alone only where your Role's authority lets you decide alone; where it says to consult someone first, consult them, and where it says to ask the user, ask them first (with a Decision where you can open one, otherwise in your answer) and act once they agree.";

/**
 * The Office tool of a declared Office action (the Office action convention): its name, input and
 * covering duties from the declaration, and `run` calling the owning module's one handler, as the
 * action's route does.
 */
export function officeActionTool<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  run: OfficeTool<Input>["run"],
): OfficeTool<Input> {
  return {
    name: action.name,
    description: `${action.description} ${FOLLOW_YOUR_AUTHORITY}`,
    input: action.input,
    coveredBy: action.duties,
    run,
  };
}
