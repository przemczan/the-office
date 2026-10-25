import { isAbsolute } from "node:path";
import { z } from "zod";
import { InvalidOfficeConfigError, type ConfigProblem } from "./invalid-office-config-error.js";

export interface OfficeConfig {
  readonly databaseUrl: string;
  readonly officeDataDirectory: string;
}

/** Values that depend on the operating system, supplied by the platform layer. */
export interface OfficeConfigDefaults {
  officeDataDirectory(): string;
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const REQUIRED = "is required";

// An env file copied with a value left blank yields "", which means "not set", not "invalid".
function blankAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const environmentSchema = z.object({
  DATABASE_URL: z.preprocess(
    blankAsUnset,
    z.url({
      protocol: /^postgres(ql)?$/,
      error: (issue) =>
        issue.input === undefined ? REQUIRED : "must be a postgres:// or postgresql:// URL",
    }),
  ),
  OFFICE_DATA_DIR: z.preprocess(
    blankAsUnset,
    z.string().refine(isAbsolute, "must be an absolute path").optional(),
  ),
});

/**
 * Reads The Office's config from environment variables.
 * Throws InvalidOfficeConfigError naming every missing or invalid variable, so the service refuses to start.
 */
export function readOfficeConfig(
  environment: EnvironmentVariables,
  defaults: OfficeConfigDefaults,
): OfficeConfig {
  const result = environmentSchema.safeParse(environment);
  if (!result.success) {
    throw new InvalidOfficeConfigError(result.error.issues.map(toConfigProblem));
  }
  return {
    databaseUrl: result.data.DATABASE_URL,
    officeDataDirectory: result.data.OFFICE_DATA_DIR ?? defaults.officeDataDirectory(),
  };
}

function toConfigProblem(issue: z.core.$ZodIssue): ConfigProblem {
  return { variable: String(issue.path[0]), problem: issue.message };
}
