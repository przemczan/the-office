import { sessionEnvironment } from "../session-environment.ts";

/**
 * The model the `copilot.*` checks run on: a 0× premium-request model on Copilot's paid plans, so a
 * run spends no premium requests. `copilot.start` records whether the account lists it.
 */
export const COPILOT_CHECK_MODEL = "gpt-5-mini";

/** The variable the run takes the check's Copilot token from: a fine-grained PAT with "Copilot Requests". */
export const COPILOT_TOKEN_VARIABLE = "COPILOT_GITHUB_TOKEN";

/**
 * Variables the runtime reads a GitHub identity or its folder from (`COPILOT_GITHUB_TOKEN`,
 * `GH_TOKEN`, `GITHUB_TOKEN`, `COPILOT_HOME`, `GH_HOST`…): the check gives the token and the folder
 * itself, so neither comes from the parent.
 */
const COPILOT_DROPPED_PREFIXES = ["COPILOT", "GH_", "GITHUB_"] as const;

/** The runtime's environment: the sessions' own, without Copilot's and GitHub's variables. */
export function copilotEnvironment(
  parent: NodeJS.ProcessEnv = process.env,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(sessionEnvironment(parent)).filter(
      ([name]) => !COPILOT_DROPPED_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
    ),
  );
}

/** What a check needs to start the runtime: its config folder (`COPILOT_HOME`) and the account's token. */
export interface CopilotAccount {
  readonly home: string;
  readonly token: string;
}
