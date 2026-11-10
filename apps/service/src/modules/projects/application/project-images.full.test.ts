import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import { IMAGE_SIZE_LIMIT } from "../../../platform/images/image-rules.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import type { ProjectChanges } from "../domain/project-changes.js";
import { ProjectImageChanged } from "../domain/project-events.js";
import { ProjectImageNotFound } from "../domain/project-image.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectImageFiles } from "../ports/project-image-files.js";
import { ProjectRepository } from "../ports/project-repository.js";
import type { BaseBranchFiles, FileSizeLimit } from "./base-branch-files.js";
import { ProjectImages } from "./project-images.js";

const PNG = Uint8Array.of(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a);
const SVG = new TextEncoder().encode("<svg/>");

class FilesInMemory extends ProjectImageFiles {
  readonly files = new Map<string, Uint8Array>();

  async save(imageId: string, content: Uint8Array): Promise<void> {
    this.files.set(imageId, content);
  }

  async open(imageId: string): Promise<Readable> {
    const content = this.files.get(imageId);
    if (!content) throw new Error("No such file.");
    return Readable.from([content]);
  }

  async remove(imageId: string): Promise<void> {
    this.files.delete(imageId);
  }
}

class ProjectsInMemory extends ProjectRepository {
  failingUpdates = false;

  constructor(public stored: Project) {
    super();
  }

  async add(): Promise<void> {
    throw new Error("Not used here.");
  }

  async find(id: string): Promise<Project | undefined> {
    return id === this.stored.id ? this.stored : undefined;
  }

  async list(): Promise<readonly Project[]> {
    return [this.stored];
  }

  async update(id: string, change: (project: Project) => ProjectChanges): Promise<ProjectChanges> {
    if (this.failingUpdates) throw new Error("The database is away.");
    if (id !== this.stored.id) throw new ProjectNotFound(id);
    const changed = change(this.stored);
    this.stored = changed.project;
    return changed;
  }
}

/** The repository's files by `<commit>:<path>`, refusing as `BaseBranchFiles.file` does. */
class RepositoryInMemory {
  readonly committed = new Map<string, Uint8Array>();
  limit: FileSizeLimit | undefined;

  async file(
    _projectId: string,
    commit: string,
    path: string,
    limit: FileSizeLimit,
  ): Promise<Uint8Array> {
    this.limit = limit;
    const content = this.committed.get(`${commit}:${path}`);
    if (!content) throw new ProjectRefused([`The repository has no file ${path} at this commit.`]);
    return content;
  }
}

let files: FilesInMemory;
let projects: ProjectsInMemory;
let published: DomainEvent[];
let repositoryFiles: RepositoryInMemory;
let images: ProjectImages;

beforeEach(() => {
  files = new FilesInMemory();
  projects = new ProjectsInMemory(aProject());
  published = [];
  const events = new EventBus();
  events.subscribeToEveryEvent((event) => void published.push(event));
  repositoryFiles = new RepositoryInMemory();
  images = new ProjectImages(
    projects,
    files,
    events,
    repositoryFiles as unknown as BaseBranchFiles,
  );
});

describe("changing an image", () => {
  it("keeps the file under the image's id, with the type read from its bytes", async () => {
    const project = await images.change("admin-panel", "icon", "light", SVG);

    expect(project.icon.light?.mediaType).toBe("image/svg+xml");
    expect([...files.files.keys()]).toEqual([project.icon.light?.id]);
    expect(projects.stored.icon).toEqual(project.icon);
  });

  it("announces the change once it is kept, naming the version", async () => {
    const project = await images.change("admin-panel", "logo", "dark", PNG);

    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ProjectImageChanged);
    expect(published[0]).toMatchObject({ key: "logo", palette: "dark", image: project.logo.dark });
  });

  it.each(["light", "dark"] as const)(
    "removes the replaced %s file, under a new id for the new one",
    async (palette) => {
      const first = await images.change("admin-panel", "icon", palette, PNG);
      const second = await images.change("admin-panel", "icon", palette, SVG);

      expect(second.icon[palette]?.id).not.toBe(first.icon[palette]?.id);
      expect([...files.files.keys()]).toEqual([second.icon[palette]?.id]);
    },
  );

  it("leaves the image's other version and its file", async () => {
    const { icon: before } = await images.change("admin-panel", "icon", "light", PNG);
    const { icon: held } = await images.change("admin-panel", "icon", "dark", PNG);

    const { icon } = await images.change("admin-panel", "icon", "dark", SVG);

    expect(icon.light).toEqual(before.light);
    expect(files.files.has(before.light?.id ?? "")).toBe(true);
    expect(files.files.has(held.dark?.id ?? "")).toBe(false);
  });

  it("leaves the Project's other image and its file", async () => {
    const { logo } = await images.change("admin-panel", "logo", "light", PNG);
    const { icon } = await images.change("admin-panel", "icon", "light", PNG);

    await images.change("admin-panel", "icon", "light", SVG);

    expect(projects.stored.logo).toEqual(logo);
    expect(files.files.has(logo.light?.id ?? "")).toBe(true);
    expect(files.files.has(icon.light?.id ?? "")).toBe(false);
  });

  it("refuses what isn't an image, keeping the image and writing nothing", async () => {
    const { icon } = await images.change("admin-panel", "icon", "light", PNG);
    published = [];

    await expect(
      images.change("admin-panel", "icon", "light", new TextEncoder().encode("not an image")),
    ).rejects.toThrow(ProjectRefused);

    expect(projects.stored.icon).toEqual(icon);
    expect([...files.files.keys()]).toEqual([icon.light?.id]);
    expect(published).toEqual([]);
  });

  it("leaves no new file when the update fails, and keeps the old one", async () => {
    const { icon } = await images.change("admin-panel", "icon", "light", PNG);
    projects.failingUpdates = true;

    await expect(images.change("admin-panel", "icon", "light", SVG)).rejects.toThrow("away");

    expect([...files.files.keys()]).toEqual([icon.light?.id]);
  });

  it("leaves no file for a Project that isn't there", async () => {
    await expect(images.change("nowhere", "icon", "light", PNG)).rejects.toThrow(ProjectNotFound);

    expect(files.files.size).toBe(0);
  });

  it("keeps the change when the replaced file can't be removed", async () => {
    await images.change("admin-panel", "icon", "light", PNG);
    const remove = files.remove.bind(files);
    files.remove = async () => {
      files.remove = remove;
      throw new Error("The disk is busy.");
    };

    const project = await images.change("admin-panel", "icon", "light", SVG);

    expect(project.icon.light?.mediaType).toBe("image/svg+xml");
  });
});

describe("changing an image from the repository", () => {
  const LOGO_FILE = { commit: "first", path: "assets/logo.svg" };

  beforeEach(() => {
    repositoryFiles.committed.set("first:assets/logo.svg", SVG);
  });

  it("keeps a copy as an upload does, under the image limit", async () => {
    const project = await images.changeFromRepository("admin-panel", "logo", "dark", LOGO_FILE);

    expect(project.logo.dark?.mediaType).toBe("image/svg+xml");
    expect(project.logo.light).toBeNull();
    expect(files.files.get(project.logo.dark?.id ?? "")).toEqual(SVG);
    expect(published[0]).toBeInstanceOf(ProjectImageChanged);
    expect(repositoryFiles.limit).toEqual({
      bytes: IMAGE_SIZE_LIMIT,
      problem: "An image may be at most 2 MB.",
    });
  });

  it("removes the image it replaces", async () => {
    const { logo } = await images.change("admin-panel", "logo", "light", PNG);

    const project = await images.changeFromRepository("admin-panel", "logo", "light", LOGO_FILE);

    expect([...files.files.keys()]).toEqual([project.logo.light?.id]);
    expect(project.logo.light?.id).not.toBe(logo.light?.id);
  });

  it("keeps the old image when the file can't be read", async () => {
    const { icon } = await images.change("admin-panel", "icon", "light", PNG);
    published = [];

    await expect(
      images.changeFromRepository("admin-panel", "icon", "light", {
        commit: "first",
        path: "gone.png",
      }),
    ).rejects.toThrow(ProjectRefused);

    expect(projects.stored.icon).toEqual(icon);
    expect([...files.files.keys()]).toEqual([icon.light?.id]);
    expect(published).toEqual([]);
  });

  it("keeps the old image when the file is no image, whatever its name", async () => {
    const { icon } = await images.change("admin-panel", "icon", "light", PNG);
    repositoryFiles.committed.set("first:fake.png", new TextEncoder().encode("not an image"));

    await expect(
      images.changeFromRepository("admin-panel", "icon", "light", {
        commit: "first",
        path: "fake.png",
      }),
    ).rejects.toThrow("The file isn't a PNG, JPEG, WebP or SVG image.");

    expect(projects.stored.icon).toEqual(icon);
    expect([...files.files.keys()]).toEqual([icon.light?.id]);
  });

  it("keeps the copy as it was when the file changes or goes from the repository", async () => {
    const { logo } = await images.changeFromRepository("admin-panel", "logo", "light", LOGO_FILE);

    repositoryFiles.committed.set("second:assets/logo.svg", PNG);
    repositoryFiles.committed.delete("first:assets/logo.svg");

    expect(projects.stored.logo).toEqual(logo);
    expect(files.files.get(logo.light?.id ?? "")).toEqual(SVG);
  });

  it("remembers nothing of where the image came from", async () => {
    const { logo } = await images.changeFromRepository("admin-panel", "logo", "light", LOGO_FILE);

    expect(Object.keys(logo.light ?? {}).toSorted()).toEqual(["id", "mediaType"]);
  });
});

describe("removing an image", () => {
  it.each(["light", "dark"] as const)(
    "clears the %s version and removes its file, leaving the other",
    async (palette) => {
      const other = palette === "light" ? "dark" : "light";
      const { icon: held } = await images.change("admin-panel", "icon", other, PNG);
      await images.change("admin-panel", "icon", palette, SVG);
      published = [];

      const project = await images.remove("admin-panel", "icon", palette);

      expect(project.icon).toEqual({ [palette]: null, [other]: held[other] });
      expect([...files.files.keys()]).toEqual([held[other]?.id]);
      expect(published[0]).toMatchObject({ key: "icon", palette, image: null });
    },
  );

  it("changes nothing when the Project has none", async () => {
    await images.remove("admin-panel", "logo", "light");

    expect(published).toEqual([]);
  });
});

describe("opening an image", () => {
  it.each(["light", "dark"] as const)("opens the %s version the Project holds", async (palette) => {
    const { logo } = await images.change("admin-panel", "logo", palette, PNG);

    const opened = await images.open("admin-panel", logo[palette]?.id ?? "");

    expect(opened.image).toEqual(logo[palette]);
  });

  it("answers for no image the Project no longer holds", async () => {
    const { icon } = await images.change("admin-panel", "icon", "dark", PNG);
    await images.remove("admin-panel", "icon", "dark");

    await expect(images.open("admin-panel", icon.dark?.id ?? "")).rejects.toThrow(
      ProjectImageNotFound,
    );
  });

  it("answers for no Project that isn't there", async () => {
    await expect(images.open("nowhere", "an-id")).rejects.toThrow(ProjectNotFound);
  });
});
