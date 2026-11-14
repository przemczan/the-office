import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type { GoogleClient } from "../../domain/google-client.js";
import { GoogleClientRepository } from "../../ports/google-client-repository.js";
import { googleClient } from "./google-client.schema.js";

@Injectable()
export class PostgresGoogleClientRepository extends GoogleClientRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async find(): Promise<GoogleClient | undefined> {
    const [row] = await this.database.select().from(googleClient);
    return row && { clientId: row.clientId, clientSecret: row.clientSecret, savedAt: row.savedAt };
  }

  async save(client: GoogleClient): Promise<void> {
    await this.database
      .insert(googleClient)
      .values({ id: 1, ...client })
      .onConflictDoUpdate({ target: googleClient.id, set: client });
  }

  async remove(): Promise<boolean> {
    const removed = await this.database.delete(googleClient).returning({ id: googleClient.id });
    return removed.length > 0;
  }
}
