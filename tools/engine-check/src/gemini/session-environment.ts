import { sessionEnvironment } from "../session-environment.ts";
import { GEMINI_API_KEY_VARIABLE } from "./options.ts";

/**
 * Variables the CLI reads an account, a folder or a mode from (`GEMINI_API_KEY`, `GEMINI_CLI_HOME`,
 * `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`…), and those
 * that switch its sign-in or browser handling (`NO_BROWSER`, `BROWSER`, `CLOUD_SHELL`), beside the
 * other engines', MCP's and OpenTelemetry's that `sessionEnvironment` drops: as the adapter's
 * `gemini-environment.ts`, which is the source of truth.
 */
const GEMINI_DROPPED_PREFIXES = ["GEMINI", "GOOGLE", "NO_BROWSER", "BROWSER", "CLOUD_SHELL"];

/** The CLI's environment: the sessions' own, without Gemini's and Google's variables. */
export function geminiEnvironment(parent: NodeJS.ProcessEnv = process.env): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sessionEnvironment(parent)).filter(
      ([name]) => !GEMINI_DROPPED_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
    ),
  );
}

/** Where a turn's CLI keeps its chats and reads its settings and key from. */
export interface GeminiProcessPlaces {
  /** The session's own home in the engine folder (`GEMINI_CLI_HOME`), holding its settings. */
  readonly home: string;
  /** The engine's Gemini API key; none for a session that runs without one. */
  readonly apiKey?: string;
}

/**
 * What every run of the pinned CLI is given, as the adapter's `geminiEnvironment`: its home, no
 * relaunch, so the process started is the one that runs the session and a stop reaches it, no
 * browser, and the key.
 */
export function geminiProcessEnvironment({
  home,
  apiKey,
}: GeminiProcessPlaces): Record<string, string> {
  return {
    ...geminiEnvironment(),
    GEMINI_CLI_HOME: home,
    GEMINI_CLI_NO_RELAUNCH: "true",
    NO_BROWSER: "true",
    ...(apiKey === undefined ? {} : { [GEMINI_API_KEY_VARIABLE]: apiKey }),
  };
}
