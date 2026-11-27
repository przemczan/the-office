import { Injectable, type OnModuleInit } from "@nestjs/common";
import {
  ADD_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ACTION,
  CHANGE_MCP_SERVER_ROLES_ACTION,
  CHANGE_MCP_SERVER_STATE_ACTION,
  MCP_SERVERS_OFFICE_ACTIONS,
  REMOVE_MCP_SERVER_ACTION,
  type OfficeAction,
} from "@the-office/contracts";
import type { z } from "zod";
import {
  officeActionDraft,
  officeActionTool,
  OfficeToolRegistry,
  withSecretValues,
  type OfficeTool,
  type OfficeToolChangedField,
  type OfficeToolDraft,
  type OfficeToolResult,
} from "../../../engine/index.js";
import { McpServerLibrary } from "../../application/mcp-server-library.js";
import { RoleMcpServers } from "../../application/role-mcp-servers.js";
import type { McpServer, McpServerConnection, ServerValueEdit } from "../../domain/mcp-server.js";
import { McpServerNotFound } from "../../domain/mcp-server-not-found.js";
import { McpServerRefused } from "../../domain/mcp-server-refused.js";
import { toMcpServerResponse } from "../http/mcp-server-responses.js";

/** A server as its action answers it: with the Roles it is assigned to. */
interface ServerResult {
  readonly server: McpServer;
  readonly roles: readonly string[];
}

/**
 * One of the library's Office actions as the library carries it out: `handle` for the user's request
 * and the Agent's call alike, its result answered to the web by `response` and worded to the Agent
 * by `words`; `draft` says what a call changes now, and `check` refuses a call up front.
 */
interface McpServerActionHandler<Action extends OfficeAction, Result> {
  readonly action: Action;
  /** Whether a call of it can give a secret's value, which the Secret values group rules too. */
  readonly givesSecrets?: true;
  handle(input: z.output<Action["input"]>): Promise<Result>;
  response(result: Result): z.input<Action["answer"]>;
  words(result: Result, input: z.output<Action["input"]>): string;
  draft(input: z.output<Action["input"]>): Promise<OfficeToolDraft>;
  check?(input: z.output<Action["input"]>): Promise<string | undefined>;
}

/** A handler with its action's types left behind, as the routes and tools look it up by name. */
type AnyHandler = McpServerActionHandler<OfficeAction, unknown>;

function handler<Action extends OfficeAction, Result>(
  each: McpServerActionHandler<Action, Result>,
): AnyHandler {
  return each as unknown as AnyHandler;
}

/**
 * The MCP server library's Office actions (the Office action convention): the one handler of each
 * action the library declares, which its route (`McpServerOfficeActionsController`) and its Office
 * tool, registered here, both call. Throws at start for a declared action with no handler.
 *
 * A call that gives a secret's value is ruled by Secret values too and shows by name only
 * everywhere (`withSecretValues`). Nothing the library keeps names who made a change, so a handler
 * never asks who acts.
 */
@Injectable()
export class McpServerOfficeActions implements OnModuleInit {
  private readonly handlers: ReadonlyMap<string, AnyHandler>;

  constructor(
    private readonly registry: OfficeToolRegistry,
    private readonly library: McpServerLibrary,
    private readonly roleServers: RoleMcpServers,
  ) {
    this.handlers = new Map(
      [
        this.addMcpServer(),
        this.changeMcpServer(),
        this.changeMcpServerState(),
        this.changeMcpServerRoles(),
        this.removeMcpServer(),
      ].map((each) => [each.action.name, each]),
    );
    const unhandled = MCP_SERVERS_OFFICE_ACTIONS.filter(({ name }) => !this.handlers.has(name));
    if (unhandled.length > 0) {
      throw new Error(`No handler carries out ${unhandled.map(({ name }) => name).join(", ")}.`);
    }
  }

  onModuleInit(): void {
    for (const each of this.handlers.values()) {
      const run = (input: Record<string, unknown>): Promise<OfficeToolResult> =>
        answered(async () => each.words(await each.handle(input), input));
      const tool = officeActionTool(each.action, (input) => run(input), {
        draft: (input) => each.draft(input),
        applyFor: (input) => run(input),
      });
      const checked: OfficeTool = tool.authority
        ? {
            ...tool,
            authority: {
              ...tool.authority,
              check: async (input) => {
                try {
                  return await each.check?.(each.action.input.parse(input));
                } catch (error) {
                  if (error instanceof McpServerRefused) return error.message;
                  throw error;
                }
              },
            },
          }
        : tool;
      this.registry.register(each.givesSecrets ? this.withSecrets(checked, each.action) : checked);
    }
  }

  /** The route's answer to the action, carried out for the signed-in user. */
  async answer(action: OfficeAction, input: unknown): Promise<unknown> {
    const each = this.handlers.get(action.name);
    if (!each)
      throw new Error(`The MCP server library carries out no Office action ${action.name}.`);
    return each.response(await each.handle(input as never));
  }

  /** The tool, ruled by Secret values besides MCP servers when it gives a secret's value. */
  private withSecrets(tool: OfficeTool, action: OfficeAction): OfficeTool {
    const each = this.handlers.get(action.name);
    if (!each) throw new Error(`No handler carries out ${action.name}.`);
    return withSecretValues(tool, action.input, {
      given: (call) => Promise.resolve(secretsGiven(call)),
      without: (call, secrets) => ({
        ...call,
        serverValues: (call.serverValues as readonly ServerValueEdit[]).map((value) =>
          secrets.has(value.name) ? withoutValue(value) : value,
        ),
      }),
      draft: (shown) => each.draft(action.input.parse(shown)),
    });
  }

  private addMcpServer(): AnyHandler {
    return handler({
      action: ADD_MCP_SERVER_ACTION,
      givesSecrets: true,
      handle: async (input) => {
        const server = await this.library.add({
          name: input.name,
          connection: connectionOf(input),
          serverValues: serverValueEditsOf(input),
        });
        return { server, roles: [] };
      },
      response: ({ server, roles }: ServerResult) => toMcpServerResponse(server, roles),
      words: ({ server }) =>
        `The MCP server ${server.name} is added, off until the user has reviewed what runs and the tools it lists.`,
      draft: async (input) => {
        const taken = await this.find(input.name.trim());
        return officeActionDraft(ADD_MCP_SERVER_ACTION, input, {
          title: input.name.trim(),
          decidedBy: { nameTaken: taken !== undefined },
          values: {},
        });
      },
    });
  }

  private changeMcpServer(): AnyHandler {
    return handler({
      action: CHANGE_MCP_SERVER_ACTION,
      givesSecrets: true,
      handle: async (input) => {
        const server = await this.library.change(input.name, {
          connection: connectionOf(input),
          serverValues: serverValueEditsOf(input),
        });
        return { server, roles: await this.rolesOf(server.name) };
      },
      response: ({ server, roles }: ServerResult) => toMcpServerResponse(server, roles),
      words: ({ server }) =>
        `The MCP server ${server.name} is changed as given; it is ${server.state} now.`,
      check: (input) => this.existing(input.name),
      draft: async (input) => {
        const server = await this.library.read(input.name);
        const drafted = officeActionDraft(CHANGE_MCP_SERVER_ACTION, input, {
          title: server.name,
          decidedBy: {},
          values: {
            ...connectionFields(server.connection),
            serverValues: server.serverValues.map(shownValue),
          },
        });
        // What the call decides by and writes is the connection and the values as shown: a plain
        // value's text, a secret's name and flags, never a secret's value.
        return {
          ...drafted,
          fingerprint: {
            subject: drafted.subject.id,
            connection: server.connection,
            serverValues: server.serverValues.map(shownValue),
          },
        };
      },
    });
  }

  private changeMcpServerState(): AnyHandler {
    return handler({
      action: CHANGE_MCP_SERVER_STATE_ACTION,
      handle: async ({ name, state, reviewDigest }): Promise<ServerResult> => {
        if (state === "off") {
          const server = await this.library.turnOff(name);
          return { server, roles: await this.rolesOf(name) };
        }
        // An Agent's call has no digest of a review the user read: the Office reviews it now and
        // turns it on against that review, refused when it can't connect.
        const digest = reviewDigest ?? (await this.reviewedDigest(name));
        const server = await this.library.turnOn(name, digest);
        return { server, roles: await this.rolesOf(name) };
      },
      response: ({ server, roles }: ServerResult) => toMcpServerResponse(server, roles),
      words: ({ server }) =>
        server.state === "on"
          ? `The MCP server ${server.name} is on, with ${server.tools.length === 0 ? "no tools" : `the tools ${server.tools.map(({ name }) => name).join(", ")}`}.`
          : `The MCP server ${server.name} is off.`,
      check: async (input) => {
        const missing = await this.existing(input.name);
        if (missing !== undefined || input.state === "off" || input.reviewDigest !== undefined) {
          return missing;
        }
        const review = await this.library.review(input.name);
        return review.connected ? undefined : review.problem;
      },
      draft: async ({ name, state }) => {
        const server = await this.library.read(name);
        if (state === "off") {
          return officeActionDraft(
            CHANGE_MCP_SERVER_STATE_ACTION,
            { name, state },
            { title: name, decidedBy: {}, values: { state: server.state } },
          );
        }
        const review = await this.library.review(name);
        const fields: OfficeToolChangedField[] = [
          { label: "State", before: server.state, after: "on", form: "short" },
          review.connected
            ? {
                label: "Tools it lists",
                before: server.tools.map(({ name: tool }) => tool).join("\n") || null,
                after:
                  review.tools
                    .map(({ name: tool, description }) =>
                      description === "" ? tool : `${tool}: ${description}`,
                    )
                    .join("\n") || "(none)",
                form: "long",
              }
            : {
                label: "Review",
                before: null,
                after: `Can't connect: ${review.problem}`,
                form: "long",
              },
        ];
        return {
          subject: { kind: "mcp-server", id: name, title: name },
          fields,
          // What the user turns on is what the review shows: a server or tools that changed since
          // the draft are a change to the subject.
          fingerprint: review.connected ? review.reviewDigest : { notConnected: review.problem },
        };
      },
    });
  }

  private changeMcpServerRoles(): AnyHandler {
    return handler({
      action: CHANGE_MCP_SERVER_ROLES_ACTION,
      handle: async ({ name, roles }) => {
        const assigned = await this.roleServers.assignServer(name, roles);
        return { server: await this.library.read(name), roles: assigned };
      },
      response: ({ server, roles }: ServerResult) => toMcpServerResponse(server, roles),
      words: ({ server, roles }) =>
        roles.length === 0
          ? `The MCP server ${server.name} is assigned to no Role now.`
          : `The MCP server ${server.name} is assigned to ${roles.join(", ")} now; their next sessions get its tools, each at Consult.`,
      check: (input) => this.existing(input.name),
      draft: async ({ name, roles }) => {
        const server = await this.library.read(name);
        return officeActionDraft(
          CHANGE_MCP_SERVER_ROLES_ACTION,
          { name, roles },
          { title: server.name, decidedBy: {}, values: { roles: await this.rolesOf(name) } },
        );
      },
    });
  }

  private removeMcpServer(): AnyHandler {
    return handler({
      action: REMOVE_MCP_SERVER_ACTION,
      handle: async ({ name }) => {
        await this.library.remove(name);
      },
      response: () => undefined,
      words: (_result, { name }) => `The MCP server ${name} is removed.`,
      check: (input) => this.existing(input.name),
      draft: async ({ name }) => {
        const server = await this.library.read(name);
        const drafted = officeActionDraft(
          REMOVE_MCP_SERVER_ACTION,
          { name },
          { title: server.name, decidedBy: { connection: server.connection }, values: {} },
        );
        return {
          ...drafted,
          fields: [
            {
              label: "MCP server",
              before: connectionText(server.connection),
              after: null,
              form: "short",
            },
          ],
        };
      },
    });
  }

  private async find(name: string): Promise<McpServer | undefined> {
    return this.library.read(name).catch((error: unknown) => {
      if (error instanceof McpServerNotFound) return undefined;
      throw error;
    });
  }

  /** The words that refuse a call on a server the library hasn't, or undefined when it has it. */
  private async existing(name: string): Promise<string | undefined> {
    return (await this.find(name)) === undefined ? new McpServerNotFound(name).message : undefined;
  }

  private async rolesOf(name: string): Promise<readonly string[]> {
    return (await this.roleServers.byServer()).get(name) ?? [];
  }

  /** The digest of a review made now, refused with its problem when the server can't connect. */
  private async reviewedDigest(name: string): Promise<string> {
    const review = await this.library.review(name);
    if (!review.connected) throw new McpServerRefused([review.problem]);
    return review.reviewDigest;
  }
}

interface ConnectionInput {
  readonly transport: "stdio" | "streamable-http";
  readonly command?: string | undefined;
  readonly arguments?: readonly string[] | undefined;
  readonly url?: string | undefined;
  readonly serverValues: readonly ServerValueEdit[];
}

/**
 * What runs, from the flat input: a stdio server's command and arguments, or a remote one's URL.
 * What the transport needs but the call leaves out is blank, which the library refuses in its own
 * words.
 */
function connectionOf(input: ConnectionInput): McpServerConnection {
  return input.transport === "stdio"
    ? { transport: "stdio", command: input.command ?? "", arguments: input.arguments ?? [] }
    : { transport: "streamable-http", url: input.url ?? "" };
}

function connectionFields(connection: McpServerConnection): Record<string, unknown> {
  return connection.transport === "stdio"
    ? { transport: "stdio", command: connection.command, arguments: [...connection.arguments] }
    : { transport: "streamable-http", url: connection.url };
}

function connectionText(connection: McpServerConnection): string {
  return connection.transport === "stdio"
    ? [connection.command, ...connection.arguments].join(" ")
    : connection.url;
}

function serverValueEditsOf({ serverValues }: ConnectionInput): ServerValueEdit[] {
  return serverValues.map(({ name, secret, required, officeWideValue }): ServerValueEdit => ({
    name,
    secret,
    required,
    ...(officeWideValue !== undefined && { officeWideValue }),
  }));
}

/** A Server value as the call shows it: a secret's value never, a plain one's as it is. */
function shownValue({
  name,
  secret,
  required,
  officeWideValue,
}: McpServer["serverValues"][number]) {
  return {
    name,
    secret,
    required,
    ...(!secret && officeWideValue !== undefined && { officeWideValue }),
  };
}

function withoutValue({ name, secret, required }: ServerValueEdit): ServerValueEdit {
  return { name, secret, required };
}

/** The names of the Server values the call gives a secret's value for. */
function secretsGiven(call: Readonly<Record<string, unknown>>): string[] {
  return (call.serverValues as readonly ServerValueEdit[])
    .filter(({ secret, officeWideValue }) => secret && officeWideValue !== undefined)
    .map(({ name }) => name);
}

/** The library's refusals answer the Agent in words it can act on; anything else fails the call. */
async function answered(read: () => Promise<string>): Promise<OfficeToolResult> {
  try {
    return { text: await read(), isError: false };
  } catch (error) {
    if (error instanceof McpServerRefused || error instanceof McpServerNotFound) {
      return { text: error.message, isError: true };
    }
    throw error;
  }
}
