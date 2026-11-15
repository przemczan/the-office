import { isAbsolute } from "node:path";
import { z } from "zod";
import { GITHUB_SITE, type GitHubSite } from "../git-identity/github-site.js";
import { InvalidOfficeConfigError, type ConfigProblem } from "./invalid-office-config-error.js";

export interface OfficeConfig {
  /** The address the service listens on. */
  readonly host: string;
  readonly port: number;
  readonly databaseUrl: string;
  readonly officeDataDirectory: string;
  /** Where GitHub is: GitHub's own, or a stand-in such as the end-to-end tests' fake. */
  readonly gitHub: GitHubSite;
  /**
   * Where the launcher reads an Office update request and leaves its result
   * (docs/running-the-office.md); absent when the service runs without it, as under `npm run dev`.
   */
  readonly officeUpdateFolder?: string;
  /**
   * The public address, as an origin (`https://office.example.com`), at which The Office is reached
   * through the user's reverse proxy (spec §5.1 Defaults); absent when it has none.
   */
  readonly publicAddress?: string;
  /**
   * `OFFICE_SKIP_SETUP_BASICS`: an automated install leaves out First-run setup's basics (spec
   * §2.10), never the setup token or the first user. Off when absent.
   */
  readonly skipSetupBasics?: boolean;
}

/** Values that depend on the operating system, supplied by the platform layer. */
export interface OfficeConfigDefaults {
  officeDataDirectory(): string;
}

export type EnvironmentVariables = Readonly<Record<string, string | undefined>>;

const REQUIRED = "is required";
const PORT_RANGE = "must be a port number from 1 to 65535";
const HOST_ADDRESS = "must be an IP address, such as 127.0.0.1 or 0.0.0.0";
const WEB_ADDRESS = "must be an http:// or https:// URL";
const TRUE_OR_FALSE = "must be true or false";
const PUBLIC_ADDRESS =
  "must be an https:// address with no path, such as https://office.example.com";
// Loopback unless the user opens The Office to the LAN (spec §5.1).
const DEFAULT_HOST = "127.0.0.1";

/** An https:// origin alone, a trailing slash allowed: no user, path, query or fragment. */
function isHttpsOrigin(value: string): boolean {
  const url = URL.parse(value);
  return (
    url !== null &&
    url.protocol === "https:" &&
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "" &&
    !/[?#]$/.test(value)
  );
}

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
  OFFICE_UPDATE_FOLDER: z.preprocess(
    blankAsUnset,
    z.string().refine(isAbsolute, "must be an absolute path").optional(),
  ),
  OFFICE_GITHUB_URL: z.preprocess(
    blankAsUnset,
    z.url({ protocol: /^https?$/, error: WEB_ADDRESS }).default(GITHUB_SITE.webUrl),
  ),
  OFFICE_GITHUB_API_URL: z.preprocess(
    blankAsUnset,
    z.url({ protocol: /^https?$/, error: WEB_ADDRESS }).default(GITHUB_SITE.apiUrl),
  ),
  OFFICE_PUBLIC_ADDRESS: z.preprocess(
    blankAsUnset,
    z
      .string()
      .refine(isHttpsOrigin, PUBLIC_ADDRESS)
      .transform((address) => new URL(address).origin)
      .optional(),
  ),
  OFFICE_SKIP_SETUP_BASICS: z.preprocess(
    blankAsUnset,
    z
      .enum(["true", "false"], { error: TRUE_OR_FALSE })
      .default("false")
      .transform((value) => value === "true"),
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
    gitHub: { webUrl: result.data.OFFICE_GITHUB_URL, apiUrl: result.data.OFFICE_GITHUB_API_URL },
    skipSetupBasics: result.data.OFFICE_SKIP_SETUP_BASICS,
    ...(result.data.OFFICE_UPDATE_FOLDER && {
      officeUpdateFolder: result.data.OFFICE_UPDATE_FOLDER,
    }),
    ...(result.data.OFFICE_PUBLIC_ADDRESS && { publicAddress: result.data.OFFICE_PUBLIC_ADDRESS }),
  };
}

/**
 * Reads only DATABASE_URL, for a host command such as `npm run set-password` that needs the
 * database and nothing the service listens with.
 * Throws InvalidOfficeConfigError when it is missing or invalid.
 */
export function readDatabaseUrl(environment: EnvironmentVariables): string {
  const result = environmentSchema.pick({ DATABASE_URL: true }).safeParse(environment);
  if (!result.success) {
    throw new InvalidOfficeConfigError(result.error.issues.map(toConfigProblem));
  }
  return result.data.DATABASE_URL;
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
