import type { z } from "zod";
import type {
  OfficeTool,
  OfficeToolDraft,
  OfficeToolRedactedInput,
} from "../../ports/office-tool.js";

/** The Authority group that rules a call giving a secret's value: the trust anchor's cap holds it. */
export const SECRET_VALUES_GROUP = "secretValues";

/** What a module says of the calls of an Office action that can give a secret's value. */
export interface SecretValuesOfCall<Input> {
  /** The names of the secrets this call gives a value for; none when it gives none. It only reads. */
  given(input: Input): Promise<readonly string[]>;
  /** The call with the value of each of these secrets left out, its name kept. */
  without(input: Input, secrets: ReadonlySet<string>): Record<string, unknown>;
  /** What the call as shown (`without`) changes now, as the module drafts any call. */
  draft(shown: Record<string, unknown>): Promise<OfficeToolDraft>;
}

/**
 * The tool of an Office action whose call can give a secret's value (spec 6, the trust anchor): a
 * call that gives one is ruled by Secret values besides the action's own group, the stricter
 * setting winning and never Allowed or Consult; every card, approval and Proposal shows the secret
 * by its name only (`redact`), and the draft names it with no value.
 */
export function withSecretValues<Schema extends z.ZodObject>(
  tool: OfficeTool,
  schema: Schema,
  secrets: SecretValuesOfCall<z.output<Schema>>,
): OfficeTool {
  const withoutValues = async (input: unknown): Promise<OfficeToolRedactedInput> => {
    const call = schema.parse(input);
    const names = new Set(await secrets.given(call));
    return { hasSecret: names.size > 0, shown: secrets.without(call, names) };
  };
  return {
    ...tool,
    ...(tool.authority && {
      authority: {
        ...tool.authority,
        groupsOf: async (input) =>
          (await secrets.given(schema.parse(input))).length > 0 ? [SECRET_VALUES_GROUP] : [],
      },
    }),
    redact: withoutValues,
    // Drafted from the call as shown: the secret named by its field only, never its value.
    draft: async (input) => {
      const call = schema.parse(input);
      const { shown } = await withoutValues(call);
      const drafted = await secrets.draft(shown);
      return {
        ...drafted,
        fields: [
          ...drafted.fields,
          ...(await secrets.given(call)).map((name) => ({
            label: `${name} (Secret value)`,
            before: null,
            after: null,
            form: "secret" as const,
          })),
        ],
      };
    },
  };
}
