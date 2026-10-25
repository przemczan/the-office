import { isOfficeOwnVariable } from "../../../platform/config/office-config.js";
import type { OperatingSystem } from "../../../platform/os/operating-system.js";
import type { ProjectEnvironment } from "../domain/project-environment.js";

/**
 * The variables a Project's commands run with: the service's own without The Office's
 * (isOfficeOwnVariable), with the Project's environment applied over them: `unset`, then `set`,
 * then `prependPath`. A variable named in another case on Windows changes the inherited one,
 * so a command never gets both `Path` and `PATH`.
 */
export function commandEnvironment(
  inherited: Readonly<Record<string, string | undefined>>,
  changes: ProjectEnvironment,
  operatingSystem: Pick<OperatingSystem, "paths" | "sameVariableName">,
): Record<string, string> {
  const variables = new Map<string, string>();
  for (const [name, value] of Object.entries(inherited)) {
    if (value !== undefined && !isOfficeOwnVariable(name)) variables.set(name, value);
  }
  const nameOf = (name: string): string =>
    [...variables.keys()].find((present) => operatingSystem.sameVariableName(present, name)) ??
    name;
  for (const name of changes.unset) variables.delete(nameOf(name));
  for (const { name, value } of changes.set) variables.set(nameOf(name), value);
  if (changes.prependPath.length > 0) {
    const path = nameOf("PATH");
    const inheritedPath = variables.get(path);
    variables.set(
      path,
      [...changes.prependPath, ...(inheritedPath ? [inheritedPath] : [])].join(
        operatingSystem.paths.pathListSeparator,
      ),
    );
  }
  return Object.fromEntries(variables);
}
