import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { baseBranchFolderSchema, projectRefusalSchema, type Project } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;
let commit: string;

const { addProject } = projectsHttp(() => ({ app, url, published: [], repository }));

beforeAll(async () => {
  repository = await createTemporaryRepository();
  commit = gitIn(repository.path, "rev-parse", "main");
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
  project = await addProject({
    name: `Shop ${randomUUID().slice(0, 8)}`,
    mark: { label: "SH", colour: "teal" },
  });
});

afterEach(async () => {
  await app.close();
});

function readFolder(commitId: string, query: string): Promise<Response> {
  return fetch(`${url}/api/projects/${project.id}/base-branch/${commitId}/folder${query}`);
}

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
