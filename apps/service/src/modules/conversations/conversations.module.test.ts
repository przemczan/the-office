import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../test/test-application.js";
import { EventsModule } from "../../platform/events/events.module.js";
import { OfficeDataModule } from "../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../platform/websocket/event-stream.module.js";
import { PipelineLibrary, PipelineLibraryModule } from "../pipelines/index.js";
import { EngineCascadeModule } from "../people/index.js";
import { WorkLevelsForTests, WorkLevelsForTestsModule } from "../people/index.fixtures.js";
import {
  BaseCheckouts,
  EngineLevelsChecks,
  ProjectRecords,
  ProjectService,
  ProjectsModule,
} from "../projects/index.js";
import { ConversationsModule } from "./conversations.module.js";
import { ProjectBases } from "./ports/project-bases.js";
import { GitHubModule } from "../github/index.js";

let app: INestApplication;
let officeData: string;

beforeAll(async () => {
  officeData = await mkdtemp(join(tmpdir(), "office-conversations-"));
  // As AppModule builds them: one Projects module, given to the engine cascade and Conversations.
  const projects = ProjectsModule.register({
    imports: [PipelineLibraryModule, GitHubModule.register()],
    knownPipelines: PipelineLibrary,
  });
  const engineCascade = EngineCascadeModule.register({
    imports: [projects, PipelineLibraryModule, WorkLevelsForTestsModule],
    knownProjectLevels: ProjectService,
    knownWorkLevels: WorkLevelsForTests,
    projectLevelsSaves: EngineLevelsChecks,
  });
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      projects,
      ConversationsModule.register({
        imports: [projects, engineCascade],
        projectBases: BaseCheckouts,
        projectOutputMasks: ProjectService,
        projectRecords: ProjectRecords,
      }),
    ],
  }));
});

afterAll(async () => {
  await app.close();
  await rm(officeData, { recursive: true, force: true });
});

describe("ConversationsModule", () => {
  it("reads the base checkouts of the one Projects module, so git keeps one set of locks", () => {
    const bases = app.get(ProjectBases, { strict: false });

    expect(bases).toBe(app.get(BaseCheckouts, { strict: false }));
    expect(bases.folder).toBe(join(officeData, "bases"));
  });
});
