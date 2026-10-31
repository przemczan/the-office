import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { SessionMcpServerRecord } from "../../domain/session-mcp-servers.js";
import { SessionMcpServerRepository } from "../../ports/session-mcp-server-repository.js";
import { sessionMcpServers } from "./mcp-servers.schema.js";

@Injectable()
export class PostgresSessionMcpServerRepository extends SessionMcpServerRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async add({ sessionId, projectId, servers, preparedAt }: SessionMcpServerRecord): Promise<void> {
    await this.database
      .insert(sessionMcpServers)
      .values({ sessionId, projectId: projectId ?? null, servers, preparedAt });
  }

  async find(sessionId: string): Promise<SessionMcpServerRecord | undefined> {
    const [row] = await this.database
      .select()
      .from(sessionMcpServers)
      .where(eq(sessionMcpServers.sessionId, sessionId));
    return (
      row && {
        sessionId: row.sessionId,
        projectId: row.projectId ?? undefined,
        servers: row.servers,
        preparedAt: row.preparedAt,
      }
    );
  }

  async remove(sessionId: string): Promise<void> {
    await this.database.delete(sessionMcpServers).where(eq(sessionMcpServers.sessionId, sessionId));
  }
}
