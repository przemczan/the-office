import { randomUUID } from "node:crypto";
import { join } from "node:path";
import type { INestApplication } from "@nestjs/common";
import {
  environmentCheckSchema,
  latestEnvironmentCheckSchema,
  projectRefusalSchema,
  projectSchema,
  projectWebEventSchema,
} from "@the-office/contracts";
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { DomainEvent } from "../../../../platform/events/domain-event.js";
import { EventBus } from "../../../../platform/events/event-bus.js";
import { WebEventForwarding } from "../../../../platform/websocket/web-event-forwarding.js";
import { BusyWorkChanged } from "../../../busy-work/index.js";
import { EnvironmentCheckFinished } from "../../domain/environment-check-events.js";
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
import { EnvironmentChecks } from "../../application/environment-checks.js";
import { TaskRunEnvironments } from "../../application/task-run-environments.js";
import { ScriptedTaskRunEnvironments } from "../../application/task-run-environments.fixtures.js";
import { CommandRunner } from "../../ports/command-runner.js";
import { startProjectsApplication } from "../../projects.controller.fixtures.js";

// Real git and real commands, in the default shell of the system the tests run on.
let repository: TemporaryRepository;
let officeData: string;
let app: INestApplication;
let url: string;
let published: DomainEvent[];

const { send, addProject, save, checked, environmentOf, throwawayWorktrees } =
  environmentChecksHttp(() => ({ app, url, repository, officeData }));

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
  it("runs every check in a fresh worktree of the fetched base with the saved environment", async () => {
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
      "project.environment-changed",
      ...Array<string>(12).fill("project.environment-check-changed"),
    ]);
  });

  it("checks a Task's branch when the body names the Task, and refuses one whose branch the Project doesn't have", async () => {
    // Run environments' runner stood in for: the Task sets nothing up, so Off runs on the host.
    app.get(TaskRunEnvironments).register(new ScriptedTaskRunEnvironments(app.get(CommandRunner)));
    const taskId = randomUUID();
    gitIn(repository.path, "branch", "--quiet", `office/${taskId}`, "main");
    const tip = gitIn(repository.path, "rev-parse", `office/${taskId}`);
    const project = await addProject();
    expect((await save(project, GREETING)).status).toBe(200);
    const finished = new Promise<void>((resolve) => {
      const unsubscribe = app.get(EventBus).subscribe(EnvironmentCheckFinished, (event) => {
        if (event.projectId !== project.id) return;
        unsubscribe();
        resolve();
      });
    });

    const started = await send("POST", `/projects/${project.id}/environment-check`, { taskId });

    expect(started.status).toBe(202);
    expect(environmentCheckSchema.parse(await started.json())).toMatchObject({
      taskId,
      state: "running",
    });
    await finished;
    const check = latestEnvironmentCheckSchema.parse(
      await (await send("GET", `/projects/${project.id}/environment-check`)).json(),
    ).check;
    expect(check).toMatchObject({ taskId, state: "passed" });
    expect(check?.checks[0]).toEqual({ step: "worktree", state: "passed", base: { commit: tip } });

    const other = randomUUID();
    const refused = await send("POST", `/projects/${project.id}/environment-check`, {
      taskId: other,
    });
    expect(refused.status).toBe(422);
    expect(projectRefusalSchema.parse(await refused.json()).reasons).toEqual([
      `The Task ${other} has no branch in the Project "${project.name}": check a Task of this Project once it has started.`,
    ]);

    const malformed = await send("POST", `/projects/${project.id}/environment-check`, {
      taskId: "not-a-task",
    });
    expect(malformed.status).toBe(400);
  });

  it("refuses a second check while one runs", async () => {
    const project = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES, rerunCommandLine: "" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES, rerunCommandLine: "" },
        { key: "test", name: "Test", kind: "test", commandLine: SLEEPS, rerunCommandLine: "" },
      ],
    });

    const started = await send("POST", `/projects/${project.id}/environment-check`);
    expect(environmentCheckSchema.parse(await started.json()).state).toBe("running");
    const second = await send("POST", `/projects/${project.id}/environment-check`);
    expect(second.status).toBe(422);
    expect(projectRefusalSchema.parse(await second.json()).reasons).toEqual([
      "An environment check is already running for this Project.",
    ]);
  });

  it("answers every Project's check at once: the one running now, else its last finished one", async () => {
    const finishedProject = await addProject({ installCommand: PASSES });
    const runningProject = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "test", name: "Test", kind: "test", commandLine: SLEEPS, rerunCommandLine: "" },
      ],
    });
    const idle = await addProject();
    const finished = await checked(finishedProject);
    await send("POST", `/projects/${runningProject.id}/environment-check`);

    const all = await app.get(EnvironmentChecks).latestOfAll();

    const of = (id: string) => all.filter(({ projectId }) => projectId === id);
    expect(of(finishedProject.id)).toMatchObject([
      { state: finished.state, projectId: finishedProject.id },
    ]);
    expect(of(runningProject.id)).toMatchObject([{ state: "running" }]);
    expect(of(idle.id)).toEqual([]);
  });

  it("gives a Secret variable to the commands, hides it in their output and never sends it back", async () => {
    // The command checks the value by its length, so the value itself is nowhere but in the variable.
    const printsToken = `node -e "console.log('token: ' + process.env.NPM_TOKEN); process.exit(process.env.NPM_TOKEN?.length === 10 ? 0 : 1)"`;
    const project = await addProject({
      installCommand: PASSES,
      commands: [
        { key: "build", name: "Build", kind: "build", commandLine: PASSES, rerunCommandLine: "" },
        { key: "lint", name: "Lint", kind: "lint", commandLine: PASSES, rerunCommandLine: "" },
        { key: "test", name: "Test", kind: "test", commandLine: printsToken, rerunCommandLine: "" },
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

    // Removed, it is gone, and the failed check leaves the environment as saved.
    const removed = await checked(project, { set: [], unset: [], prependPath: [] });
    expect(removed.state).toBe("failed");
    expect(removed.checks[4]).toMatchObject({
      run: { output: expect.stringContaining("token: undefined") as unknown },
    });
    await expect(environmentOf(project)).resolves.toEqual({ set: [], unset: [], prependPath: [] });
  });
});

describe("PUT /api/projects/:id/environment", () => {
  it("saves the environment at once, without a check, and announces it", async () => {
    const project = await addProject();
    published = [];

    const saved = await save(project, GREETING);

    expect(saved.status).toBe(200);
    expect(projectSchema.parse(await saved.json()).environment).toEqual(GREETING);
    await expect(environmentOf(project)).resolves.toEqual(GREETING);
    expect(published.map((event) => event.constructor.name)).toEqual(["ProjectEnvironmentChanged"]);
    const check = await send("GET", `/projects/${project.id}/environment-check`);
    expect(latestEnvironmentCheckSchema.parse(await check.json())).toEqual({ check: null });
  });

  it("refuses an environment that breaks a rule, saving nothing", async () => {
    const project = await addProject();

    const refused = await save(project, {
      set: [
        { name: "A=B", value: "", secret: false },
        { name: "SHORT", value: "12345", secret: true },
        { name: "TOKEN", value: "plain", secret: false },
        { name: "TOKEN", value: "a-secret-token", secret: true },
      ],
      unset: [],
      prependPath: ["relative"],
    });

    expect(refused.status).toBe(422);
    expect(projectRefusalSchema.parse(await refused.json()).reasons).toEqual([
      "A variable's name can't have \"=\" in it: A=B.",
      "The value of the Secret variable SHORT is shorter than 6 characters, so hiding it in output could hide ordinary text.",
      "TOKEN is both a plain and a Secret variable: make it one or the other.",
      'A folder put in front of PATH is a full path; "relative" is not.',
    ]);
    await expect(environmentOf(project)).resolves.toEqual({ set: [], unset: [], prependPath: [] });
  });
});
