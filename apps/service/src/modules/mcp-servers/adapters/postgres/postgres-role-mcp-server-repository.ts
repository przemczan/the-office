import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  RoleMcpServerRepository,
  type RoleMcpServer,
} from "../../ports/role-mcp-server-repository.js";
import { roleMcpServers } from "./mcp-servers.schema.js";

@Injectable()
export class PostgresRoleMcpServerRepository extends RoleMcpServerRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async list(): Promise<readonly RoleMcpServer[]> {
    return this.database
      .select()
      .from(roleMcpServers)
      .orderBy(asc(roleMcpServers.roleKey), asc(roleMcpServers.serverName));
  }

  async replaceRolesOf(serverName: string, roleKeys: readonly string[]): Promise<void> {
    await this.database.transaction(async (transaction) => {
      await transaction.delete(roleMcpServers).where(eq(roleMcpServers.serverName, serverName));
      if (roleKeys.length === 0) return;
      await transaction
        .insert(roleMcpServers)
        .values(roleKeys.map((roleKey) => ({ roleKey, serverName })));
    });
  }
}
