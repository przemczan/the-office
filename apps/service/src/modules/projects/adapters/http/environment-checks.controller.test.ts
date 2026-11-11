import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  environmentCheckSchema,
  projectRefusalSchema,
  projectWebEventSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { BusyWorkChanged } from "../../../office-updates/index.js";
import {
  commitOnOrigin,
  createTemporaryRepository,
  gitIn,
  type TemporaryRepository,
} from "../git/temporary-repository.fixtures.js";
import {
  CHECK_TIMEOUT,
  environmentChecksHttp,
  GREETING,
  PASSES,
  SLEEPS,
} from "./environment-checks.controller.fixtures.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

// Real git and real commands, in the default shell of the system the tests run on.
let repository: TemporaryRepository;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

const { send, addProject, checked, environmentOf, throwawayWorktrees } = environmentChecksHttp(
  () => ({ app, url, repository, officeData }),
);

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
  ({ app, url } = await startProjectsApplication(repository));
  published = [];
  app.get(EventBus).subscribeToEveryEvent((event) => void published.push(event));
}

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
    expect(check.checks.slice(1)).toEqual([
      expect.objectContaining({
        step: "install",
        state: "passed",
        run: expect.objectContaining({ outcome: "passed", exitCode: 0 }),
      }),
      ...(["build", "lint", "test"] as const).map((key) =>
        expect.objectContaining({
          step: "command",
          key,
          kind: key,
          state: "passed",
          run: expect.objectContaining({ outcome: "passed", exitCode: 0 }),
        }),
      ),
    ]);
    await expect(environmentOf(project)).resolves.toEqual(GREETING);
    expect(await throwawayWorktrees(project)).toEqual([]);
    // A check is busy work too, but BusyWorkChanged stays inside the service while no update is scheduled.
    const webEvents = published
      .filter((event) => !(event instanceof BusyWorkChanged))
      .map((event) => projectWebEventSchema.parse(app.get(WebEventForwarding).toWebEvent(event)));
    expect(webEvents.map((event) => event.type)).toEqual([
      "project.environment-check-changed",
      ...Array<string>(10).fill("project.environment-check-changed"),
      "project.environment-changed",
      "project.environment-check-changed",
    ]);
  });

  it("refuses an environment that breaks a rule, and a second check while one runs", async () => {
    const project = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES },
        { key: "test", name: "Test", kind: "test", commandLine: SLEEPS },
      ],
    });

    const refused = await send("POST", `/projects/${project.id}/environment-check`, {
      environment: {
        set: [
          { name: "A=B", value: "", secret: false },
          { name: "SHORT", value: "12345", secret: true },
          { name: "TOKEN", value: "plain", secret: false },
          { name: "TOKEN", value: "a-secret-token", secret: true },
        ],
        unset: [],
        prependPath: ["relative"],
      },
    });
    expect(refused.status).toBe(422);
    expect(projectRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "A variable's name can't have \"=\" in it: A=B.",
      "The value of the Secret variable SHORT is shorter than 6 characters, so hiding it in output could hide ordinary text.",
      "TOKEN is both a plain and a Secret variable: make it one or the other.",
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

  it("gives a Secret variable to the commands, hides it in their output and never sends it back", async () => {
    // The command checks the value by its length, so the value itself is nowhere but in the variable.
    const printsToken = `node -e "console.log('token: ' + process.env.NPM_TOKEN); process.exit(process.env.NPM_TOKEN?.length === 10 ? 0 : 1)"`;
    const project = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES },
        { key: "test", name: "Test", kind: "test", commandLine: printsToken },
      ],
    });
    published = [];

    const check = await checked(project, {
      set: [{ name: "NPM_TOKEN", secret: true, value: "npm_s3cret" }],
      unset: [],
      prependPath: [],
    });

    expect(check.state).toBe("passed");
    expect(check.checks[4]).toMatchObject({
      run: { output: expect.stringContaining("token: [secret NPM_TOKEN]") as unknown },
    });
    const shown = {
      set: [{ name: "NPM_TOKEN", secret: true, valueSet: true }],
      unset: [],
      prependPath: [],
    };
    expect(check.environment).toEqual(shown);
    await expect(environmentOf(project)).resolves.toEqual(shown);
    expect(JSON.stringify(published)).not.toContain("npm_s3cret");
    expect(
      JSON.stringify(await (await send("GET", `/projects/${project.id}`)).json()),
    ).not.toContain("npm_s3cret");

    // Left out, the value is kept: the test still finds it.
    const again = await checked(project, {
      set: [{ name: "NPM_TOKEN", secret: true }],
      unset: [],
      prependPath: [],
    });
    expect(again.state).toBe("passed");
    await expect(environmentOf(project)).resolves.toEqual(shown);

    // Removed, it is gone.
    const removed = await checked(project, { set: [], unset: [], prependPath: [] });
    expect(removed.state).toBe("failed");
    expect(removed.checks[4]).toMatchObject({
      run: { output: expect.stringContaining("token: undefined") as unknown },
    });
  });
});
