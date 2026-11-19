import { sessionEnvironment } from "../session-environment.ts";

/** A `-c key=value` override's value: Codex parses it as TOML. */
export type ConfigValue = string | number | boolean | readonly ConfigValue[];

/**
 * The app-server's command line. Settings go in only as `-c` overrides, never into the folder's
 * `config.toml`, so the check leaves the account folder's own settings as they are.
 */
export function codexAppServerArguments(
  overrides: Readonly<Record<string, ConfigValue>>,
): string[] {
  return [
    "app-server",
    ...Object.entries(overrides).flatMap(([key, value]) => ["-c", `${key}=${tomlValue(value)}`]),
  ];
}

export function tomlValue(value: ConfigValue): string {
  if (typeof value === "string") {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map(tomlValue).join(", ")}]`;
  }
  return String(value);
}

/**
 * The app-server's environment: the session environment without OpenAI's and Codex's own variables,
 * which would switch the account or the folder, then `CODEX_HOME` and the extra variables.
 */
export function codexEnvironment(
  codexHome: string,
  extra: Readonly<Record<string, string>> = {},
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return { ...sessionEnvironment(parent), CODEX_HOME: codexHome, ...extra };
}
