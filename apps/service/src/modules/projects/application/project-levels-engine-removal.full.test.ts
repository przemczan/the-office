import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineReferenceMoves, FIRST_CLAUDE_CODE_ENGINE } from "../../engine/index.js";
import {
  EngineSettingsForTests,
  EngineSettingsRepository,
  EngineSettingsService,
} from "../../engine/index.fixtures.js";
import { GitHubModule } from "../../github/index.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../pipelines/index.js";
import {
  createTemporaryRepository,
  type TemporaryRepository,
} from "../adapters/git/temporary-repository.fixtures.js";
import type { Project } from "../domain/project.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectsModule } from "../projects.module.js";
import { EngineLevelsChecks } from "./engine-levels-checks.js";
import { ProjectService } from "./project-service.js";

// Engine settings of the test's own, so removing an engine leaves the shared database's alone;
// the Projects are in the shared database, so each test adds one of its own name.
const suffix = randomUUID().slice(0, 8);
const RACING = { ...FIRST_CLAUDE_CODE_ENGINE, id: `racing-${suffix}`, name: `Racing ${suffix}` };
const ON_RACING = { engineId: RACING.id, model: "claude-haiku-5-5" };

let repository: TemporaryRepository;
let app: INestApplication;
let projects: ProjectService;

beforeAll(async () => {
  repository = await createTemporaryRepository();
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(join(repository.folder, "office-data")),
      ProjectsModule.register({
        imports: [PipelineLibraryModule, GitHubModule.register()],
        knownPipelines: PipelineLibrary,
      }),
    ],
    overrides: [
      {
        provide: EngineSettingsRepository,
        useValue: new EngineSettingsForTests({ engines: [FIRST_CLAUDE_CODE_ENGINE, RACING] }),
      },
    ],
  }));
  projects = app.get(ProjectService);
});

afterEach(async () => {
  await app.close();
});

function aProjectOfItsOwn(): Promise<Project> {
  return projects.add({
    name: `Racing shop ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "RS", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  });
}

function removeRacing(): Promise<unknown> {
  return app.get(EngineSettingsService).remove(RACING.id, FIRST_CLAUDE_CODE_ENGINE.id);
}

/** A promise held until `release`, and one kept when something starts waiting on it. */
function aHold(): { reached: Promise<void>; wait: () => Promise<void>; release: () => void } {
  let reach!: () => void;
  const reached = new Promise<void>((resolve) => (reach = resolve));
  let release!: () => void;
  const released = new Promise<void>((resolve) => (release = resolve));
  return { reached, wait: () => (reach(), released), release };
}

describe("a Project level saved while an engine is removed", () => {
  it("is moved by the removal when the save started first, even though it is written after", async () => {
    const project = await aProjectOfItsOwn();
    const hold = aHold();
    app.get(EngineLevelsChecks).register(async () => (await hold.wait(), []));

    const saving = projects.changeProjectDefault(project.id, ON_RACING);
    await hold.reached;
    let removed = false;
    const removing = removeRacing().then(() => (removed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(removed).toBe(false);
    hold.release();
    await saving;
    await removing;

    expect((await projects.read(project.id)).projectDefault).toEqual({
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      model: "claude-haiku-5-5",
    });
  });

  it("is refused when the removal started first, as a Project default and a Role override", async () => {
    const project = await aProjectOfItsOwn();
    const hold = aHold();
    app.get(EngineReferenceMoves).register({ movesOf: async () => [], move: hold.wait });

    const removing = removeRacing();
    await hold.reached;
    const settingDefault = projects.changeProjectDefault(project.id, ON_RACING);
    const settingOverride = projects.changeRoleOverride(project.id, "developer", ON_RACING);
    // Settled from now: the saves are refused while the removal still announces itself.
    const saves = Promise.allSettled([settingDefault, settingOverride]);
    hold.release();
    await removing;

    const noEngine = new ProjectRefused([`There is no engine "${RACING.id}".`]);
    const refused = { status: "rejected", reason: noEngine };
    expect(await saves).toEqual([refused, refused]);
    const levels = await projects.engineLevelsOf(project.id);
    expect(levels).toMatchObject({ projectDefault: null, roleOverrides: [] });
  });
});

describe("removing an engine a Project's levels name", () => {
  it("previews the moves it then makes, the Project default and a Role override", async () => {
    const { id, name } = await aProjectOfItsOwn();
    await projects.changeProjectDefault(id, ON_RACING);
    await projects.changeRoleOverride(id, "developer", {
      engineId: RACING.id,
      model: "claude-opus-5-5",
    });
    const settings = app.get(EngineSettingsService);

    const preview = await settings.removalPreview(RACING.id, FIRST_CLAUDE_CODE_ENGINE.id);
    await removeRacing();

    const moved = await projects.read(id);
    const project = { id, name };
    expect(preview).toEqual({
      moves: [
        { roleKey: null, project, from: ON_RACING, to: moved.projectDefault },
        {
          roleKey: "developer",
          project,
          from: { engineId: RACING.id, model: "claude-opus-5-5" },
          to: { engineId: FIRST_CLAUDE_CODE_ENGINE.id, model: "claude-opus-5-5" },
        },
      ],
      problems: [],
    });
    expect(moved.projectDefault).toEqual({
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
      model: "claude-haiku-5-5",
    });
    expect(moved.roleOverrides).toEqual([expect.objectContaining(preview.moves[1]!.to)]);
  });
});
