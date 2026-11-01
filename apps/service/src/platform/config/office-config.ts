import { isAbsolute } from "node:path";
import { z } from "zod";
import { InvalidOfficeConfigError, type ConfigProblem } from "./invalid-office-config-error.js";

export interface OfficeConfig {
  /** The address the service listens on. */
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly officeDataDirectory: string;
}

/** Values that depend on the operating system, supplied by the platform layer. */
export interface OfficeConfigDefaults {
  officeDataDirectory(): string;
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const REQUIRED = "is required";
const PORT_RANGE = "must be a port number from 1 to 65535";
const HOST_ADDRESS = "must be an IP address, such as 127.0.0.1 or 0.0.0.0";
// Loopback unless the user opens The Office to the LAN (spec §5.1).
const DEFAULT_HOST = "127.0.0.1";

// An env file copied with a value left blank yields "", which means "not set", not "invalid".
function blankAsUnset(value: unknown): unknown {
  return value === "" ? undefined : value;
}

const environmentSchema = z.object({
  OFFICE_HOST: z.preprocess(
    blankAsUnset,
    z.union([z.ipv4(), z.ipv6()], { error: HOST_ADDRESS }).default(DEFAULT_HOST),
  ),
  OFFICE_PORT: z.preprocess(
    blankAsUnset,
    z
      .string({ error: REQUIRED })
      .regex(/^\d+$/, PORT_RANGE)
      .transform(Number)
      .pipe(z.number().min(1, PORT_RANGE).max(65_535, PORT_RANGE)),
  ),
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
    host: result.data.OFFICE_HOST,
    port: result.data.OFFICE_PORT,
    databaseUrl: result.data.DATABASE_URL,
    officeDataDirectory: result.data.OFFICE_DATA_DIR ?? defaults.officeDataDirectory(),
  };
}

/** Set in `.env` beside The Office's own config: the compose stack's and telemetry's. */
const OFFICE_STACK_VARIABLES = /^(POSTGRES_\w+|COMPOSE_PROFILES|GRAFANA_PORT|OTEL_\w+)$/;
/** What npm sets for the script it starts the service with, such as `npm_config_local_prefix`. */
const NPM_SCRIPT_VARIABLES = /^(NPM_\w+|INIT_CWD|NODE)$/;
/** A production switch makes a Project's install leave out its development dependencies. */
const PRODUCTION_SWITCHES = /^NODE_ENV$/;
/**
 * The user's own GitHub tokens, which GitHub's tools read before their own sign-in: no Project
 * command or Agent gets them, as Office git uses only the Office identity (spec §5.5 Defaults).
 */
const USER_GITHUB_TOKENS = /^(GH_TOKEN|GITHUB_TOKEN|GH_ENTERPRISE_TOKEN|GITHUB_ENTERPRISE_TOKEN)$/;

/**
 * Whether a variable of the service's environment is The Office's own, which no Project command
 * inherits: its config (DATABASE_URL among it, a secret by spec §6), the compose stack's and
 * telemetry's settings, what npm set when it started the service, production switches and the
 * user's GitHub tokens, so neither Project commands nor Agents' sessions get them. Case
 * is ignored, as Windows ignores it and npm writes its variables in lowercase.
 */
export function isOfficeOwnVariable(name: string): boolean {
  const upperCase = name.toUpperCase();
  return (
    Object.hasOwn(environmentSchema.shape, upperCase) ||
    [OFFICE_STACK_VARIABLES, NPM_SCRIPT_VARIABLES, PRODUCTION_SWITCHES, USER_GITHUB_TOKENS].some(
      (variables) => variables.test(upperCase),
    )
  );
}

function toConfigProblem(issue: z.core.$ZodIssue): ConfigProblem {
  return { variable: String(issue.path[0]), problem: issue.message };
}
