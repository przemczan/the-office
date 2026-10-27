import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_CONTEXT_POLICY_SETTINGS } from "../../domain/context-policy.js";
import { ConversationsSettings } from "../../ports/conversations-settings.js";
import { conversationsSettings } from "./conversations-settings.schema.js";

@Injectable()
export class PostgresConversationsSettings extends ConversationsSettings {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async sizeThreshold(): Promise<number> {
    const [row] = await this.database.select().from(conversationsSettings).limit(1);
    return row?.sizeThreshold ?? DEFAULT_CONTEXT_POLICY_SETTINGS.sizeThreshold;
  }

  async changeSizeThreshold(sizeThreshold: number): Promise<void> {
    await this.database
      .insert(conversationsSettings)
      .values({ sizeThreshold })
      .onConflictDoUpdate({ target: conversationsSettings.id, set: { sizeThreshold } });
  }
}
