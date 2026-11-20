import { sessionEnvironment } from "../session-environment.ts";

/**
 * Variables the CLI reads an account, a folder or a mode from (`GEMINI_API_KEY`, `GEMINI_CLI_HOME`,
 * `GOOGLE_GENAI_USE_VERTEXAI`, `GOOGLE_CLOUD_PROJECT`, `GOOGLE_APPLICATION_CREDENTIALS`…), and those
 * that switch its sign-in or browser handling (`NO_BROWSER`, `BROWSER`, `CLOUD_SHELL`): the check
 * gives the folder and the mode itself, so none comes from the parent.
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

/**
 * What every run of the pinned CLI is given: its home (`GEMINI_CLI_HOME`, under which it keeps
 * `.gemini/`); no relaunch, so the process The Office starts is the one that runs the session and a
 * stop reaches it; and no browser, so a missing sign-in asks for a pasted code instead of opening one.
 */
export function geminiProcessEnvironment(
  home: string,
  extra: Readonly<Record<string, string>> = {},
): Record<string, string> {
  return {
    ...geminiEnvironment(),
    GEMINI_CLI_HOME: home,
    GEMINI_CLI_NO_RELAUNCH: "true",
    NO_BROWSER: "true",
    ...extra,
  };
}
