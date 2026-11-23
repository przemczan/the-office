import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import type { INestApplication } from "@nestjs/common";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { DATABASE, type Database } from "../../../platform/database/database.js";
import { builtInStageTemplates } from "../domain/built-in-stage-templates.js";
import { gate, scriptStage } from "../domain/stage.fixtures.js";
import type { StageTemplate } from "../domain/stage-template.js";
import { PipelineLibraryModule } from "../pipeline-library.module.js";
import { StageTemplateRepository } from "../ports/stage-template-repository.js";
import { StageTemplateLibrary } from "./stage-template-library.js";

// The test database is shared by every test file: these add templates of their own and never
// change the built-ins, which others read.

let app: INestApplication;
let library: StageTemplateLibrary;
let repository: StageTemplateRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({ database: true, imports: [PipelineLibraryModule] }));
  library = app.get(StageTemplateLibrary);
  repository = app.get(StageTemplateRepository);
});

afterAll(async () => {
  await app.close();
});

function aTemplate(): StageTemplate {
  const id = randomUUID();
  return { id, stage: scriptStage({ key: "build", name: `Build ${id}`, command: "build" }) };
}

describe("StageTemplateLibrary", () => {
  it("starts with the built-ins its migration seeded, in their order", async () => {
    const listed = await library.list();

    expect(listed.slice(0, builtInStageTemplates.length)).toEqual(builtInStageTemplates);
  });

  it("seeds nothing more when its migrations' seeds run again", async () => {
    const migrations = await Promise.all(
      [
        "0107_stage_templates.sql",
        "0172_conflict_resolution_tasks.sql",
        "0179_test_targets_set_up.sql",
        "0207_resolve_stage_template.sql",
      ].map((file) => readFile(new URL(`../../../../drizzle/${file}`, import.meta.url), "utf8")),
    );
    const seed = migrations
      .flatMap((migration) => migration.split("--> statement-breakpoint"))
      .map((statement) => statement.trim())
      .filter((statement) => statement.includes('INSERT INTO "stage_templates"'));
    const database = app.get<Database>(DATABASE);

    const results = await Promise.all(seed.map((insert) => database.execute(sql.raw(insert))));

    expect(seed).toHaveLength(builtInStageTemplates.length);
    expect(results.map(({ rowCount }) => rowCount)).toEqual(seed.map(() => 0));
    expect((await library.list()).slice(0, builtInStageTemplates.length)).toEqual(
      builtInStageTemplates,
    );
  });

  it("lists a template added later after the built-ins, and reads it as saved until removed", async () => {
    const added = aTemplate();
    await repository.add(added);

    const ids = (await library.list()).map(({ id }) => id);
    expect(ids.indexOf(added.id)).toBeGreaterThanOrEqual(builtInStageTemplates.length);

    const saved = { ...added, stage: gate({ name: `Look ${added.id}` }) };
    await repository.save(saved);
    await expect(library.find(added.id)).resolves.toEqual(saved);

    await repository.remove(added.id);
    await expect(library.find(added.id)).resolves.toBeUndefined();
  });

  it("refuses a second template of the same name in any case", async () => {
    const first = aTemplate();
    await repository.add(first);

    await expect(
      repository.add({
        ...aTemplate(),
        stage: { ...first.stage, name: first.stage.name.toUpperCase() },
      }),
    ).rejects.toMatchObject({ cause: { constraint: "stage_templates_name" } });
  });
});
