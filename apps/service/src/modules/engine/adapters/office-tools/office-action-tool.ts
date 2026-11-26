import type { OfficeAction } from "@the-office/contracts";
import type { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";

/**
 * The Office tool of a declared Office action (the Office action convention): its name, input and
 * authority from the declaration, and `run` calling the owning module's one handler, as the
 * action's route does.
 */
export function officeActionTool<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  run: OfficeTool<Input>["run"],
): OfficeTool<Input> {
  return {
    name: action.name,
    description: action.description,
    input: action.input,
    authority: {
      group: action.group,
      subject: (input) => action.subject(action.input.parse(input)),
    },
    run,
  };
}
