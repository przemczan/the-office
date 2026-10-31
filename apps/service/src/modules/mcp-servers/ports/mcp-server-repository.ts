import type { DomainEvent } from "../../../platform/events/domain-event.js";
import type { McpServer } from "../domain/mcp-server.js";
import type { McpServerChange } from "../domain/mcp-server-changes.js";

/** The server after an update, with the change's event, or undefined when nothing changed. */
export interface McpServerUpdate<Event extends DomainEvent> {
  readonly server: McpServer;
  readonly event: Event | undefined;
}

/** Where the library's MCP servers are kept, their secrets with them. */
export abstract class McpServerRepository {
  /** Throws McpServerRefused when the library has the name. */
  abstract add(server: McpServer): Promise<void>;

  abstract find(name: string): Promise<McpServer | undefined>;

  /** Every server, in the order they were added. */
  abstract list(): Promise<readonly McpServer[]>;

  /**
   * Applies `change` to the server as stored, holding it against other changes until the result
   * is saved, so two changes at once never lose one. Saves nothing when `change` returns
   * undefined; throws McpServerNotFound when there is no such server.
   */
  abstract update<Event extends DomainEvent>(
    name: string,
    change: (server: McpServer) => McpServerChange<Event> | undefined,
  ): Promise<McpServerUpdate<Event>>;

  /** Forgets the server and returns it as it was. Throws McpServerNotFound when there is none. */
  abstract remove(name: string): Promise<McpServer>;
}
