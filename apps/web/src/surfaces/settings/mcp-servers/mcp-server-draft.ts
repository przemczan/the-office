import type {
  McpServer,
  McpServerEdit,
  McpServerTransport,
  NewMcpServer,
  ServerValue,
  ServerValueEdit,
} from "@the-office/contracts";

/** An MCP server as the form edits it: both connections are kept while the user switches. */
export interface McpServerDraft {
  readonly name: string;
  readonly transport: McpServerTransport;
  readonly command: string;
  /** One argument per line, since an argument may hold spaces. */
  readonly argumentLines: string;
  readonly url: string;
  readonly serverValues: readonly ServerValueEdit[];
}

export const NEW_MCP_SERVER: McpServerDraft = {
  name: "",
  transport: "stdio",
  command: "",
  argumentLines: "",
  url: "",
  serverValues: [],
};

export const NEW_SERVER_VALUE: ServerValueEdit = {
  name: "",
  secret: false,
  required: true,
  officeWideValue: "",
};

/**
 * A kept server in the form: a plain value shown as it is, a secret's left out, so saving keeps
 * it, since it is never sent back.
 */
export function draftOfServer(server: McpServer): McpServerDraft {
  return draftOf(
    server,
    server.serverValues.map(({ name, secret, required, officeWideValue }) =>
      secret
        ? { name, secret, required }
        : { name, secret, required, officeWideValue: officeWideValue ?? "" },
    ),
  );
}

/** A pasted config as the service read it, every value as pasted. */
export function draftOfPasted(server: NewMcpServer): McpServerDraft {
  return draftOf(
    server,
    server.serverValues.map((value) =>
      value.secret ? value : { ...value, officeWideValue: value.officeWideValue ?? "" },
    ),
  );
}

export function newMcpServerOf(draft: McpServerDraft): NewMcpServer {
  return { name: draft.name.trim(), ...mcpServerEditOf(draft) };
}

export function mcpServerEditOf(draft: McpServerDraft): McpServerEdit {
  const serverValues = draft.serverValues.map((value) => ({ ...value, name: value.name.trim() }));
  return draft.transport === "stdio"
    ? {
        transport: "stdio",
        command: draft.command.trim(),
        arguments: argumentsOf(draft.argumentLines),
        serverValues,
      }
    : { transport: "streamable-http", url: draft.url.trim(), serverValues };
}

/** The value made secret or plain; a secret made plain starts empty, as its value is never shown. */
export function withSecret(value: ServerValueEdit, secret: boolean): ServerValueEdit {
  return secret
    ? { ...value, secret }
    : { ...value, secret, officeWideValue: value.officeWideValue ?? "" };
}

/** A secret's value as saving takes it: undefined keeps the one kept, empty removes it. */
export function withSecretValue(
  value: ServerValueEdit,
  officeWideValue: string | undefined,
): ServerValueEdit {
  const { officeWideValue: _kept, ...rest } = value;
  return officeWideValue === undefined ? rest : { ...rest, officeWideValue };
}

/**
 * Whether a secret Office-wide value is kept under the value's name. `saved` is the value kept under
 * that name; a plain one made secret keeps no secret, as the text in its field is what is saved.
 */
export function secretValueSet(saved: ServerValue | undefined): boolean {
  return saved?.secret === true && saved.officeWideValueSet;
}

/** How the server runs, in one line: its command with its arguments, or its URL. */
export function connectionLine(server: McpServer | NewMcpServer): string {
  if (server.transport === "streamable-http") return server.url;
  return [server.command, ...server.arguments].map(quotedIfSpaced).join(" ");
}

/** The list's line for its values, naming the required ones with no Office-wide value. */
export function serverValuesLine(serverValues: readonly ServerValue[]): string {
  if (serverValues.length === 0) return "None";
  const count = `${serverValues.length} ${serverValues.length === 1 ? "Server value" : "Server values"}`;
  const notSet = serverValues.filter((value) => value.required && !value.officeWideValueSet);
  return notSet.length === 0
    ? count
    : `${count} · ${notSet.map(({ name }) => name).join(", ")} not set Office-wide`;
}

function draftOf(
  server: McpServer | NewMcpServer,
  serverValues: readonly ServerValueEdit[],
): McpServerDraft {
  return server.transport === "stdio"
    ? {
        ...NEW_MCP_SERVER,
        name: server.name,
        command: server.command,
        argumentLines: server.arguments.join("\n"),
        serverValues,
      }
    : {
        ...NEW_MCP_SERVER,
        name: server.name,
        transport: server.transport,
        url: server.url,
        serverValues,
      };
}

function argumentsOf(lines: string): string[] {
  return lines.split(/\r?\n/).filter((line) => line.trim() !== "");
}

/** Only for reading: a Windows path keeps its backslashes as they are. */
function quotedIfSpaced(word: string): string {
  return /\s/.test(word) ? `"${word}"` : word;
}
