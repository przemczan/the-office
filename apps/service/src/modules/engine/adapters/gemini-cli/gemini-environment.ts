import { isOfficeOwnVariable } from "../../../../platform/config/office-config.js";
import { withoutContainerRuntimeVariables } from "../../domain/container-runtime-commands.js";

/**
 * Variables that would sign the CLI in, point it at another folder or mode, or switch its browser
 * handling (`GEMINI_API_KEY`, `GEMINI_CLI_HOME`, `GOOGLE_CLOUD_PROJECT`, `NO_BROWSER`…), and the other
 * engines', MCP's and OpenTelemetry's, which the engine check runs it without (docs/engine-check.md,
 * "Gemini CLI"): the adapter gives the folder, the key and the mode itself.
 */
const DROPPED_PREFIXES = [
  "GEMINI",
  "GOOGLE",
  "NO_BROWSER",
  "BROWSER",
  "CLOUD_SHELL",
  "CLAUDE",
  "ANTHROPIC",
  "OPENAI",
  "CODEX",
  "MCP_",
  "OTEL_",
];

/** The variable the CLI reads the Gemini API key from (spec §5.4.7, "Gemini CLI: sign-in"). */
export const GEMINI_API_KEY_VARIABLE = "GEMINI_API_KEY";

/** Where a turn's CLI keeps its chats and reads its settings and key from. */
export interface GeminiProcessPlaces {
  /**
   * The session's own home in the engine's folder (`GEMINI_CLI_HOME`), whose `.gemini/settings.json`
   * holds the session's settings (`preparedGeminiSessionHome`).
   */
  readonly home: string;
  /** The engine's Gemini API key; the folder's own sign-in when undefined. */
  readonly apiKey: string | undefined;
}

/**
 * The variables the CLI runs with (spec §5.4.7): the session's without the dropped ones, nor The
 * Office's own, which hold its database credentials (spec §6), nor the container runtime's; then its
 * home, no relaunch, so the process The Office starts runs the session and a Stop
 * reaches it, no browser, and the key. The model's shell commands, hooks and MCP servers get them
 * redacted of the key (`gemini-settings.ts`).
 */
export function geminiEnvironment(
  environment: Readonly<Record<string, string>>,
  { home, apiKey }: GeminiProcessPlaces,
): Record<string, string> {
  const given = Object.entries(withoutContainerRuntimeVariables(environment)).filter(
    ([name]) =>
      !isOfficeOwnVariable(name) &&
      !DROPPED_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
  );
  return {
    ...Object.fromEntries(given),
    GEMINI_CLI_HOME: home,
    GEMINI_CLI_NO_RELAUNCH: "true",
    NO_BROWSER: "true",
    ...(apiKey === undefined ? {} : { [GEMINI_API_KEY_VARIABLE]: apiKey }),
  };
}

/** The variables the session's commands run with, which the Office rules expand: no key. */
export function geminiCommandEnvironment(
  environment: Readonly<Record<string, string>>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(environment).filter(([name]) => name !== GEMINI_API_KEY_VARIABLE),
  );
}
