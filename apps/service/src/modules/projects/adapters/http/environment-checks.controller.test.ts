import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  environmentCheckSchema,
  latestEnvironmentCheckSchema,
  projectRefusalSchema,
  projectSchema,
  projectWebEventSchema,
  type EnvironmentCheck,
  type NewProject,
  type Project,
  type ProjectEnvironment,
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
import { EnvironmentCheckFinished } from "../../domain/environment-check-events.js";
import { ProjectsModule } from "../../projects.module.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import { GitHubModule } from "../../../github/index.js";

// Real git and real commands, in the default shell of the system the tests run on.
let repository: TemporaryRepository;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

const PASSES = `node -e "process.exit(0)"`;
const FAILS = `node -e "process.exit(2)"`;
const NEEDS_GREETING = `node -e "process.exit(process.env.GREETING === 'hello' ? 0 : 1)"`;
const SLEEPS = `node -e "setTimeout(() => {}, 60000)"`;
const GREETING: ProjectEnvironment = {
  set: [{ name: "GREETING", value: "hello" }],
  unset: [],
  prependPath: [],
};

beforeAll(async () => {
  repository = await createTemporaryRepository();
  gitIn(repository.path, "fetch", "--quiet", "origin");
  gitIn(repository.path, "branch", "--quiet", "--set-upstream-to=origin/main", "main");
  officeData = join(repository.folder, "office-data");
});

afterAll(async () => {
  await repository.remove();
});

beforeEach(async () => {
  await startApplication();
});

afterEach(async () => {
  await app.close();
});

async function startApplication(): Promise<void> {
  ({ app, url } = await startTestApplication({
    database: true,
    imports: [
      EventsModule,
      EventStreamModule,
      TelemetryModule,
      OfficeDataModule.forRoot(officeData),
      ProjectsModule.register({
        imports: [PipelineLibraryModule, GitHubModule.register()],
        knownPipelines: PipelineLibrary,
      }),
    ],
  }));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
}

function send(method: "GET" | "POST", path: string, body?: unknown): Promise<Response> {
  return fetch(`${url}/api${path}`, {
    method,
    headers: { "Content-Type": "application/json" },
    ...(body !== undefined && { body: JSON.stringify(body) }),
  });
}

/** A Project of the test's own name, since every test file shares the database. */
async function addProject(fields: Partial<NewProject> = {}): Promise<Project> {
  const newProject: NewProject = {
    name: `Checked ${randomUUID().slice(0, 8)}`,
    path: repository.path,
    baseBranch: "main",
    mark: { label: "CH", colour: "teal" },
    commands: { install: PASSES, build: PASSES, lint: PASSES, test: NEEDS_GREETING },
    installInputs: [],
    publishingMode: "push-and-pull-request",
    defaultPipeline: "full",
    ...fields,
  };
  const response = await send("POST", "/projects", newProject);
  expect(response.status).toBe(201);
  return projectSchema.parse(await response.json());
}

/** Starts a check and waits for it to finish. */
async function checked(
  project: Project,
  environment: ProjectEnvironment = GREETING,
): Promise<EnvironmentCheck> {
  const finished = new Promise<void>((resolve) => {
    const unsubscribe = app.get(EventBus).subscribe(EnvironmentCheckFinished, (event) => {
      if (event.check.projectId !== project.id) return;
      unsubscribe();
      resolve();
    });
  });
  const response = await send("POST", `/projects/${project.id}/environment-check`, {
    environment,
  });
  expect(response.status).toBe(202);
  await finished;
  return latest(project);
}

async function latest(project: Project): Promise<EnvironmentCheck> {
  const response = await send("GET", `/projects/${project.id}/environment-check`);
  const { check } = latestEnvironmentCheckSchema.parse(await response.json());
  if (!check) throw new Error(`No environment check for ${project.id}`);
  return check;
}

async function environmentOf(project: Project): Promise<ProjectEnvironment> {
  const response = await send("GET", `/projects/${project.id}`);
  return projectSchema.parse(await response.json()).environment;
}

async function throwawayWorktrees(project: Project): Promise<string[]> {
  const names = await readdir(join(officeData, "worktrees", project.id)).catch(() => []);
  return names.filter((name) => name.startsWith("_"));
}

/** The check's steps with their states, in order. */
function states(check: EnvironmentCheck): [string, string][] {
  return check.checks.map((each) => [each.step, each.state]);
}

/** A check runs git and five commands, which take a few seconds on Windows. */
const CHECK_TIMEOUT = { timeout: 30_000 };

describe("POST /api/projects/:id/environment-check", CHECK_TIMEOUT, () => {
  it("runs every check in a fresh worktree of the fetched base and saves the environment", async () => {
    const fetched = await commitOnOrigin(repository, "main", `checked-${randomUUID()}.txt`);
    const project = await addProject();
    published = [];

    const check = await checked(project);

    expect(check.state).toBe("passed");
    expect(check.checks[0]).toEqual({
      step: "worktree",
      state: "passed",
      base: { commit: fetched, fetchedFrom: "origin/main" },
    });
    expect(check.checks.slice(1)).toEqual(
      ["install", "build", "lint", "test"].map((step) =>
        expect.objectContaining({
          step,
          state: "passed",
          run: expect.objectContaining({ outcome: "passed", exitCode: 0 }),
        }),
      ),
    );
    await expect(environmentOf(project)).resolves.toEqual(GREETING);
    expect(await throwawayWorktrees(project)).toEqual([]);
    const webEvents = published.map((event) =>
      projectWebEventSchema.parse(app.get(WebEventForwarding).toWebEvent(event)),
    );
    expect(webEvents.map((event) => event.type)).toEqual([
      "project.environment-check-changed",
      ...Array<string>(10).fill("project.environment-check-changed"),
      "project.environment-changed",
      "project.environment-check-changed",
    ]);
  });

  it("keeps the environment when a check fails, and still runs the others", async () => {
    const project = await addProject({
      commands: { install: PASSES, build: PASSES, lint: FAILS, test: PASSES },
    });

    const check = await checked(project);

    expect(check.state).toBe("failed");
    expect(states(check)).toEqual([
      ["worktree", "passed"],
      ["install", "passed"],
      ["build", "passed"],
      ["lint", "failed"],
      ["test", "passed"],
    ]);
    expect(check.checks[3]).toMatchObject({ run: { outcome: "failed", exitCode: 2 } });
    await expect(environmentOf(project)).resolves.toEqual({ set: [], unset: [], prependPath: [] });
  });

  it("skips the rest when the install fails", async () => {
    const project = await addProject({
      commands: { install: FAILS, build: PASSES, lint: PASSES, test: PASSES },
    });

    const check = await checked(project);

    expect(states(check)).toEqual([
      ["worktree", "passed"],
      ["install", "failed"],
      ["build", "skipped"],
      ["lint", "skipped"],
      ["test", "skipped"],
    ]);
  });

  it("says when the base branch tracks no remote branch and is used unfetched", async () => {
    gitIn(repository.path, "branch", "--quiet", "--force", "untracked-base", "main");
    const project = await addProject({ baseBranch: "untracked-base" });

    const check = await checked(project);

    expect(check.checks[0]).toEqual({
      step: "worktree",
      state: "passed",
      base: { commit: gitIn(repository.path, "rev-parse", "untracked-base") },
    });
  });

  it("says what the Office identity lacks when the fetch fails", async () => {
    // Nothing listens on port 1, and The Office trusts no key of 127.0.0.1.
    gitIn(repository.path, "remote", "add", "unreachable", "ssh://git@127.0.0.1:1/repo.git");
    gitIn(repository.path, "branch", "--quiet", "--force", "unreachable-base", "main");
    gitIn(repository.path, "config", "branch.unreachable-base.remote", "unreachable");
    gitIn(repository.path, "config", "branch.unreachable-base.merge", "refs/heads/main");
    const project = await addProject({ baseBranch: "unreachable-base" });

    try {
      const check = await checked(project);

      expect(check.checks[0]).toMatchObject({ step: "worktree", state: "failed" });
      expect(check.checks[0]).toHaveProperty(
        "problem",
        expect.stringMatching(
          /^The Office doesn't trust 127\.0\.0\.1's host key yet: confirm its fingerprint in Settings › Office identity\. git fetch failed/,
        ),
      );
    } finally {
      gitIn(repository.path, "remote", "remove", "unreachable");
    }
  });

  it("refuses an environment that breaks a rule, and a second check while one runs", async () => {
    const project = await addProject({
      commands: { install: PASSES, build: PASSES, lint: PASSES, test: SLEEPS },
    });

    const refused = await send("POST", `/projects/${project.id}/environment-check`, {
      environment: { set: [{ name: "A=B", value: "" }], unset: [], prependPath: ["relative"] },
    });
    expect(refused.status).toBe(422);
    expect(projectRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "A variable's name can't have \"=\" in it: A=B.",
      'A folder put in front of PATH is a full path; "relative" is not.',
    ]);

    const started = await send("POST", `/projects/${project.id}/environment-check`, {
      environment: GREETING,
    });
    expect(environmentCheckSchema.parse(await started.json()).state).toBe("running");
    const second = await send("POST", `/projects/${project.id}/environment-check`, {
      environment: GREETING,
    });
    expect(second.status).toBe(422);
    expect(projectRefusalSchema.parse(await second.json()).reasons).toEqual([
      "An environment check is already running for this Project.",
    ]);
  });

  it("stops a running check when The Office shuts down, and keeps it as stopped", async () => {
    const project = await addProject({
      commands: { install: PASSES, build: PASSES, lint: PASSES, test: SLEEPS },
    });
    await send("POST", `/projects/${project.id}/environment-check`, { environment: GREETING });
    await expect
      .poll(async () => (await latest(project)).checks[4]?.state, CHECK_TIMEOUT)
      .toBe("running");

    await app.close();
    await startApplication();

    const check = await latest(project);
    expect(check.state).toBe("stopped");
    expect(check.checks[4]).toMatchObject({ state: "failed", run: { outcome: "stopped" } });
    await expect(environmentOf(project)).resolves.toEqual({ set: [], unset: [], prependPath: [] });
    expect(await throwawayWorktrees(project)).toEqual([]);
  });
});

describe("GET /api/projects/:id/environment-check", () => {
  it("answers no check for a Project never checked, and 404 for one that doesn't exist", async () => {
    const project = await addProject();

    const response = await send("GET", `/projects/${project.id}/environment-check`);
    expect(latestEnvironmentCheckSchema.parse(await response.json())).toEqual({ check: null });
    const missing = await send("GET", "/projects/nowhere/environment-check");
    expect(missing.status).toBe(404);
  });
});
