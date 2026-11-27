import { z } from "zod";
import { CORE_AREA, type OfficeTool, type OfficeToolResult } from "../ports/office-tool.js";

export const LIST_OFFICE_TOOLS = "list_office_tools";
export const CALL_OFFICE_TOOL = "call_office_tool";

const listInput = z.object({
  area: z
    .string()
    .optional()
    .describe("Only the tools of this area; every area you aren't loaded with when left out."),
});

const callInput = z.object({
  name: z.string().describe("The tool's name, as list_office_tools gives it."),
  input: z
    .record(z.string(), z.unknown())
    .default({})
    .describe("The tool's input, as its schema from list_office_tools says."),
});

/**
 * `list_office_tools` and `call_office_tool`, which reach the Office tools an engine without tool
 * search doesn't load (spec 5.4.1 › Loading by area). `reachable` are the session's tools already
 * ruled, tools ruled Never left out before, so the pair names no tool but those the session may
 * call and refuses any other name as an unknown tool. The pair itself is unruled: only the inner
 * call is, by the one ruling step each wrapped tool carries, so the ruling, the approval and the
 * History name the real action and nothing is held twice.
 */
export function officeToolPair(reachable: readonly OfficeTool[]): readonly OfficeTool[] {
  const byName = new Map(reachable.map((tool) => [tool.name, tool]));
  const list: OfficeTool<typeof listInput> = {
    name: LIST_OFFICE_TOOLS,
    area: CORE_AREA,
    description:
      "Lists the Office tools of other areas that you can call with call_office_tool, each with its description and input schema.",
    input: listInput,
    run: ({ area }) =>
      Promise.resolve(
        answer(
          JSON.stringify(
            reachable
              .filter((tool) => area === undefined || tool.area === area)
              .map(({ name, area: toolArea, description, input }) => ({
                name,
                area: toolArea,
                description,
                inputSchema: inputSchemaOf(input),
              })),
            null,
            2,
          ),
        ),
      ),
  };
  const call: OfficeTool<typeof callInput> = {
    name: CALL_OFFICE_TOOL,
    area: CORE_AREA,
    description:
      "Calls an Office tool listed by list_office_tools, with its input; it is ruled as if you called it directly.",
    input: callInput,
    async run({ name, input }, officeToolCall) {
      const tool = byName.get(name);
      if (tool === undefined) return failure(`No Office tool is registered as ${name}.`);
      const parsed = tool.input.safeParse(input);
      if (!parsed.success) {
        return failure(`The input of ${name} is not valid: ${z.prettifyError(parsed.error)}`);
      }
      return tool.run(parsed.data, officeToolCall);
    },
  };
  return [list, call];
}

function inputSchemaOf(input: z.ZodObject): Record<string, unknown> {
  const { $schema: _schema, ...schema } = z.toJSONSchema(input, { io: "input" });
  return schema;
}

function answer(text: string): OfficeToolResult {
  return { text, isError: false };
}

function failure(text: string): OfficeToolResult {
  return { text, isError: true };
}
