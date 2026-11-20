import { z } from "zod";
import { taskStateSchema } from "./work.js";

/**
 * A key a test target may take: lower-case letters, digits and `-`, starting with a letter, at most
 * 40 characters, as a Project command's (spec §2.12, "Test target"); fixed once added.
 */
export const testTargetKeySchema = z
  .string()
  .max(40, "A test target's key may be at most 40 characters.")
  .regex(
    /^[a-z][a-z0-9-]*$/,
    `A test target's key is lower-case letters, digits and "-", starting with a letter.`,
  );

/** The kinds a test target may be; only the first two are built (spec §2.12, "Kinds"). */
export const testTargetKindSchema = z.enum([
  "hosted",
  "build-to-install",
  "install-on-a-device",
  "deployed-elsewhere",
]);
export type TestTargetKind = z.infer<typeof testTargetKindSchema>;

/** Arguments given to an entry point one by one, never read by a shell. */
const entryPointArgumentsSchema = z.array(z.string());

/**
 * One of the repository's own entry points (spec §2.12, "Entry points only"). Each is structured,
 * so inline shell can't be expressed.
 */
export const entryPointSchema = z.discriminatedUnion("kind", [
  /** A file in the repository, by its path from the root, such as `scripts/start-test.sh`. */
  z.object({
    kind: z.literal("repository-file"),
    path: z.string(),
    arguments: entryPointArgumentsSchema,
  }),
  /** A script named in a package manifest's `scripts`, by the manifest's path from the root. */
  z.object({
    kind: z.literal("package-script"),
    manifest: z.string(),
    script: z.string(),
    arguments: entryPointArgumentsSchema,
  }),
  /** A Gradle task, run through the repository's wrapper, `./gradlew`. */
  z.object({
    kind: z.literal("gradle-task"),
    task: z.string(),
    arguments: entryPointArgumentsSchema,
  }),
  /** A service of the repository's `.devcontainer/` (Hosted only). */
  z.object({ kind: z.literal("devcontainer-service"), service: z.string() }),
]);
export type EntryPoint = z.infer<typeof entryPointSchema>;
export type EntryPointKind = EntryPoint["kind"];

/** A plain variable of a test target, shown and saved with its value. */
export const testTargetVariableSchema = z.object({ name: z.string(), value: z.string() });
export type TestTargetVariable = z.infer<typeof testTargetVariableSchema>;

/** A test target's Secret variable as answered: its value never leaves the service. */
export const shownTestTargetSecretSchema = z.object({ name: z.string(), valueSet: z.boolean() });
export type ShownTestTargetSecret = z.infer<typeof shownTestTargetSecretSchema>;

/** A test target's Secret variable as saved: without a value, or with an empty one, it keeps its own. */
export const editedTestTargetSecretSchema = z.object({
  name: z.string(),
  value: z.string().optional(),
});
export type EditedTestTargetSecret = z.infer<typeof editedTestTargetSecretSchema>;

/** The fields of a test target that each record who set them last. */
export const testTargetFieldSchema = z.enum([
  "name",
  "kind",
  "entryPoint",
  "port",
  "outputPatterns",
  "variables",
  "secretVariables",
]);
export type TestTargetField = z.infer<typeof testTargetFieldSchema>;

/** Who set a field last: a user on the Project page, or a Proposal an Agent drafted. */
export const testTargetSetterSchema = z.discriminatedUnion("by", [
  z.object({ by: z.literal("user"), user: z.object({ userId: z.string(), name: z.string() }) }),
  z.object({
    by: z.literal("proposal"),
    proposalId: z.string(),
    agent: z.object({ roleKey: z.string(), name: z.string() }),
  }),
]);
export type TestTargetSetter = z.infer<typeof testTargetSetterSchema>;

/** Who set each field last; a field missing was never set by anyone known. */
export const testTargetSetBySchema = z.partialRecord(testTargetFieldSchema, testTargetSetterSchema);
export type TestTargetSetBy = z.infer<typeof testTargetSetBySchema>;

/**
 * A test target's fields for its kind, with its Secret variables in the given form (by name with
 * whether a value is set when answered, with an optional value when saved, by name alone when
 * proposed) and the `extra` fields every kind has. The outlined kinds take a Hosted's fields, so
 * they can be named and refused in words.
 */
function testTargetOfKind<Secret extends z.ZodType, Extra extends z.ZodRawShape>(
  secret: Secret,
  extra: Extra,
) {
  const head = { key: z.string(), name: z.string(), ...extra };
  const hostedFields = {
    entryPoint: entryPointSchema,
    port: z.number().int(),
    variables: z.array(testTargetVariableSchema),
    secretVariables: z.array(secret),
  };
  return z.discriminatedUnion("kind", [
    z.object({ ...head, kind: z.literal("hosted"), ...hostedFields }),
    z.object({
      ...head,
      kind: z.literal("build-to-install"),
      entryPoint: entryPointSchema,
      /** Paths relative to the repository's root, `*` and `**` allowed. */
      outputPatterns: z.array(z.string()),
      variables: z.array(testTargetVariableSchema),
      secretVariables: z.array(secret),
    }),
    z.object({ ...head, kind: z.literal("install-on-a-device"), ...hostedFields }),
    z.object({ ...head, kind: z.literal("deployed-elsewhere"), ...hostedFields }),
  ]);
}

/** A test target as the service answers it (GET /projects/:id/test-targets). */
export const testTargetSchema = testTargetOfKind(shownTestTargetSecretSchema, {
  setBy: testTargetSetBySchema,
});
export type TestTarget = z.infer<typeof testTargetSchema>;

/** GET /projects/:id/test-targets: the Project's test targets, in the order added. */
export const testTargetListSchema = z.object({ targets: z.array(testTargetSchema) });
export type TestTargetList = z.infer<typeof testTargetListSchema>;

/** A test target as the Project page saves it. */
export const editedTestTargetSchema = testTargetOfKind(editedTestTargetSecretSchema, {});
export type EditedTestTarget = z.infer<typeof editedTestTargetSchema>;

/**
 * PUT /projects/:id/test-targets: the Project's test targets, whole and in order. A target left out
 * is removed; a Secret variable sent without a value keeps the one stored under its name.
 */
export const testTargetsEditSchema = z.object({ targets: z.array(editedTestTargetSchema) });
export type TestTargetsEdit = z.infer<typeof testTargetsEditSchema>;

/** A test target's fields as a Proposal carries them: Secret variables by name alone. */
export const proposedTestTargetFieldsSchema = testTargetOfKind(z.string(), {});
export type ProposedTestTargetFields = z.infer<typeof proposedTestTargetFieldsSchema>;

/**
 * What a Proposal of test targets changes (spec §2.12, "Writing test targets"), by key: each target
 * as the Project had it when drafted (`from`, null for one added) and as proposed (`to`, null for
 * one removed). `userSet` names the fields the user set that it changes, each one the Agent named
 * on purpose, flagged "You set this". Applying is refused once a `from` no longer holds.
 */
export const proposedTestTargetsSchema = z.object({
  targets: z.array(
    z.object({
      key: z.string(),
      from: proposedTestTargetFieldsSchema.nullable(),
      to: proposedTestTargetFieldsSchema.nullable(),
      userSet: z.array(testTargetFieldSchema),
    }),
  ),
});
export type ProposedTestTargets = z.infer<typeof proposedTestTargetsSchema>;
export type ProposedTestTarget = ProposedTestTargets["targets"][number];

/** A Project's open "Set up test targets" Task (spec §2.12, "Set up test targets"). */
export const testTargetsSetUpTaskSchema = z.object({
  id: z.string(),
  title: z.string(),
  state: taskStateSchema,
});
export type TestTargetsSetUpTask = z.infer<typeof testTargetsSetUpTaskSchema>;

/**
 * GET /projects/:id/test-targets/set-up-task, and what POST /projects/:id/test-targets/set-up
 * answers: the Project's open "Set up test targets" Task, null when it has none.
 */
export const testTargetsSetUpSchema = z.object({
  setUpTask: testTargetsSetUpTaskSchema.nullable(),
});
export type TestTargetsSetUp = z.infer<typeof testTargetsSetUpSchema>;
