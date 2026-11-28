import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { baseBranchFetchSchema, projectRefusalSchema, type Project } from "@the-office/contracts";
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

function readFile(path: string): Promise<Response> {
  const query = `?path=${encodeURIComponent(path)}`;
  return fetch(`${url}/api/projects/${project.id}/commits/${commit}/file${query}`);
}

describe("GET /projects/:id/commits/:commit/file", REAL_GIT_TEST, () => {
  it("answers the file as plain text that can run nothing", async () => {
    const response = await readFile("src/index.ts");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox; frame-ancestors 'none'",
    );
    expect(await response.text()).toBe("export {};\n");
  });

  it("refuses a path outside the repository", async () => {
    const response = await readFile("../outside.txt");

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toHaveLength(1);
  });
});
