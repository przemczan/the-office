import { access, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { OutputMask } from "../../projects/index.js";
import {
  NO_MASK,
  ScriptedContainerRuntime,
} from "../adapters/scripted/scripted-container-runtime.js";
import { RunEnvironmentRefused } from "../domain/run-environment-refused.js";
import {
  DEFAULT_RUN_ENVIRONMENT_OPTIONS,
  entryPointScript,
  hostedProjectNameOf,
} from "../domain/run-environment.js";
import type { HostedServiceStart } from "./hosted-services.js";
import {
  runEnvironmentsTestbed,
  taskIn,
  writeFiles,
  type RunEnvironmentsTestbed,
} from "./run-environments.fixtures.js";

const DEFINITION = {
  ".devcontainer/devcontainer.json": `{ "dockerComposeFile": "compose.yaml", "service": "app", "overrideCommand": true }`,
  ".devcontainer/compose.yaml":
    "services:\n  app:\n    image: node:22\n  postgres:\n    image: postgres:17\n    volumes:\n      - data:/var/lib/postgresql/data\nvolumes:\n  data: {}\n",
  "package-lock.json": '{ "lockfileVersion": 3 }',
};

const INSTANCE_ID = "6f1d2c3b-0a9e-4b8c-9d7f-1e2a3b4c5d6e";
const SECRET = "s3cret-token";

let runtime: ScriptedContainerRuntime;
let testbed: RunEnvironmentsTestbed;
let projectName: string;

async function launch(extra: Partial<HostedServiceStart> = {}): Promise<HostedServiceStart> {
  const checkout = join(testbed.folder, "test-instances", INSTANCE_ID);
  await writeFiles(checkout, DEFINITION);
  return {
    instanceId: INSTANCE_ID,
    projectId: "shop",
    checkout,
    entryPoint: {
      kind: "repository-file",
      path: "scripts/start.sh",
      arguments: ["--port", "3000"],
    },
    containerPort: 3000,
    variables: [
      { name: "GREETING", value: "hello" },
      { name: "API_TOKEN", value: SECRET },
    ],
    installCommand: "npm ci",
    installInputs: ["package-lock.json"],
    installVariables: [],
    logFile: join(testbed.folder, "logs", `${INSTANCE_ID}.log`),
    mask: new OutputMask([{ name: "API_TOKEN", value: SECRET }]),
    ...extra,
  };
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  runtime.keepExecsRunning();
  testbed = await runEnvironmentsTestbed(
    runtime,
    { ...DEFAULT_RUN_ENVIRONMENT_OPTIONS, runEnvironmentsAtOnce: 1 },
    undefined,
    { timeoutMs: 100, intervalMs: 5, answers: (port) => runtime.answers(port) },
  );
  projectName = hostedProjectNameOf(testbed.folders.instance, INSTANCE_ID);
});

afterEach(async () => {
  await testbed.hostedServices.stop(INSTANCE_ID);
  await rm(testbed.folder, { recursive: true, force: true });
});

describe("HostedServices.start", () => {
  it("builds the image, ups the instance's own project with the override and answers the published port", async () => {
    runtime.hostPort = 49_200;
    const start = await launch();

    const service = await testbed.hostedServices.start(start, () => undefined);

    expect(service).toEqual({ hostPort: 49_200 });
    expect(projectName).toBe(`office-${testbed.folders.instance}-test-${INSTANCE_ID}`);
    expect(runtime.steps).toEqual([
      expect.stringMatching(/^build the-office\/shop:/),
      `up ${projectName}`,
      `logs ${projectName}`,
      `exec ${projectName}`,
      `port ${projectName} app 3000`,
    ]);
    const override = join(testbed.folders.testInstanceFolder(INSTANCE_ID), "office-override.yaml");
    const [project] = runtime.upped;
    expect(project).toMatchObject({
      name: projectName,
      files: [join(start.checkout, ".devcontainer/compose.yaml"), override],
      services: ["app", "postgres"],
    });
    const text = await readFile(override, "utf8");
    expect(text).toContain("127.0.0.1::3000");
    expect(text).toContain(`office.test-instance: ${INSTANCE_ID}`);
  });

  it("passes the target's variables by carrier only, never in the override or a command line", async () => {
    const start = await launch();

    await testbed.hostedServices.start(start, () => undefined);

    expect(runtime.upped[0]?.variables).toEqual({
      OFFICE_VARIABLE_0: "hello",
      OFFICE_VARIABLE_1: SECRET,
    });
    const override = await readFile(
      join(testbed.folders.testInstanceFolder(INSTANCE_ID), "office-override.yaml"),
      "utf8",
    );
    expect(override).toContain("API_TOKEN: ${OFFICE_VARIABLE_1}");
    expect(override).not.toContain(SECRET);
    const [execution] = runtime.executions;
    expect(execution).toMatchObject({
      service: "app",
      script: entryPointScript(start.checkout),
      arguments: ["./scripts/start.sh", "--port", "3000"],
      variables: {},
    });
    expect(JSON.stringify(execution)).not.toContain(SECRET);
  });

  it("appends the build, the start, the entry point's output and the services' logs to the log file, masked", async () => {
    const start = await launch();
    await testbed.hostedServices.start(start, () => undefined);

    await runtime.emitLogs(projectName, `postgres ready, token ${SECRET}\n`);
    runtime.endExecs(projectName, 1, `listening with ${SECRET}\n`);

    await vi.waitFor(async () => {
      const log = await readFile(start.logFile, "utf8");
      expect(log).toContain("[The Office] Building the run environment's image.");
      expect(log).toContain(`up ${projectName}`);
      expect(log).toContain("postgres ready, token [secret API_TOKEN]");
      expect(log).toContain("listening with [secret API_TOKEN]");
      expect(log).not.toContain(SECRET);
    });
  });

  it("tells onEnded once when the entry point ends on its own, and not when it is stopped", async () => {
    const ended = vi.fn<(reason: string) => void>();
    await testbed.hostedServices.start(await launch(), ended);

    runtime.endExecs(projectName, 2);

    await vi.waitFor(() =>
      expect(ended).toHaveBeenCalledExactlyOnceWith("The entry point ended with the exit code 2."),
    );
    const stoppedOne = vi.fn<(reason: string) => void>();
    await testbed.hostedServices.stop(INSTANCE_ID);
    await testbed.hostedServices.start(await launch(), stoppedOne);
    await testbed.hostedServices.stop(INSTANCE_ID);
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(stoppedOne).not.toHaveBeenCalled();
  });

  it("follows a devcontainer service as the app, publishing its port, and tells when it ends", async () => {
    const ended = vi.fn<(reason: string) => void>();
    const start = await launch({
      entryPoint: { kind: "devcontainer-service", service: "postgres" },
      containerPort: 5432,
    });

    await testbed.hostedServices.start(start, ended);
    runtime.endService(projectName, "postgres");

    expect(runtime.executions).toEqual([]);
    expect(runtime.steps).toContain(`logs ${projectName} postgres`);
    expect(runtime.steps).toContain(`port ${projectName} postgres 5432`);
    await vi.waitFor(() =>
      expect(ended).toHaveBeenCalledExactlyOnceWith("The service postgres ended."),
    );
  });

  it("fails with the reason when the app doesn't answer, after removing what it started", async () => {
    runtime.answering = false;
    const start = await launch();

    const failing = testbed.hostedServices.start(start, () => undefined);

    await expect(failing).rejects.toThrow(RunEnvironmentRefused);
    await expect(failing).rejects.toMatchObject({
      reasons: ["The app didn't answer on port 3000."],
      outputFile: start.logFile,
    });
    expect(runtime.steps.slice(-2)).toEqual([
      `down ${projectName} with built images`,
      `remove {"office.managed":"true","office.instance":"${testbed.folders.instance}","office.test-instance":"${INSTANCE_ID}"}`,
    ]);
    expect(runtime.projects.has(projectName)).toBe(false);
    expect(runtime.runningExecs(projectName)).toBe(0);
    expect(await exists(testbed.folders.testInstanceFolder(INSTANCE_ID))).toBe(false);
  });

  it("fails with the exit code when the entry point ends before the app answers", async () => {
    runtime.answering = false;
    const start = await launch();
    const failing = testbed.hostedServices.start(start, () => undefined);

    await vi.waitFor(() => expect(runtime.runningExecs(projectName)).toBe(1));
    runtime.endExecs(projectName, 127);

    await expect(failing).rejects.toMatchObject({
      reasons: ["The entry point ended with the exit code 127."],
    });
    expect(runtime.projects.has(projectName)).toBe(false);
  });

  it("refuses a definition that isn't valid, with its problems, starting nothing", async () => {
    const start = await launch();
    await writeFiles(start.checkout, {
      ".devcontainer/compose.yaml":
        "services:\n  app:\n    image: node:22\n    ports:\n      - 3000:3000\n",
    });

    const failing = testbed.hostedServices.start(start, () => undefined);

    await expect(failing).rejects.toMatchObject({
      reasons: [
        "The run environment definition on this branch isn't valid.",
        expect.stringContaining('sets "ports"'),
      ],
    });
    expect(runtime.steps.filter((step) => step.startsWith("up"))).toEqual([]);
  });

  it("refuses an entry point service the definition doesn't have", async () => {
    const start = await launch({ entryPoint: { kind: "devcontainer-service", service: "worker" } });

    await expect(testbed.hostedServices.start(start, () => undefined)).rejects.toMatchObject({
      reasons: [
        "The service worker the entry point names isn't in the run environment definition.",
      ],
    });
  });

  it("stops while Building when its signal aborts, removing what it started", async () => {
    const stopping = new AbortController();
    const start = await launch({ signal: stopping.signal });
    stopping.abort();

    await expect(testbed.hostedServices.start(start, () => undefined)).rejects.toMatchObject({
      reasons: ["The Test instance was stopped."],
    });
    expect(runtime.steps.filter((step) => step.startsWith("up"))).toEqual([]);
    expect(runtime.steps).toContain(`down ${projectName} with built images`);
  });

  it("takes no Run environments at once slot: a Task's run environment starts beside it", async () => {
    await testbed.hostedServices.start(await launch(), () => undefined);
    const task = taskIn(testbed, "task-1");
    await writeFiles(task.worktree, DEFINITION);

    await testbed.environments.prepare(task, join(testbed.folder, "prepare.log"), {
      onWaiting: () => {
        throw new Error("It waited for a slot.");
      },
    });

    expect(runtime.projects.get(projectName)?.state).toBe("running");
    expect(testbed.busyWork.list()).toEqual([]);
  });
});

describe("HostedServices.stop", () => {
  it("takes the project down with its volumes, then removes what carries its label, and its files", async () => {
    await testbed.hostedServices.start(await launch(), () => undefined);
    runtime.steps.length = 0;

    await testbed.hostedServices.stop(INSTANCE_ID);
    await testbed.hostedServices.stop(INSTANCE_ID);

    const removal = `remove {"office.managed":"true","office.instance":"${testbed.folders.instance}","office.test-instance":"${INSTANCE_ID}"}`;
    expect(runtime.steps).toEqual([
      `down ${projectName} with built images`,
      removal,
      `down ${projectName} with built images`,
      removal,
    ]);
    expect(await runtime.listByLabel({ "office.test-instance": INSTANCE_ID })).toEqual([]);
    expect(await exists(testbed.folders.testInstanceFolder(INSTANCE_ID))).toBe(false);
  });
});

describe("HostedServices.sweep", () => {
  it("removes every Hosted Test instance of this Office, and nothing of another Office or a Task", async () => {
    const instance = testbed.folders.instance;
    const ours = { "office.managed": "true", "office.instance": instance };
    runtime.leave({
      kind: "volume",
      id: "left_data",
      labels: { ...ours, "office.test-instance": "left" },
    });
    runtime.leave({
      kind: "volume",
      id: "other_data",
      labels: { "office.managed": "true", "office.instance": "other", "office.test-instance": "x" },
    });
    runtime.leave({ kind: "container", id: "task_app", labels: { ...ours, "office.task": "t-1" } });

    await testbed.hostedServices.sweep();

    expect(runtime.resources.map(({ id }) => id)).toEqual(["other_data", "task_app"]);
    expect(runtime.steps).toEqual([
      `down ${hostedProjectNameOf(instance, "left")} with built images`,
      `remove ${JSON.stringify({ ...ours, "office.test-instance": "left" })}`,
    ]);
  });
});

describe("the scripted runtime's other callers", () => {
  it("keeps a Task's checks as they were: an exec ends as onExec says", async () => {
    const plain = new ScriptedContainerRuntime();
    const bed = await runEnvironmentsTestbed(plain);
    const task = taskIn(bed, "task-1");
    await writeFiles(task.worktree, DEFINITION);

    const end = await bed.environments.run(task, {
      commandLine: "true",
      environment: { set: [], unset: [], prependPath: [] },
      mask: NO_MASK,
      timeoutMs: 1_000,
      outputFile: join(bed.folder, "check.log"),
    });

    expect(end).toMatchObject({ exitCode: 0 });
    await rm(bed.folder, { recursive: true, force: true });
  });
});
