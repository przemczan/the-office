import { Inject, Injectable } from "@nestjs/common";
import { eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { AdbKey } from "../../domain/adb-key.js";
import { AdbKeyRepository } from "../../ports/adb-key-repository.js";
import { projectAdbKeys } from "./project-adb-keys.schema.js";

@Injectable()
export class PostgresAdbKeyRepository extends AdbKeyRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(projectId: string): Promise<AdbKey | undefined> {
    const [row] = await this.database
      .select()
      .from(projectAdbKeys)
      .where(eq(projectAdbKeys.projectId, projectId));
    return row;
  }

  async keepFirst(key: AdbKey): Promise<AdbKey> {
    // Two first connects at once each make a key; the first kept is the Project's.
    await this.database.insert(projectAdbKeys).values(key).onConflictDoNothing();
    const kept = await this.find(key.projectId);
    if (kept === undefined) throw new Error(`The Project ${key.projectId}'s adb key wasn't kept.`);
    return kept;
  }
}
