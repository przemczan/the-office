import { randomUUID } from "node:crypto";
import { stat } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  projectRefusalSchema,
  projectSchema,
  repositoryCloneSchema,
  repositoryCloneWebEventSchema,
  type NewProject,
  type RepositoryClone,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { EventsModule } from "../../../../platform/events/events.module.js";
import { OfficeDataModule } from "../../../../platform/office-data/office-data.module.js";
import { TelemetryModule } from "../../../../platform/telemetry/telemetry.module.js";
import { EventStreamModule } from "../../../../platform/websocket/event-stream.module.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { PipelineLibrary, PipelineLibraryModule } from "../../../pipelines/index.js";
import { RepositoryCloneFinished } from "../../domain/repository-clone-events.js";
import { ProjectsModule } from "../../projects.module.js";
import {
  createTemporaryRepository,
  gitIn,
  REAL_GIT_TEST,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";

const HOST = "https://git.example.test/acme/";
/** Where `${HOST}missing` really goes: https to a port nothing answers on. */
const UNANSWERED = "https://127.0.0.1:1/acme/missing";

/**
 * Git config, as the user's global config could hold it, that reads a URL on the made-up host as
 * the bare repository of that name beside the test's repository, since a Repository URL is never
 * a local path.
 */
function madeUpHostConfig(folder: string): Record<string, string> {
  const local = `${folder.replaceAll("\\", "/")}/`;
  const insteadOf: [string, string][] = [
    [local, HOST],
    // insteadOf is case-sensitive, as Linux's file names are.
    [`${local}origin.git`, `${HOST}Origin.git`],
    [UNANSWERED, `${HOST}missing`],
  ];
  return Object.fromEntries([
    ["GIT_CONFIG_COUNT", String(insteadOf.length)],
    ...insteadOf.flatMap(([to, from], index) => [
      [`GIT_CONFIG_KEY_${index}`, `url.${to}.insteadOf`],
      [`GIT_CONFIG_VALUE_${index}`, from],
    ]),
  ]);
}

let repository: TemporaryRepository;
let madeUpHost: Record<string, string>;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

beforeAll(async () => {
  repository = await createTemporaryRepository();
  officeData = join(repository.folder, "office-data");
  gitIn(repository.folder, "init", "--quiet", "--bare", "empty.git");
  gitIn(repository.folder, "clone", "--quiet", "--bare", repository.path, "shop.git");
  gitIn(join(repository.folder, "shop.git"), "branch", "release", "main");
  gitIn(repository.folder, "clone", "--quiet", "--bare", repository.path, "store.git");
  madeUpHost = madeUpHostConfig(repository.folder);
  Object.assign(process.env, madeUpHost);
});

afterAll(async () => {
  for (const name of Object.keys(madeUpHost)) delete process.env[name];
  await repository.remove();
});

beforeEach(async () => {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ProjectsModule.register({
        imports: [PipelineLibraryModule],
        knownPipelines: PipelineLibrary,
      }),
    ],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
});

afterEach(async () => {
  await app.close();
});

function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/** Starts a clone of `repositoryUrl` and waits for it to finish. */
async function cloned(repositoryUrl: string): Promise<RepositoryClone> {
  const finished = new Promise<string>((resolve) => {
    const unsubscribe = app.get(EventBus).subscribe(RepositoryCloneFinished, (event) => {
      unsubscribe();
      resolve(event.clone.id);
    });
  });
  const response = await send("POST", "/repositories/clones", { url: repositoryUrl });
  expect(response.status).toBe(202);
  const started = repositoryCloneSchema.parse(await response.json());
  expect(started.state).toBe("cloning");
  expect(await finished).toBe(started.id);
  return read(started.id);
}

async function read(cloneId: string): Promise<RepositoryClone> {
  const response = await send("GET", `/repositories/clones/${cloneId}`);
  expect(response.status).toBe(200);
  return repositoryCloneSchema.parse(await response.json());
}

async function refusalOf(repositoryUrl: string): Promise<readonly string[]> {
  const response = await send("POST", "/repositories/clones", { url: repositoryUrl });
  expect(response.status).toBe(422);
  return projectRefusalSchema.parse(await response.json()).reasons;
}

const clonePath = (...names: string[]) =>
  join(officeData, "repositories", "git.example.test", "acme", ...names);

function aClonedProject(path: string, repositoryUrl: string, baseBranch: string): NewProject {
  return {
    name: `Cloned ${randomUUID().slice(0, 8)}`,
    path,
    repositoryUrl,
    baseBranch,
    mark: { label: "CL", colour: "teal" },
    commands: { install: "npm ci", build: "npm run build", lint: "npm run lint", test: "npm test" },
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
  };
}

describe("POST /api/repositories/clones", REAL_GIT_TEST, () => {
  it("clones into the repositories folder, then tells the remote's branches", async () => {
    const clone = await cloned(`${HOST}origin`);

    expect(clone).toMatchObject({
      state: "cloned",
      url: `${HOST}origin`,
      path: clonePath("origin"),
      defaultBranch: "main",
      branches: ["main"],
    });
    expect(gitIn(clonePath("origin"), "rev-parse", "HEAD")).toBe(
      gitIn(repository.path, "rev-parse", "main"),
    );
    const forwarding = app.get(WebEventForwarding);
    const webEvents = published
      .map((event) => forwarding.toWebEvent(event))
      .filter((event) => event !== undefined)
      .map((event) => repositoryCloneWebEventSchema.parse(event));
    expect(webEvents.length).toBeGreaterThanOrEqual(2);
    expect(new Set(webEvents.map((event) => event.cloneId))).toEqual(new Set([clone.id]));
  });

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

  it("fails, leaving no folder, when the repository can't be read", async () => {
    const clone = await cloned(`${HOST}missing`);

    expect(clone).toMatchObject({
      state: "failed",
      // Told of the host git really reaches, after insteadOf.
      problem:
        "127.0.0.1 is reached anonymously over https, so only a public repository can be fetched.",
    });
    expect(await stat(clonePath("missing")).catch(() => undefined)).toBeUndefined();
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
