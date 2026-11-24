import { Inject, Injectable } from "@nestjs/common";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { DEFAULT_ACTION_SETTINGS, type ActionSettings } from "../../domain/action-settings.js";
import { ActionSettingsStore } from "../../ports/action-settings-store.js";
import { actionSettings } from "./actions.schema.js";

@Injectable()
export class PostgresActionSettings extends ActionSettingsStore {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async read(): Promise<ActionSettings> {
    const [row] = await this.database.select().from(actionSettings).limit(1);
    return row === undefined ? DEFAULT_ACTION_SETTINGS : { actionsAtOnce: row.actionsAtOnce };
  }

  async change(settings: ActionSettings): Promise<void> {
    await this.database
      .insert(actionSettings)
      .values({ actionsAtOnce: settings.actionsAtOnce })
      .onConflictDoUpdate({
        target: actionSettings.id,
        set: { actionsAtOnce: settings.actionsAtOnce },
      });
  }
}
