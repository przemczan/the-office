import type { OfficeAction } from "@the-office/contracts";
import type { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";

/**
 * The Office tool of a declared Office action (the Office action convention): its name, input and
 * authority from the declaration, and `run` calling the owning module's one handler, as the
 * action's route does. `proposal` makes a call of it draftable as a Proposal: `draft` reads what the
 * call changes now, and `applyFor` carries it out for the user who applies it.
 */
export function officeActionTool<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  run: OfficeTool<Input>["run"],
  proposal?: Pick<OfficeTool<Input>, "draft" | "applyFor">,
): OfficeTool<Input> {
  return {
    name: action.name,
    description: action.description,
    input: action.input,
    authority: {
      group: action.group,
      title: action.title,
      subject: (input) => action.subject(action.input.parse(input)),
    },
    run,
    ...proposal,
  };
}
