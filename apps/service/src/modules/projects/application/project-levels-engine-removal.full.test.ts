import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../test/test-application.js";
import { EventsModule } from "../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../platform/websocket/event-stream.module.js";
import { EngineReferenceMoves, FIRST_CLAUDE_CODE_ENGINE, type Engine } from "../../engine/index.js";
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
const CODEX: Engine = {
  id: `codex-${suffix}`,
  name: `Codex ${suffix}`,
  kind: "codex",
  defaultModel: "gpt-6-luna",
  defaultEffort: null,
  apiKey: null,
};
const ON_RACING = { default: { engineType: "claude-code", engineId: RACING.id } } as const;
const CTO_ON_CLAUDE = {
  roleKey: "cto",
  engineSettings: { "claude-code": { model: "claude-opus-5-5", effort: "max" } },
} as const;

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
        useValue: new EngineSettingsForTests({
          engines: [FIRST_CLAUDE_CODE_ENGINE, RACING, CODEX],
        }),
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
    installCommand: "npm ci",
    commands: [
      {
        key: "build",
        name: "Build",
        kind: "build",
        commandLine: "npm run build",
        rerunCommandLine: "",
      },
      {
        key: "lint",
        name: "Lint",
        kind: "lint",
        commandLine: "npm run lint",
        rerunCommandLine: "",
      },
      { key: "test", name: "Test", kind: "test", commandLine: "npm test", rerunCommandLine: "" },
    ],
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  });
}

function removeRacing(replacementId = FIRST_CLAUDE_CODE_ENGINE.id): Promise<unknown> {
  return app.get(EngineSettingsService).remove(RACING.id, replacementId);
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

    const saving = projects.changeEngine(project.id, ON_RACING);
    await hold.reached;
    let removed = false;
    const removing = removeRacing().then(() => (removed = true));
    await new Promise((resolve) => setImmediate(resolve));
    expect(removed).toBe(false);
    hold.release();
    await saving;
    await removing;

    expect((await projects.read(project.id)).engine.default).toEqual({
      engineType: "claude-code",
      engineId: FIRST_CLAUDE_CODE_ENGINE.id,
    });
  });

  it("is refused when the removal started first", async () => {
    const project = await aProjectOfItsOwn();
    const hold = aHold();
    app.get(EngineReferenceMoves).register({ movesOf: async () => [], move: hold.wait });

    const removing = removeRacing();
    await hold.reached;
    // Settled from now: the save is refused while the removal still announces itself.
    const saves = Promise.allSettled([projects.changeEngine(project.id, ON_RACING)]);
    hold.release();
    await removing;

    const noEngine = new ProjectRefused([`There is no engine "${RACING.id}".`]);
    expect(await saves).toEqual([{ status: "rejected", reason: noEngine }]);
    expect((await projects.engineLevelsOf(project.id)).default).toBeNull();
  });
});

describe("removing an engine a Project's default names", () => {
  it("previews the move it then makes, the people's settings staying", async () => {
    const { id, name } = await aProjectOfItsOwn();
    await projects.changeEngine(id, { ...ON_RACING, people: [CTO_ON_CLAUDE] });
    const settings = app.get(EngineSettingsService);

    const preview = await settings.removalPreview(RACING.id, FIRST_CLAUDE_CODE_ENGINE.id);
    await removeRacing();

    expect(preview).toEqual({
      moves: [
        {
          roleKey: null,
          project: { id, name },
          work: null,
          from: { engineId: RACING.id, model: RACING.defaultModel },
          to: {
            engineId: FIRST_CLAUDE_CODE_ENGINE.id,
            model: FIRST_CLAUDE_CODE_ENGINE.defaultModel,
          },
        },
      ],
      problems: [],
    });
    expect((await projects.read(id)).engine).toEqual({
      default: { engineType: "claude-code", engineId: FIRST_CLAUDE_CODE_ENGINE.id },
      force: null,
      people: [CTO_ON_CLAUDE],
    });
  });

  it("gives the default the replacement's type, the forced model it doesn't offer back to the engine's default", async () => {
    const { id } = await aProjectOfItsOwn();
    await projects.changeEngine(id, {
      ...ON_RACING,
      force: { model: "claude-opus-5-5", effort: "high" },
      people: [CTO_ON_CLAUDE],
    });

    await removeRacing(CODEX.id);

    expect((await projects.read(id)).engine).toEqual({
      default: { engineType: "codex", engineId: CODEX.id },
      force: { model: null, effort: "high" },
      people: [CTO_ON_CLAUDE],
    });
  });
});
