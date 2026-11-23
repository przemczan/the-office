import { Inject, Injectable } from "@nestjs/common";
import { asc, eq } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import { storedStageTemplate, type StageTemplate } from "../../domain/stage-template.js";
import { StageTemplateRepository } from "../../ports/stage-template-repository.js";
import { stageTemplates } from "./stage-templates.schema.js";

const STAGE_TEMPLATE_COLUMNS = { id: stageTemplates.id, stage: stageTemplates.stage };

@Injectable()
export class PostgresStageTemplateRepository extends StageTemplateRepository {
  constructor(@Inject(DATABASE) private readonly database: Database) {
    super();
  }

  async list(): Promise<readonly StageTemplate[]> {
    const rows = await this.database
      .select(STAGE_TEMPLATE_COLUMNS)
      .from(stageTemplates)
      .orderBy(asc(stageTemplates.position));
    return rows.map(storedStageTemplate);
  }

  async find(id: string): Promise<StageTemplate | undefined> {
    const [row] = await this.database
      .select(STAGE_TEMPLATE_COLUMNS)
      .from(stageTemplates)
      .where(eq(stageTemplates.id, id));
    return row && storedStageTemplate(row);
  }

  async add({ id, stage }: StageTemplate): Promise<void> {
    await this.database.insert(stageTemplates).values({ id, stage });
  }

  async save({ id, stage }: StageTemplate): Promise<void> {
    await this.database.update(stageTemplates).set({ stage }).where(eq(stageTemplates.id, id));
  }

  async remove(id: string): Promise<void> {
    await this.database.delete(stageTemplates).where(eq(stageTemplates.id, id));
  }
}
