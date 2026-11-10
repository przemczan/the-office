import { access, readdir } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { projectRefusalSchema, type Project } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { TemporaryRepository } from "../git/temporary-repository.fixtures.js";
import {
  anImagesRepository,
  PNG,
  projectImagesHttp,
  SVG_WITH_A_SCRIPT,
} from "./project-images.controller.fixtures.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

let repository: TemporaryRepository;
let app: INestApplication;
let url: string;
let project: Project;
let commit: string;

const { pathOfFile, addProject, upload, uploaded, contentOf, stored, officeData } =
  projectImagesHttp(() => ({
    url,
    repository,
    project,
    commit,
  }));

beforeAll(async () => {
  ({ repository, commit } = await anImagesRepository());
});

afterAll(async () => {
  await repository.remove();
});

async function startService(): Promise<void> {
  ({ app, url } = await startProjectsApplication(repository));
}

beforeEach(async () => {
  await startService();
  project = await addProject();
});

afterEach(async () => {
  await app.close();
});

describe("a Project's images", () => {
  it("keeps an uploaded Icon, read by what its bytes are", async () => {
    const { icon, logo } = await uploaded("icon", PNG);

    expect(icon?.mediaType).toBe("image/png");
    expect(logo).toBeNull();
    expect((await stored()).icon).toEqual(icon);
    await expect(access(pathOfFile(icon?.id ?? ""))).resolves.toBeUndefined();
  });
});

describe("refusals", () => {
  it("refuses a file that is no image whatever is said of it, keeping the Project's", async () => {
    const { icon } = await uploaded("icon", PNG);

    const response = await upload("icon", new TextEncoder().encode("<html>a page</html>"));

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      "The file isn't a PNG, JPEG, WebP or SVG image.",
    ]);
    expect((await stored()).icon).toEqual(icon);
    expect(await readdir(join(officeData(), "project-images"))).toContain(icon?.id);
  });
});

describe("reading an image", () => {
  it("lets nothing in an SVG run or load when its address is opened", async () => {
    const { logo } = await uploaded("logo", SVG_WITH_A_SCRIPT);

    const { headers } = await contentOf(logo?.id);

    expect(headers.get("content-type")).toBe("image/svg+xml");
    expect(headers.get("x-content-type-options")).toBe("nosniff");
    expect(headers.get("content-security-policy")).toBe(
      "default-src 'none'; style-src 'unsafe-inline'; sandbox",
    );
  });
});
