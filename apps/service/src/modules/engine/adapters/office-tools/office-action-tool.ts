import type { OfficeAction } from "@the-office/contracts";
import type { z } from "zod";
import type { OfficeTool } from "../../ports/office-tool.js";

/**
 * The Office tool of a declared Office action (the Office action convention): its name, input and
 * authority from the declaration, and `run` calling the owning module's one handler, as the
 * action's route does. `proposal` makes a call of it draftable as a Proposal: `draft` reads what the
 * call changes now, and `applyFor` carries it out for the user who applies it. `floor` makes a call
 * ruled no more freely than Proposal where the module says so (`OfficeToolAuthority.floor`).
 * `groupsOf` adds the groups a call touches besides the action's own (`OfficeToolAuthority.groupsOf`),
 * and `redact` leaves a Secret value out of what cards show (`OfficeTool.redact`).
 */
export function officeActionTool<Input extends z.ZodObject>(
  action: OfficeAction<Input>,
  run: OfficeTool<Input>["run"],
  proposal?: Pick<OfficeTool<Input>, "draft" | "applyFor" | "redact"> & {
    readonly floor?: (input: z.output<Input>) => Promise<"proposal" | undefined>;
    readonly groupsOf?: (input: z.output<Input>) => Promise<readonly string[]>;
  },
): OfficeTool<Input> {
  const { floor, groupsOf, ...drafting } = proposal ?? {};
  return {
    name: action.name,
    area: action.area,
    description: action.description,
    input: action.input,
    authority: {
      group: action.group,
      ...(action.onOwnWork && { onOwnWork: action.onOwnWork }),
      title: action.title,
      subject: (input) => action.subject(action.input.parse(input)),
      ...(floor && { floor: (input: unknown) => floor(action.input.parse(input)) }),
      ...(groupsOf && { groupsOf: (input: unknown) => groupsOf(action.input.parse(input)) }),
    },
    run,
    ...drafting,
  };
}
