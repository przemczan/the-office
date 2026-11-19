import { isOfficeOwnVariable } from "../../../../platform/config/office-config.js";
import { withoutContainerRuntimeVariables } from "../../domain/container-runtime-commands.js";

/**
 * The variables that would sign the runtime in or point it elsewhere: Copilot's own, and the
 * GitHub tokens it reads (`GH_TOKEN`, `GITHUB_TOKEN` and the rest).
 */
const ENGINE_VARIABLE_PREFIXES = ["COPILOT", "GH_", "GITHUB_"];

/**
 * The variables the Copilot CLI runtime runs with (spec §5.4): the given ones without Copilot's
 * and GitHub's, so nothing of the user's signs it in, without The Office's own, which hold its
 * database credentials (spec §6), and without the container runtime's; telemetry off. Its folder
 * reaches it as the SDK's `baseDirectory`, which sets `COPILOT_HOME`.
 */
export function copilotEnvironment(
  environment: Readonly<Record<string, string>>,
): Record<string, string> {
  const given = Object.entries(withoutContainerRuntimeVariables(environment)).filter(
    ([name]) =>
      !isOfficeOwnVariable(name) &&
      !ENGINE_VARIABLE_PREFIXES.some((prefix) => name.toUpperCase().startsWith(prefix)),
  );
  return { ...Object.fromEntries(given), COPILOT_TELEMETRY_DISABLED: "true" };
}
