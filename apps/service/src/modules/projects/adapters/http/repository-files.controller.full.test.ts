import { randomUUID } from "node:crypto";
import { writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  FILE_PREVIEW_BYTES,
  projectBranchesSchema,
  projectRefusalSchema,
  repositoryFilePreviewSchema,
  repositoryFolderSchema,
  type Project,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { projectsHttp, startProjectsApplication } from "../../projects.controller.fixtures.js";

const NO_SUCH_COMMIT = "0123456789abcdef0123456789abcdef01234567";
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0xff, 0xfe]);
const BINARY = Buffer.from([0x01, 0x02, 0x00, 0x03, 0xff]);
const SVG = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>';
const HTML = "<!doctype html><script>alert(1)</script>";
const CONTENT_SECURITY_POLICY = "default-src 'none'; style-src 'unsafe-inline'; sandbox";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;
/** `main` here, with every file below, pushed; the origin's `main` moves past it later. */
let commit: string;

const { addProject } = projectsHttp(() => ({ app, url, published: [], repository }));

beforeAll(async () => {
  repository = await createTemporaryRepository();
  const { path } = repository;
  await writeFile(join(path, "README.md"), "# Shop\n\nZażółć gęślą jaźń.\n");
  await writeFile(join(path, "picture.png"), PNG);
  await writeFile(join(path, "data.bin"), BINARY);
  await writeFile(join(path, "icon.svg"), SVG);
  await writeFile(join(path, "page.html"), HTML);
  await writeFile(join(path, 'Zażółć "notes".txt'), "notes");
  await writeFile(join(path, "big.txt"), "a".repeat(FILE_PREVIEW_BYTES + 1));
  gitIn(path, "add", ".");
  gitIn(path, "commit", "--quiet", "--message", "The files");
  gitIn(path, "push", "--quiet", "origin", "main");
  gitIn(path, "fetch", "--quiet", "origin");
  gitIn(path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  gitIn(path, "symbolic-ref", "refs/remotes/origin/HEAD", "refs/remotes/origin/main");
  gitIn(path, "branch", "--quiet", "feature");
  commit = gitIn(path, "rev-parse", "main");
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

function readBranches(query: string): Promise<Response> {
  return fetch(`${url}/api/projects/${project.id}/branches${query}`);
}

function readFolder(commitId: string, query: string): Promise<Response> {
  return fetch(`${url}/api/projects/${project.id}/commits/${commitId}/folder${query}`);
}

function readFile(commitId: string, path: string, download = false): Promise<Response> {
  const query = `?path=${encodeURIComponent(path)}${download ? "&download=1" : ""}`;
  return fetch(`${url}/api/projects/${project.id}/commits/${commitId}/file${query}`);
}

function readPreview(commitId: string, path: string): Promise<Response> {
  const query = `?path=${encodeURIComponent(path)}`;
  return fetch(`${url}/api/projects/${project.id}/commits/${commitId}/file-preview${query}`);
}

async function refusalOf(response: Response): Promise<string[]> {
  expect(response.status).toBe(422);
  return projectRefusalSchema.parse(await response.json()).reasons;
}

describe("GET /projects/:id/branches", REAL_GIT_TEST, () => {
  it("fetches the remote's branches, answering the base first at the fetched commit", async () => {
    const moved = await commitOnOrigin(repository, "main", "from-origin.txt");
    const remoteOnly = await commitOnOrigin(repository, "remote-only", "remote.txt");

    const response = await readBranches("?fetch=1");

    expect(response.status).toBe(200);
    expect(projectBranchesSchema.parse(await response.json())).toEqual({
      baseBranch: { name: "main", kind: "local", commit: moved },
      branches: [
        { name: "feature", kind: "local", commit },
        { name: "origin/main", kind: "remote", commit: moved },
        { name: "origin/remote-only", kind: "remote", commit: remoteOnly },
      ],
      fetchProblem: null,
    });
  });

  it("reads only what is known here without fetch", async () => {
    await commitOnOrigin(repository, "not-fetched", "not-fetched.txt");

    const { branches, fetchProblem } = projectBranchesSchema.parse(
      await (await readBranches("")).json(),
    );

    expect(branches.map(({ name }) => name)).not.toContain("origin/not-fetched");
    expect(branches.map(({ name }) => name)).toContain("feature");
    expect(fetchProblem).toBeNull();
  });

  it("answers the last commits known here, and why, when the fetch fails", async () => {
    const known = gitIn(repository.path, "rev-parse", "refs/remotes/origin/main");
    const originUrl = gitIn(repository.path, "remote", "get-url", "origin");
    gitIn(repository.path, "remote", "set-url", "origin", join(repository.folder, "gone.git"));
    try {
      const response = await readBranches("?fetch=1");

      expect(response.status).toBe(200);
      const branches = projectBranchesSchema.parse(await response.json());
      expect(branches.baseBranch).toEqual({ name: "main", kind: "local", commit: known });
      expect(branches.branches).toContainEqual({
        name: "origin/main",
        kind: "remote",
        commit: known,
      });
      expect(branches.fetchProblem).toContain("gone.git");
    } finally {
      gitIn(repository.path, "remote", "set-url", "origin", originUrl);
    }
  });

  it("refuses a fetch that is neither 0 nor 1", async () => {
    expect((await readBranches("?fetch=yes")).status).toBe(400);
  });
});

describe("GET /projects/:id/commits/:commit/folder", REAL_GIT_TEST, () => {
  it("answers the top level with no query", async () => {
    const response = await readFolder(commit, "");

    expect(response.status).toBe(200);
    const folder = repositoryFolderSchema.parse(await response.json());
    expect(folder.commit).toBe(commit);
    expect(folder.entries[0]).toEqual({ name: "src", kind: "folder" });
    expect(folder.entries.map(({ name }) => name)).toContain("README.md");
  });

  it("reads the folder named, by the extensions joined by commas", async () => {
    const matching = await readFolder(commit, "?path=src&extensions=md,TS");
    const other = await readFolder(commit, "?path=src&extensions=md");

    expect(repositoryFolderSchema.parse(await matching.json()).entries).toEqual([
      { name: "index.ts", kind: "file" },
    ]);
    expect(repositoryFolderSchema.parse(await other.json()).entries).toEqual([]);
  });

  it("no longer answers on the base branch's path", async () => {
    const response = await fetch(`${url}/api/projects/${project.id}/base-branch/${commit}/folder`);

    expect(response.status).toBe(404);
  });

  it.each([
    ["a commit that isn't an id", "main", ""],
    ["a commit it doesn't hold", NO_SUCH_COMMIT, ""],
    ["a path that leaves the repository", undefined, "?path=src/../.."],
    ["a path that names no folder", undefined, "?path=src/index.ts"],
    ["git's own path words", undefined, `?path=${encodeURIComponent(":(nonsense)")}`],
  ])("refuses %s with reasons, not a server error", async (_, commitId, query) => {
    await expect(refusalOf(await readFolder(commitId ?? commit, query))).resolves.toHaveLength(1);
  });
});

describe("GET /projects/:id/commits/:commit/file", REAL_GIT_TEST, () => {
  it("answers text as plain text, inline with its name, kept for good", async () => {
    const response = await readFile(commit, "README.md");

    expect(response.status).toBe(200);
    expect(response.headers.get("content-type")).toBe("text/plain; charset=utf-8");
    expect(response.headers.get("content-disposition")).toMatch(/^inline; filename="README.md"/);
    expect(response.headers.get("cache-control")).toBe("private, max-age=31536000, immutable");
    expect(await response.text()).toBe("# Shop\n\nZażółć gęślą jaźń.\n");
  });

  it("answers a picture by its bytes, exactly as committed", async () => {
    const response = await readFile(commit, "picture.png");

    expect(response.headers.get("content-type")).toBe("image/png");
    expect(Buffer.from(await response.arrayBuffer()).equals(PNG)).toBe(true);
  });

  it("answers what is neither text nor a picture as bytes", async () => {
    const response = await readFile(commit, "data.bin");

    expect(response.headers.get("content-type")).toBe("application/octet-stream");
    expect(Buffer.from(await response.arrayBuffer()).equals(BINARY)).toBe(true);
  });

  it("answers a download as an attachment with the file's name, any name", async () => {
    const response = await readFile(commit, 'Zażółć "notes".txt', true);

    expect(response.headers.get("content-disposition")).toBe(
      `attachment; filename="Za____ _notes_.txt"; filename*=UTF-8''${encodeURIComponent('Zażółć "notes".txt')}`,
    );
  });

  it("answers a file in a folder by its last name", async () => {
    const response = await readFile(commit, "src/index.ts", true);

    expect(response.headers.get("content-disposition")).toMatch(/^attachment; filename="index.ts"/);
  });

  it.each([
    ["an SVG", "icon.svg", "image/svg+xml"],
    ["an HTML file", "page.html", "text/plain; charset=utf-8"],
  ])("serves %s so no script of it can run", async (_, path, mediaType) => {
    const response = await readFile(commit, path);

    expect(response.headers.get("content-type")).toBe(mediaType);
    expect(response.headers.get("x-content-type-options")).toBe("nosniff");
    expect(response.headers.get("content-security-policy")).toBe(CONTENT_SECURITY_POLICY);
  });

  it.each([
    ["a path outside the repository", commit, "/etc/passwd"],
    ["a path leaving it", commit, "../secret.txt"],
    ["a folder", commit, "src"],
    ["no such file", commit, "nothing.txt"],
    ["an unknown commit", NO_SUCH_COMMIT, "README.md"],
    ["a commit that isn't an id", "main", "README.md"],
  ])("refuses %s with reasons", async (_, commitId, path) => {
    await expect(refusalOf(await readFile(commitId, path))).resolves.toHaveLength(1);
  });

  it("refuses a request without a path", async () => {
    const response = await fetch(`${url}/api/projects/${project.id}/commits/${commit}/file`);

    expect(response.status).toBe(400);
  });
});

describe("GET /projects/:id/commits/:commit/file-preview", REAL_GIT_TEST, () => {
  async function previewOf(path: string): Promise<unknown> {
    const response = await readPreview(commit, path);
    expect(response.status).toBe(200);
    return repositoryFilePreviewSchema.parse(await response.json());
  }

  it("answers text with its words", async () => {
    await expect(previewOf("README.md")).resolves.toEqual({
      kind: "text",
      size: Buffer.byteLength("# Shop\n\nZażółć gęślą jaźń.\n"),
      text: "# Shop\n\nZażółć gęślą jaźń.\n",
    });
  });

  it.each([
    ["a picture", "picture.png", { kind: "image", size: PNG.byteLength }],
    ["an SVG", "icon.svg", { kind: "image", size: Buffer.byteLength(SVG) }],
    ["bytes", "data.bin", { kind: "binary", size: BINARY.byteLength }],
    ["a file over 1 MB", "big.txt", { kind: "too-large", size: FILE_PREVIEW_BYTES + 1 }],
  ])("answers %s by its kind and size", async (_, path, preview) => {
    await expect(previewOf(path)).resolves.toEqual(preview);
  });

  it.each([
    ["a path leaving the repository", commit, "src/../../x"],
    ["an unknown commit", NO_SUCH_COMMIT, "README.md"],
    ["a folder", commit, "src"],
  ])("refuses %s with reasons", async (_, commitId, path) => {
    await expect(refusalOf(await readPreview(commitId, path))).resolves.toHaveLength(1);
  });
});
