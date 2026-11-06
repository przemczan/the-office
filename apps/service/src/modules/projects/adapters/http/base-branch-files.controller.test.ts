import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  baseBranchFetchSchema,
  baseBranchFolderSchema,
  projectRefusalSchema,
  projectSchema,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { GitHubModule } from "../../../github/index.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../../pipelines/index.js";
import { ProjectsModule } from "../../projects.module.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;
let commit: string;

beforeAll(async () => {
  repository = await createTemporaryRepository();
  commit = gitIn(repository.path, "rev-parse", "main");
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
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
  }));
  const newProject: NewProject = {
    name: `Shop ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "SH", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: ["package-lock.json"],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
  const added = await fetch(`${url}/api/projects`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(newProject),
  });
  project = projectSchema.parse(await added.json());
});

afterEach(async () => {
  await app.close();
});

function readFolder(commitId: string, query: string): Promise<Response> {
  return fetch(`${url}/api/projects/${project.id}/base-branch/${commitId}/folder${query}`);
}

describe("POST /projects/:id/base-branch/fetch", REAL_GIT_TEST, () => {
  it("answers the base branch's commit", async () => {
    const response = await fetch(`${url}/api/projects/${project.id}/base-branch/fetch`, {
      method: "POST",
    });

    expect(response.status).toBe(200);
    expect(baseBranchFetchSchema.parse(await response.json())).toEqual({
      commit,
      fetchProblem: null,
    });
  });

  it("answers 404 for a Project that doesn't exist", async () => {
    const response = await fetch(`${url}/api/projects/no-such-project/base-branch/fetch`, {
      method: "POST",
    });

    expect(response.status).toBe(404);
  });
});

describe("GET /projects/:id/base-branch/:commit/folder", REAL_GIT_TEST, () => {
  it("answers the top level with no query", async () => {
    const response = await readFolder(commit, "");

    expect(response.status).toBe(200);
    expect(baseBranchFolderSchema.parse(await response.json())).toEqual({
      commit,
      path: "",
      entries: [{ name: "src", kind: "folder" }],
      total: 1,
    });
  });

  it("reads the folder named, by the extensions joined by commas", async () => {
    const matching = await readFolder(commit, "?path=src&extensions=md,TS");
    const other = await readFolder(commit, "?path=src&extensions=md");

    expect(baseBranchFolderSchema.parse(await matching.json()).entries).toEqual([
      { name: "index.ts", kind: "file" },
    ]);
    expect(baseBranchFolderSchema.parse(await other.json()).entries).toEqual([]);
  });

  it.each([
    ["a commit that isn't an id", "main", ""],
    ["a commit it doesn't hold", "0123456789abcdef0123456789abcdef01234567", ""],
    ["a path that leaves the repository", undefined, "?path=src/../.."],
    ["a path that names no folder", undefined, "?path=src/index.ts"],
    ["git's own path words", undefined, `?path=${encodeURIComponent(":(nonsense)")}`],
  ])("refuses %s with reasons, not a server error", async (_, commitId, query) => {
    const response = await readFolder(commitId ?? commit, query);

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toHaveLength(1);
  });
});
