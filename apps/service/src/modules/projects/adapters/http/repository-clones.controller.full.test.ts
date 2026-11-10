import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import { projectRefusalSchema, projectSchema } from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { ProjectsFromRepositories } from "../../application/projects-from-repositories.js";
import { ProjectRefused } from "../../domain/project-refused.js";
import {
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  aClonesRepository,
  HOST,
  repositoryClonesHttp,
} from "./repository-clones.controller.fixtures.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

let repository: TemporaryRepository;
let forgetMadeUpHost: () => void;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

const { send, cloned, refusalOf, clonePath, aClonedProject } = repositoryClonesHttp(() => ({
  app,
  url,
  officeData,
}));

beforeAll(async () => {
  ({ repository, officeData, forget: forgetMadeUpHost } = await aClonesRepository());
});

afterAll(async () => {
  forgetMadeUpHost();
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

describe("POST /api/repositories/clones", REAL_GIT_TEST, () => {
  it("uses a clone already there, fetched from the URL given last, and refuses a repository that is a Project", async () => {
    const again = await cloned(`${HOST}Origin.git`);
    expect(again).toMatchObject({ state: "cloned", path: clonePath("origin") });
    // As configured: `remote get-url` would apply insteadOf.
    expect(gitIn(clonePath("origin"), "config", "remote.origin.url")).toBe(`${HOST}Origin.git`);

    const project = aClonedProject(clonePath("origin"), `${HOST}Origin.git`, "main");
    const added = await send("POST", "/projects", project);
    expect(added.status).toBe(201);
    expect(projectSchema.parse(await added.json()).repositoryUrl).toBe(`${HOST}Origin.git`);

    expect(await refusalOf(`${HOST}origin`)).toEqual([
      `The repository is already the Project "${project.name}".`,
    ]);
  });

  it("adds a clone with a base branch only its remote had, which then tracks the remote's", async () => {
    const clone = await cloned(`${HOST}shop`);
    expect(clone).toMatchObject({ state: "cloned", defaultBranch: "main" });
    expect(gitIn(clone.path, "branch", "--list", "release")).toBe("");

    const added = await send(
      "POST",
      "/projects",
      aClonedProject(clone.path, `${HOST}shop`, "release"),
    );

    expect(added.status).toBe(201);
    expect(projectSchema.parse(await added.json())).toMatchObject({
      repositoryUrl: `${HOST}shop`,
      baseBranch: "release",
    });
    expect(gitIn(clone.path, "rev-parse", "--abbrev-ref", "release@{upstream}")).toBe(
      "origin/release",
    );
  });

  it("fetches a clone used again, so a branch made on the remote since can be the base branch", async () => {
    await cloned(`${HOST}store`);
    gitIn(join(repository.folder, "store.git"), "branch", "hotfix", "main");

    const again = await cloned(`${HOST}store`);
    expect(again).toMatchObject({ state: "cloned", path: clonePath("store") });
    expect(again.state === "cloned" && again.branches).toContain("hotfix");
    const added = await send(
      "POST",
      "/projects",
      aClonedProject(again.path, `${HOST}store`, "hotfix"),
    );

    expect(added.status).toBe(201);
  });

  it("refuses a Repository URL whose clone isn't the Project's path", async () => {
    const response = await send(
      "POST",
      "/projects",
      aClonedProject(repository.path, `${HOST}shop`, "main"),
    );

    expect(response.status).toBe(422);
    expect(projectRefusalSchema.parse(await response.json()).reasons).toEqual([
      `The clone of ${HOST}shop is at ${clonePath("shop")}, not ${repository.path}.`,
    ]);
  });

  it("fails on a repository without commits", async () => {
    await expect(cloned(`${HOST}empty`)).resolves.toMatchObject({
      state: "failed",
      problem: "The repository has no commits yet, so no branch to work from.",
    });
  });

  it("refuses another transport, and ssh before the Office ssh key is made", async () => {
    expect(await refusalOf("http://git.example.test/acme/origin")).toEqual([
      "The Office clones over https and ssh only, not http.",
    ]);
    expect(await refusalOf("git@git.example.test:acme/elsewhere.git")).toEqual([
      "The Office doesn't trust git.example.test's host key yet: confirm its fingerprint in Settings › Office identity.",
    ]);
  });
});

describe("GET /api/repositories/clones/:id", () => {
  it("answers 404 for a clone it doesn't know", async () => {
    const response = await send("GET", `/repositories/clones/${randomUUID()}`);
    expect(response.status).toBe(404);
  });
});

describe(
  "ProjectsFromRepositories, as a Proposal of a Project to onboard is applied",
  REAL_GIT_TEST,
  () => {
    it("judges a Project by Repository URL from the remote's branches, cloning nothing", async () => {
      const projects = app.get(ProjectsFromRepositories);
      const path = projects.clonePathOf(`${HOST}depot`);
      expect(path).toBe(clonePath("depot"));

      expect(
        await projects.newProjectProblems(aClonedProject(path, `${HOST}depot`, "main")),
      ).toEqual([]);
      expect(
        await projects.newProjectProblems(aClonedProject(path, `${HOST}depot`, "develop")),
      ).toEqual(['The repository has no branch "develop".']);
      expect(await stat(path).catch(() => undefined)).toBeUndefined();
    });

    it("clones a Project by Repository URL, waits for the clone, then adds it", async () => {
      const projects = app.get(ProjectsFromRepositories);
      const project = aClonedProject(clonePath("depot"), `${HOST}depot`, "main");

      const added = await projects.add(project);

      expect(added).toMatchObject({ name: project.name, repositoryUrl: `${HOST}depot` });
      expect(gitIn(clonePath("depot"), "rev-parse", "HEAD")).toBe(
        gitIn(repository.path, "rev-parse", "main"),
      );
      expect(await projects.findByPath(clonePath("depot"))).toMatchObject({ id: added.id });
    });

    it("refuses a Project whose clone fails, in the words the clone failed with", async () => {
      const projects = app.get(ProjectsFromRepositories);

      const refusal = await projects
        .add(aClonedProject(clonePath("missing"), `${HOST}missing`, "main"))
        .catch((error: unknown) => error);

      expect(refusal).toBeInstanceOf(ProjectRefused);
      expect(refusal instanceof ProjectRefused && refusal.reasons).toEqual([
        "127.0.0.1 is reached anonymously over https, so only a public repository can be fetched.",
      ]);
    });
  },
);
