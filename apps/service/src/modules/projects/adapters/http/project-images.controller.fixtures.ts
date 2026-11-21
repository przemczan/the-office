import { randomUUID } from "node:crypto";
import { access, mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  IMAGE_UPLOAD_BYTES,
  projectRefusalSchema,
  projectSchema,
  type NewProject,
  type Project,
} from "@the-office/contracts";
import { expect } from "vitest";
import {
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

export const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3);
/** A PNG's signature, then bytes that are no UTF-8. */
export const BINARY_PNG = Uint8Array.of(
  0x89,
  0x50,
  0x4e,
  0x47,
  0x0d,
  0x0a,
  0x1a,
  0x0a,
  0xff,
  0xfe,
  0,
  0x80,
);
export const SVG_WITH_A_SCRIPT = new TextEncoder().encode(
  "<?xml version='1.0'?><svg xmlns='http://www.w3.org/2000/svg'><script>alert(1)</script></svg>",
);

/** The files of `images/` in `repository`, committed; answers the commit. */
export async function commitImages(
  repository: TemporaryRepository,
  files: Readonly<Record<string, Uint8Array | string>>,
): Promise<string> {
  await mkdir(join(repository.path, "images"), { recursive: true });
  for (const [name, content] of Object.entries(files)) {
    await writeFile(join(repository.path, "images", name), content);
  }
  gitIn(repository.path, "add", ".");
  gitIn(repository.path, "commit", "--quiet", "--message", "Change the images");
  return gitIn(repository.path, "rev-parse", "HEAD");
}

/** A temporary repository with images of every kind the tests choose from committed. */
export async function anImagesRepository(): Promise<{
  repository: TemporaryRepository;
  commit: string;
}> {
  const repository = await createTemporaryRepository();
  const atTheLimit = new Uint8Array(IMAGE_UPLOAD_BYTES);
  atTheLimit.set(BINARY_PNG);
  const overIt = new Uint8Array(IMAGE_UPLOAD_BYTES + 1);
  overIt.set(BINARY_PNG);
  const commit = await commitImages(repository, {
    "icon.png": BINARY_PNG,
    "logo.svg": SVG_WITH_A_SCRIPT,
    "fake.png": "<html>a page</html>",
    "empty.png": "",
    "at-the-limit.png": atTheLimit,
    "over-it.png": overIt,
  });
  return { repository, commit };
}

async function expectRefused(response: Response, reasons: readonly unknown[]): Promise<void> {
  expect(response.status).toBe(422);
  expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual(reasons);
}

async function expectGone(path: string): Promise<void> {
  await expect(access(path)).rejects.toThrow("ENOENT");
}

/**
 * The requests the Project images routes' tests share, on the app and Project `current` gives. A
 * `version` is the image and its palette as the routes name them, such as `icon/light`.
 */
export function projectImagesHttp(
  current: () => {
    readonly url: string;
    readonly repository: TemporaryRepository;
    readonly project: Project;
    readonly commit: string;
  },
) {
  function officeData(): string {
    return join(current().repository.folder, "office-data");
  }

  function pathOfFile(imageId: string): string {
    return join(officeData(), "project-images", imageId);
  }

  async function addProject(path = current().repository.path): Promise<Project> {
    const newProject: NewProject = {
      name: `Imaged ${randomUUID().slice(0, 8)}`,
      path,
      baseBranch: "main",
      mark: { label: "IM", colour: "teal" },
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
      installInputs: [],
      publishingMode: "push-and-pull-request",
      defaultPipeline: "full",
    };
    const response = await fetch(`${current().url}/api/projects`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(newProject),
    });
    return projectSchema.parse(await response.json());
  }

  function upload(
    version: string,
    content: Uint8Array,
    id = current().project.id,
  ): Promise<Response> {
    return fetch(`${current().url}/api/projects/${id}/images/${version}`, {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: content,
    });
  }

  async function uploaded(version: string, content: Uint8Array): Promise<Project> {
    const response = await upload(version, content);
    expect(response.status).toBe(201);
    return projectSchema.parse(await response.json());
  }

  function choose(version: string, file: unknown, id = current().project.id): Promise<Response> {
    return fetch(`${current().url}/api/projects/${id}/images/${version}/from-repository`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(file),
    });
  }

  async function chosen(version: string, path: string, at = current().commit): Promise<Project> {
    const response = await choose(version, { commit: at, path });
    expect(response.status).toBe(201);
    return projectSchema.parse(await response.json());
  }

  function contentOf(imageId: string | undefined, id = current().project.id): Promise<Response> {
    return fetch(`${current().url}/api/projects/${id}/images/${imageId}/content`);
  }

  async function bytesOf(imageId: string | undefined): Promise<Uint8Array> {
    return new Uint8Array(await (await contentOf(imageId)).arrayBuffer());
  }

  function removeImage(version: string): Promise<Response> {
    return fetch(`${current().url}/api/projects/${current().project.id}/images/${version}`, {
      method: "DELETE",
    });
  }

  async function stored(): Promise<Project> {
    const response = await fetch(`${current().url}/api/projects/${current().project.id}`);
    return projectSchema.parse(await response.json());
  }

  return {
    commitImages: (files: Readonly<Record<string, Uint8Array | string>>) =>
      commitImages(current().repository, files),
    officeData,
    pathOfFile,
    addProject,
    upload,
    uploaded,
    choose,
    chosen,
    expectRefused,
    bytesOf,
    removeImage,
    contentOf,
    stored,
    expectGone,
  };
}
