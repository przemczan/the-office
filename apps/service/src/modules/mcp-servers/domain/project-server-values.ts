import type { McpServer, ServerValue } from "./mcp-server.js";
import { McpServerRefused } from "./mcp-server-refused.js";

/** A Project's own value for one of a server's Server values, over its Office-wide value. */
export interface ProjectServerValue {
  readonly projectId: string;
  readonly serverName: string;
  /** The Server value's name. */
  readonly name: string;
  readonly value: string;
  /** Whether the Server value was secret when this value was saved: such a value is never sent back. */
  readonly secret: boolean;
}

/**
 * A Project's value as the Project page saves it. Without a `projectValue` it keeps the one kept
 * under its name; an empty one clears it, and the Office-wide value applies again.
 */
export interface ProjectServerValueEdit {
  readonly name: string;
  readonly projectValue?: string;
}

/**
 * The Project's values for the server as saved. A value not named in `edits` is cleared. Refuses
 * with every reason when an edit names no Server value of the server, or one twice.
 */
export function editedProjectServerValues(
  server: McpServer,
  projectId: string,
  kept: readonly ProjectServerValue[],
  edits: readonly ProjectServerValueEdit[],
): ProjectServerValue[] {
  refuseProblems(projectValueEditProblems(server, edits));
  return edits.flatMap((edit) => {
    const name = edit.name.trim();
    const declared = server.serverValues.find((serverValue) => serverValue.name === name);
    if (!declared) return [];
    const value = edit.projectValue ?? keptValue(kept, server.name, declared);
    if (value === undefined || value === "") return [];
    return [{ projectId, serverName: server.name, name, value, secret: declared.secret }];
  });
}

/**
 * The Project's values that still apply after the server changed: one whose Server value is gone
 * is dropped, and so is a secret's once it is plain, as its Office-wide value is (a plain value is
 * sent back). The rest take the Server value's secrecy as it is now.
 */
export function projectServerValuesAfterChange(
  server: McpServer,
  kept: readonly ProjectServerValue[],
): ProjectServerValue[] {
  return kept.flatMap((projectValue) => {
    const declared = server.serverValues.find(({ name }) => name === projectValue.name);
    if (!declared || (projectValue.secret && !declared.secret)) return [];
    return [{ ...projectValue, secret: declared.secret }];
  });
}

/**
 * Each Server value the server gets in a session: the Project's value, else the Office-wide value.
 * A value with neither is left out.
 */
export function serverValuesFor(
  server: McpServer,
  projectValues: readonly ProjectServerValue[],
): Record<string, string> {
  return Object.fromEntries(
    server.serverValues.flatMap((serverValue) => {
      const value =
        keptValue(projectValues, server.name, serverValue) ?? serverValue.officeWideValue;
      return value === undefined ? [] : [[serverValue.name, value]];
    }),
  );
}

/** The required Server values `values` has none for, in the server's order. */
export function missingRequiredValues(
  server: McpServer,
  values: Readonly<Record<string, string>>,
): string[] {
  return server.serverValues
    .filter(({ name, required }) => required && values[name] === undefined)
    .map(({ name }) => name);
}

/** The Project's value for the Server value, unless it was saved as a secret that is now plain. */
export function keptValue(
  projectValues: readonly ProjectServerValue[],
  serverName: string,
  serverValue: ServerValue,
): string | undefined {
  const kept = projectValues.find(
    (projectValue) =>
      projectValue.serverName === serverName && projectValue.name === serverValue.name,
  );
  return kept && (!kept.secret || serverValue.secret) ? kept.value : undefined;
}

function projectValueEditProblems(
  server: McpServer,
  edits: readonly ProjectServerValueEdit[],
): string[] {
  const names = edits.map(({ name }) => name.trim());
  const unknown = names
    .filter((name) => !server.serverValues.some((serverValue) => serverValue.name === name))
    .map((name) => `"${name}" is not a Server value of "${server.name}".`);
  const repeated = [...new Set(names.filter((name, index) => names.indexOf(name) !== index))].map(
    (name) => `"${name}" is given more than once.`,
  );
  return [...unknown, ...repeated];
}

function refuseProblems(problems: readonly string[]): void {
  if (problems.length > 0) throw new McpServerRefused(problems);
}
