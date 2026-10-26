import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_OFFICE_WIDE_LIMIT } from "../../domain/task-start.js";
import { WorkSettings } from "../../ports/work-settings.js";
import { workSettings } from "./work-settings.schema.js";

@Injectable()
export class PostgresWorkSettings extends WorkSettings {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async officeWideLimit(): Promise<number> {
    const [row] = await this.database.select().from(workSettings).limit(1);
    return row?.officeWideLimit ?? DEFAULT_OFFICE_WIDE_LIMIT;
  }
}
