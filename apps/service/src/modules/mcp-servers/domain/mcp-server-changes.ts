import type { DomainEvent } from "../../../platform/events/domain-event.js";
import {
  connectionProblems,
  mcpServerNameProblems,
  sameConnection,
  serverValueProblems,
  trimmedConnection,
  type McpServer,
  type McpServerEdit,
  type NewMcpServer,
  type ServerValue,
  type ServerValueEdit,
} from "./mcp-server.js";
import { McpServerAdded, McpServerChanged, McpServerRemoved } from "./mcp-server-events.js";
import { McpServerRefused } from "./mcp-server-refused.js";

/** An MCP server after a change, with the event that announces it. */
export interface McpServerChange<Event extends DomainEvent> {
  readonly server: McpServer;
  readonly event: Event;
}

/** Off until the user reviews it. Refuses with every reason when it breaks a rule. */
export function addMcpServer(given: NewMcpServer, addedAt: Date): McpServerChange<McpServerAdded> {
  const name = given.name.trim();
  const connection = trimmedConnection(given.connection);
  const serverValues = editedServerValues([], given.serverValues);
  refuseProblems([
    ...mcpServerNameProblems(name),
    ...connectionProblems(connection),
    ...serverValueProblems(connection.transport, serverValues),
  ]);
  const server: McpServer = { name, connection, serverValues, state: "off", addedAt };
  return { server, event: new McpServerAdded(name, addedAt) };
}

/**
 * Its new command or URL and Server values. A change to what runs or to the values' names needs a
 * new review, so it turns the server off; a value's Office-wide value or its flags don't.
 * Undefined when nothing would change.
 */
export function changeMcpServer(
  server: McpServer,
  edit: McpServerEdit,
): McpServerChange<McpServerChanged> | undefined {
  const connection = trimmedConnection(edit.connection);
  const serverValues = editedServerValues(server.serverValues, edit.serverValues);
  refuseProblems([
    ...connectionProblems(connection),
    ...serverValueProblems(connection.transport, serverValues),
  ]);
  const needsReview =
    !sameConnection(server.connection, connection) || !sameNames(server.serverValues, serverValues);
  if (!needsReview && sameServerValues(server.serverValues, serverValues)) return undefined;
  const turnedOff = needsReview && server.state === "on";
  const changed: McpServer = {
    ...server,
    connection,
    serverValues,
    state: needsReview ? "off" : server.state,
  };
  return { server: changed, event: new McpServerChanged(server.name, turnedOff) };
}

export function removeMcpServer(server: McpServer): McpServerRemoved {
  return new McpServerRemoved(server.name);
}

/**
 * The values as saved. One without an Office-wide value keeps the one kept under its name, unless
 * it was a secret and is no longer: a secret is never sent back, and a plain value would be.
 */
function editedServerValues(
  kept: readonly ServerValue[],
  edits: readonly ServerValueEdit[],
): ServerValue[] {
  return edits.map((edit) => {
    const name = edit.name.trim();
    const keptValue = kept.find((value) => value.name === name);
    const mayKeep = keptValue !== undefined && (!keptValue.secret || edit.secret);
    const officeWideValue =
      edit.officeWideValue ?? (mayKeep ? keptValue.officeWideValue : undefined);
    return {
      name,
      secret: edit.secret,
      required: edit.required,
      ...(officeWideValue !== undefined && officeWideValue !== "" && { officeWideValue }),
    };
  });
}

function sameNames(one: readonly ServerValue[], other: readonly ServerValue[]): boolean {
  const names = new Set(one.map(({ name }) => name));
  return one.length === other.length && other.every(({ name }) => names.has(name));
}

function sameServerValues(one: readonly ServerValue[], other: readonly ServerValue[]): boolean {
  return (
    one.length === other.length && one.every((value, index) => sameServerValue(value, other[index]))
  );
}

function sameServerValue(one: ServerValue, other: ServerValue | undefined): boolean {
  return (
    other !== undefined &&
    one.name === other.name &&
    one.secret === other.secret &&
    one.required === other.required &&
    one.officeWideValue === other.officeWideValue
  );
}

function refuseProblems(problems: readonly string[]): void {
  if (problems.length > 0) throw new McpServerRefused(problems);
}
