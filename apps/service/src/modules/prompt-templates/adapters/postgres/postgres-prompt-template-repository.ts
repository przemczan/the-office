import { Inject, Injectable } from "@nestjs/common";
import { desc, eq, inArray, sql } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import type {
  PromptTemplateChange,
  PromptTemplateVersion,
} from "../../domain/prompt-template-version.js";
import type { UserRef } from "../../domain/user.js";
import { PromptTemplateRepository } from "../../ports/prompt-template-repository.js";
import { promptTemplateVersions } from "./prompt-templates.schema.js";

const VERSION = {
  key: promptTemplateVersions.key,
  version: promptTemplateVersions.version,
  text: promptTemplateVersions.text,
  savedAt: promptTemplateVersions.savedAt,
  savedBy: promptTemplateVersions.savedBy,
};

@Injectable()
export class PostgresPromptTemplateRepository extends PromptTemplateRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async current(keys: readonly string[]): Promise<ReadonlyMap<string, PromptTemplateVersion>> {
    if (keys.length === 0) return new Map();
    const rows = await this.database
      .selectDistinctOn([promptTemplateVersions.key], VERSION)
      .from(promptTemplateVersions)
      .where(inArray(promptTemplateVersions.key, [...keys]))
      .orderBy(promptTemplateVersions.key, desc(promptTemplateVersions.version));
    return new Map(rows.map((row) => [row.key, row]));
  }

  update(
    key: string,
    change: (current: PromptTemplateVersion | undefined) => PromptTemplateChange | undefined,
    savedAt: Date,
    savedBy: UserRef,
  ): Promise<PromptTemplateVersion | undefined> {
    return this.database.transaction(async (transaction) => {
      // There is no row to lock before a template's first version.
      await transaction.execute(
        sql`select pg_advisory_xact_lock(hashtext(${`prompt-templates.${key}`}))`,
      );
      const [current] = await transaction
        .select(VERSION)
        .from(promptTemplateVersions)
        .where(eq(promptTemplateVersions.key, key))
        .orderBy(desc(promptTemplateVersions.version))
        .limit(1);
      const changed = change(current);
      if (!changed) return current;
      const saved: PromptTemplateVersion = { key, ...changed, savedAt, savedBy };
      await transaction.insert(promptTemplateVersions).values(saved);
      return saved;
    });
  }
}
