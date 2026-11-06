import { Readable } from "node:stream";
import { beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../platform/events/domain-event.js";
import { EventBus } from "../../../platform/events/event-bus.js";
import type { Project } from "../domain/project.js";
import { aProject } from "../domain/project.fixtures.js";
import type { ProjectChanges } from "../domain/project-changes.js";
import { ProjectImageChanged } from "../domain/project-events.js";
import { ProjectImageNotFound } from "../domain/project-image.js";
import { ProjectNotFound } from "../domain/project-not-found.js";
import { ProjectRefused } from "../domain/project-refused.js";
import { ProjectImageFiles } from "../ports/project-image-files.js";
import { ProjectRepository } from "../ports/project-repository.js";
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

let files: FilesInMemory;
let projects: ProjectsInMemory;
let published: DomainEvent[];
let images: ProjectImages;

beforeEach(() => {
  files = new FilesInMemory();
  projects = new ProjectsInMemory(aProject());
  published = [];
  const events = new EventBus();
  events.subscribeToEveryEvent((event) => void published.push(event));
  images = new ProjectImages(projects, files, events);
});

describe("changing an image", () => {
  it("keeps the file under the image's id, with the type read from its bytes", async () => {
    const project = await images.change("admin-panel", "icon", SVG);

    expect(project.icon?.mediaType).toBe("image/svg+xml");
    expect([...files.files.keys()]).toEqual([project.icon?.id]);
    expect(projects.stored.icon).toEqual(project.icon);
  });

  it("announces the change once it is kept", async () => {
    const project = await images.change("admin-panel", "logo", PNG);

    expect(published).toHaveLength(1);
    expect(published[0]).toBeInstanceOf(ProjectImageChanged);
    expect(published[0]).toMatchObject({ key: "logo", image: project.logo });
  });

  it("removes the replaced file, under a new id for the new one", async () => {
    const first = await images.change("admin-panel", "icon", PNG);
    const second = await images.change("admin-panel", "icon", SVG);

    expect(second.icon?.id).not.toBe(first.icon?.id);
    expect([...files.files.keys()]).toEqual([second.icon?.id]);
  });

  it("leaves the Project's other image and its file", async () => {
    const { logo } = await images.change("admin-panel", "logo", PNG);
    const { icon } = await images.change("admin-panel", "icon", PNG);

    await images.change("admin-panel", "icon", SVG);

    expect(projects.stored.logo).toEqual(logo);
    expect(files.files.has(logo?.id ?? "")).toBe(true);
    expect(files.files.has(icon?.id ?? "")).toBe(false);
  });

  it("refuses what isn't an image, keeping the image and writing nothing", async () => {
    const { icon } = await images.change("admin-panel", "icon", PNG);
    published = [];

    await expect(
      images.change("admin-panel", "icon", new TextEncoder().encode("not an image")),
    ).rejects.toThrow(ProjectRefused);

    expect(projects.stored.icon).toEqual(icon);
    expect([...files.files.keys()]).toEqual([icon?.id]);
    expect(published).toEqual([]);
  });

  it("leaves no new file when the update fails, and keeps the old one", async () => {
    const { icon } = await images.change("admin-panel", "icon", PNG);
    projects.failingUpdates = true;

    await expect(images.change("admin-panel", "icon", SVG)).rejects.toThrow("away");

    expect([...files.files.keys()]).toEqual([icon?.id]);
  });

  it("leaves no file for a Project that isn't there", async () => {
    await expect(images.change("nowhere", "icon", PNG)).rejects.toThrow(ProjectNotFound);

    expect(files.files.size).toBe(0);
  });

  it("keeps the change when the replaced file can't be removed", async () => {
    await images.change("admin-panel", "icon", PNG);
    const remove = files.remove.bind(files);
    files.remove = async () => {
      files.remove = remove;
      throw new Error("The disk is busy.");
    };

    const project = await images.change("admin-panel", "icon", SVG);

    expect(project.icon?.mediaType).toBe("image/svg+xml");
  });
});

describe("removing an image", () => {
  it("clears it and removes its file", async () => {
    await images.change("admin-panel", "icon", PNG);
    published = [];

    const project = await images.remove("admin-panel", "icon");

    expect(project.icon).toBeNull();
    expect(files.files.size).toBe(0);
    expect(published[0]).toMatchObject({ key: "icon", image: null });
  });

  it("changes nothing when the Project has none", async () => {
    await images.remove("admin-panel", "logo");

    expect(published).toEqual([]);
  });
});

describe("opening an image", () => {
  it("opens an image the Project holds", async () => {
    const { logo } = await images.change("admin-panel", "logo", PNG);

    const opened = await images.open("admin-panel", logo?.id ?? "");

    expect(opened.image).toEqual(logo);
  });

  it("answers for no image the Project no longer holds", async () => {
    const { icon } = await images.change("admin-panel", "icon", PNG);
    await images.remove("admin-panel", "icon");

    await expect(images.open("admin-panel", icon?.id ?? "")).rejects.toThrow(ProjectImageNotFound);
  });

  it("answers for no Project that isn't there", async () => {
    await expect(images.open("nowhere", "an-id")).rejects.toThrow(ProjectNotFound);
  });
});
