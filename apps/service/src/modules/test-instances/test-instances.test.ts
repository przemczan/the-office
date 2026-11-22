import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import { ProjectFeaturesChanged } from "../projects/index.js";
import { InitiativeStateChanged } from "../work/index.js";
import { TestInstanceRefused } from "./domain/test-instance-refused.js";
import type { TestInstance } from "./domain/test-instance.js";
import {
  ANN,
  PROJECT_SECRET,
  TARGET_SECRET,
  TESTBED_OFFICE_PORT,
  testInstancesTestbed,
  WEB_TARGET,
  type TestInstancesTestbed,
} from "./test-instances.fixtures.js";

const HOST_PORT = 49_321;

let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  runtime.keepExecsRunning();
  runtime.hostPort = HOST_PORT;
  environments = await runEnvironmentsTestbed(runtime, undefined, undefined, {
    timeoutMs: 100,
    intervalMs: 5,
    answers: (port) => runtime.answers(port),
  });
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
});

afterEach(async () => {
  for (const instance of await testbed.repository.active()) {
    await testbed.instances.stop(instance.id);
  }
  await testbed.instances.settled();
  await rm(environments.folder, { recursive: true, force: true });
});

function launch(): Promise<TestInstance> {
  return testbed.instances.launchOnInitiative(
    testbed.initiativeId,
    { projectId: "shop", targetKey: "web" },
    ANN,
  );
}

async function refusalOf(launching: Promise<unknown>): Promise<TestInstanceRefused> {
  const error: unknown = await launching.then(
    () => undefined,
    (refused: unknown) => refused,
  );
  expect(error).toBeInstanceOf(TestInstanceRefused);
  return error as TestInstanceRefused;
}

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function logOf(id: string): Promise<string> {
  return readFile(testbed.files.logOf(id), "utf8");
}

/** The resources the runtime still holds for the instance, by its label. */
function resourcesOf(id: string): unknown[] {
  return runtime.resources.filter(({ labels }) => labels["office.test-instance"] === id);
}

async function expectRemoved(id: string): Promise<void> {
  expect(resourcesOf(id)).toEqual([]);
  expect(await exists(testbed.officeData.testInstanceFolder(id))).toBe(false);
  expect(runtime.steps).toContainEqual(expect.stringMatching(/^down .* with built images$/));
}

describe("launching a Hosted test instance", () => {
  it("answers it Building on the first Proxy port, checks it out into its own folder and ends Running", async () => {
    const launched = await launch();

    expect(launched).toMatchObject({ state: "building", port: 4400, kind: "hosted" });
    await testbed.instances.settled();
    const instance = await testbed.instances.read(launched.id);

    expect(instance).toMatchObject({
      state: "running",
      port: 4400,
      commit: testbed.project.commit,
      launchedBy: ANN,
    });
    const checkout = testbed.officeData.testInstanceFolder(launched.id);
    expect(checkout).toBe(join(environments.folder, "office-data", "test-instances", launched.id));
    expect(testbed.projects.checkouts).toEqual([
      { projectId: "shop", branch: "initiative/checkout", folder: checkout },
    ]);
    expect(await exists(join(checkout, ".git"))).toBe(false);
    expect(runtime.upped[0]?.files).toContain(join(checkout, ".devcontainer/compose.yaml"));
    expect(testbed.running.upstreamOf(launched.id)).toBe(HOST_PORT);
    expect(testbed.running.byPort(4400)).toEqual({
      id: launched.id,
      port: 4400,
      hostPort: HOST_PORT,
    });
    expect(await logOf(launched.id)).toContain(
      `Checked out initiative/checkout at ${testbed.project.commit}.`,
    );
  });

  it("lists each Project with its branch's tip, so the page can say the branch moved past an instance", async () => {
    testbed.project.branchCommit = "beef000000000000000000000000000000000002";

    const [project] = await testbed.instances.listFor(testbed.initiativeId);

    expect(project?.branchCommit).toBe("beef000000000000000000000000000000000002");
  });

  it("fails when the app doesn't answer, saying so in its log, and removes what it started", async () => {
    runtime.answering = false;

    const instance = await testbed.launchAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      port: undefined,
      failedReason: "The app didn't answer on port 3000.",
    });
    expect(await logOf(instance.id)).toContain("Failed: The app didn't answer on port 3000.");
    expect(testbed.running.isRunning(instance.id)).toBe(false);
    await expectRemoved(instance.id);
  });
});

describe("a launch refused or failing", () => {
  it("is refused while the Project's Run environment is Off", async () => {
    testbed.project.runEnvironmentOn = false;

    const refusal = await refusalOf(launch());

    expect(refusal.reasons).toEqual([
      "Turn the Project's Run environment On to launch a Hosted test instance.",
    ]);
    expect(testbed.repository.rows.size).toBe(0);
  });

  // The definition is read from the branch's own checkout, so it fails once that is made.
  it("fails with the definition's problem when .devcontainer/ on the branch isn't valid", async () => {
    testbed.project.files[".devcontainer/devcontainer.json"] = "{ not json";

    const instance = await testbed.launchAndSettle();

    expect(instance.state).toBe("failed");
    expect(instance.failedReason).toContain(
      "The run environment definition on this branch isn't valid.",
    );
    expect(runtime.upped).toEqual([]);
  });

  it("fails at once, naming it, when the entry point is missing at the branch's tip", async () => {
    testbed.project.entryPointProblems = ['Test target "web": scripts/start.sh isn\'t a file.'];

    const instance = await testbed.launchAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: 'Test target "web": scripts/start.sh isn\'t a file.',
    });
    expect(runtime.upped).toEqual([]);
    expect(await exists(testbed.officeData.testInstanceFolder(instance.id))).toBe(false);
  });

  it("is refused over Test instances at once, Building counted, naming each", async () => {
    const first = await launch();
    const second = await launch();
    expect([first.state, second.state]).toEqual(["building", "building"]);

    const refusal = await refusalOf(launch());

    expect(refusal.message).toBe(
      "2 test instances are building or running: Web app in Checkout, Web app in Checkout. " +
        "Stop one to launch another.",
    );
  });
});

function launchOn(branch: string): Promise<TestInstance> {
  return testbed.instances.launchOnBranch("shop", branch, "web", ANN);
}

describe("launching on any branch of a Project", () => {
  it("launches on a branch no Initiative has, linked to none, listed under its branch of the Project only", async () => {
    const launched = await launchOn("feature/search");
    await testbed.instances.settled();

    const instance = await testbed.instances.read(launched.id);
    expect(instance).toMatchObject({
      state: "running",
      initiativeId: undefined,
      branch: "feature/search",
    });
    expect(testbed.projects.checkouts.map(({ branch }) => branch)).toEqual(["feature/search"]);
    const listed = await testbed.instances.listForProject("shop");
    expect(listed.branches.map(({ name }) => name)).toEqual(["feature/search"]);
    expect(listed.branches[0]?.instances.map(({ id }) => id)).toEqual([launched.id]);
    expect(listed.initiatives).toEqual([]);
    const [project] = await testbed.instances.listFor(testbed.initiativeId);
    expect(project?.targets.flatMap(({ instances }) => instances)).toEqual([]);
  });

  it("links to the active Initiative whose branch it is, which then lists it", async () => {
    const launched = await launchOn("initiative/checkout");
    await testbed.instances.settled();

    expect(await testbed.instances.read(launched.id)).toMatchObject({
      initiativeId: testbed.initiativeId,
      branch: "initiative/checkout",
    });
    const [project] = await testbed.instances.listFor(testbed.initiativeId);
    expect(project?.targets.flatMap(({ instances }) => instances.map(({ id }) => id))).toEqual([
      launched.id,
    ]);
    const listed = await testbed.instances.listForProject("shop");
    expect(listed.initiatives).toEqual([{ id: testbed.initiativeId, name: "Checkout" }]);
  });

  it("stops the linked instance as its Initiative is Done, the unlinked one staying Running", async () => {
    const linked = await launchOn("initiative/checkout");
    const unlinked = await launchOn("feature/search");
    await testbed.instances.settled();

    await testbed.events.publish(
      new InitiativeStateChanged(testbed.initiativeId, "active", "done"),
    );
    await testbed.instances.settled();

    expect((await testbed.instances.read(linked.id)).state).toBe("stopped");
    expect((await testbed.instances.read(unlinked.id)).state).toBe("running");
  });

  it("is refused over Test instances naming an unlinked one by its branch", async () => {
    await launchOn("feature/search");
    await launchOn("initiative/checkout");

    const refusal = await refusalOf(launchOn("feature/other"));

    expect(refusal.message).toBe(
      "2 test instances are building or running: Web app on feature/search, Web app in Checkout. " +
        "Stop one to launch another.",
    );
  });

  it("fails the launch, naming the branch, when neither the Project nor its remote has it", async () => {
    testbed.project.missingBranches = ["gone"];

    const launched = await launchOn("gone");
    await testbed.instances.settled();

    expect(await testbed.instances.read(launched.id)).toMatchObject({
      state: "failed",
      failedReason: "The branch gone isn't in shop or on its remote.",
    });
  });
});

describe("Proxy ports", () => {
  it("gives out the lowest free one, frees it at stop and gives it out again", async () => {
    const first = await testbed.launchAndSettle();
    const second = await testbed.launchAndSettle();
    expect([first.port, second.port]).toEqual([4400, 4401]);

    const stopped = await testbed.instances.stop(first.id);
    expect(stopped).toMatchObject({ state: "stopped", port: undefined });
    const third = await testbed.launchAndSettle();

    expect(third).toMatchObject({ state: "running", port: 4400 });
    expect(testbed.repository.rows.get(third.id)?.port).toBe(4400);
  });

  it("refuses a launch when every port is taken", async () => {
    testbed.settings.settings = { ...testbed.settings.settings, lastProxyPort: 4400 };
    await testbed.launchAndSettle();

    const refusal = await refusalOf(launch());

    expect(refusal.message).toContain("Every Proxy port is in use (4400–4400).");
  });

  it("never gives out The Office's own port, should the range hold it", async () => {
    testbed.settings.settings = {
      ...testbed.settings.settings,
      firstProxyPort: TESTBED_OFFICE_PORT,
      lastProxyPort: TESTBED_OFFICE_PORT + 1,
    };

    const instance = await testbed.launchAndSettle();

    expect(instance.port).toBe(TESTBED_OFFICE_PORT + 1);
  });
});

describe("what an instance is given", () => {
  it("mounts only its checkout and passes only its target's variables, removed with its volumes at stop", async () => {
    const instance = await testbed.launchAndSettle();
    const checkout = testbed.officeData.testInstanceFolder(instance.id);

    const override = await readFile(
      join(environments.folders.testInstanceFolder(instance.id), "office-override.yaml"),
      "utf8",
    );
    const services = (
      parseYaml(override) as { services: Record<string, { volumes?: { source: string }[] }> }
    ).services;
    const mounts = Object.values(services).flatMap(({ volumes }) =>
      (volumes ?? []).map(({ source }) => source),
    );
    expect(mounts).toEqual([checkout]);
    expect(runtime.upped.map(({ variables }) => variables)).toEqual([
      { OFFICE_VARIABLE_0: "test", OFFICE_VARIABLE_1: TARGET_SECRET },
    ]);
    expect(override).not.toContain(PROJECT_SECRET);
    expect(JSON.stringify(runtime.executions)).not.toContain(PROJECT_SECRET);
    expect(resourcesOf(instance.id)).not.toEqual([]);

    await testbed.instances.stop(instance.id);

    expect(runtime.steps).toContainEqual(expect.stringMatching(/^remove .*office.test-instance/));
    await expectRemoved(instance.id);
  });
});

describe("the target's commands before the entry point, port variable and Memory", () => {
  const MIGRATE = { key: "migrate", name: "Migrate", commandLine: "npm run migrate" };

  it("runs the commands in the checkout before the entry point, with the port variable and the target's Memory", async () => {
    runtime.keepExecsRunning((execution) => execution.arguments !== undefined);
    testbed.project.targets[0] = {
      ...WEB_TARGET,
      commandsBefore: [MIGRATE],
      portVariable: "APP_PORT",
      memoryMegabytes: 1024,
    };

    const instance = await testbed.launchAndSettle();

    expect(instance.state).toBe("running");
    const [migrate, entryPoint] = runtime.executions;
    expect(migrate?.script).toMatch(/\nnpm run migrate$/);
    expect(migrate?.script).toContain('export APP_PORT="$OFFICE_VARIABLE_3"');
    expect(migrate?.variables).toMatchObject({ OFFICE_VARIABLE_3: "3000" });
    expect(entryPoint?.arguments).toEqual(["./scripts/start.sh", "--port", "3000"]);
    const override = await readFile(
      join(environments.folders.testInstanceFolder(instance.id), "office-override.yaml"),
      "utf8",
    );
    expect(override).toContain('APP_PORT: "3000"');
    expect(override).toContain("mem_limit: 1024m");
    expect(await logOf(instance.id)).toContain("Running the Project's command Migrate.");
  });

  it("fails the launch, checking nothing out, when a command is no longer the Project's", async () => {
    testbed.project.targets[0] = { ...WEB_TARGET, missingCommands: ["seed"] };

    const instance = await testbed.launchAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason:
        "The Project's command seed that runs before the entry point is gone; pick the commands again in the Project's Test targets.",
    });
    expect(testbed.projects.checkouts).toEqual([]);
    expect(runtime.upped).toEqual([]);
  });

  it("fails with the command's words when one ends with an error, never running the entry point", async () => {
    runtime.keepExecsRunning((execution) => execution.arguments !== undefined);
    runtime.onExec = () => Promise.resolve({ exitCode: 4 });
    testbed.project.targets[0] = { ...WEB_TARGET, commandsBefore: [MIGRATE] };

    const instance = await testbed.launchAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: "The Project's command Migrate ended with exit code 4.",
    });
    expect(runtime.executions).toHaveLength(1);
    await expectRemoved(instance.id);
  });
});

describe("Test targets switched off for the Project", () => {
  const OFF = {
    "connected-devices": true,
    "test-targets": false,
    "github-issues": true,
    "run-environment": true,
  } as const;

  it("refuses a launch, adding no instance", async () => {
    testbed.project.testTargetsOn = false;

    const refusal = await refusalOf(launch());

    expect(refusal.reasons).toEqual(["Test targets are switched off for «shop»."]);
    expect(testbed.repository.rows.size).toBe(0);
  });

  it("lists no targets to launch, on the Project's page or the Initiative's", async () => {
    testbed.project.testTargetsOn = false;

    expect((await testbed.instances.listForProject("shop")).targets).toEqual([]);
    const [project] = await testbed.instances.listFor(testbed.initiativeId);
    expect(project?.targets).toEqual([]);
  });

  it("stops the Project's Building and Running instances, linked or not, saying why last in each log", async () => {
    const running = await launchOn("feature/search");
    await testbed.instances.settled();
    const building = await launch();
    expect((await testbed.instances.read(building.id)).state).toBe("building");

    testbed.project.testTargetsOn = false;
    await testbed.events.publish(new ProjectFeaturesChanged("shop", OFF));
    await testbed.instances.settled();

    for (const { id } of [running, building]) {
      expect((await testbed.instances.read(id)).state).toBe("stopped");
      expect((await logOf(id)).trimEnd()).toMatch(
        /Stopped because Test targets were switched off for the Project\.$/,
      );
      await expectRemoved(id);
    }
  });

  it("stops nothing when another Project's are switched off, or the switch stays on", async () => {
    const instance = await testbed.launchAndSettle();

    await testbed.events.publish(new ProjectFeaturesChanged("another", OFF));
    await testbed.events.publish(
      new ProjectFeaturesChanged("shop", { ...OFF, "test-targets": true }),
    );
    await testbed.instances.settled();

    expect((await testbed.instances.read(instance.id)).state).toBe("running");
  });
});

describe("the activity", () => {
  it("lists the active instances, then those that ended since a time", async () => {
    const running = await testbed.launchAndSettle();
    const failedOne = await launch();
    await testbed.instances.stop(failedOne.id);
    await testbed.instances.settled();
    const at = new Date(0);

    const activity = await testbed.instances.activity(at);
    expect(activity.map(({ id }) => id)).toEqual([running.id]);

    await testbed.repository.add({
      ...running,
      id: randomUUID(),
      state: "built",
      port: undefined,
      endedAt: new Date(2000, 0, 2),
    });
    await testbed.repository.add({
      ...running,
      id: "old-failed",
      state: "failed",
      port: undefined,
      endedAt: new Date(2000, 0, 1),
    });
    const later = await testbed.instances.activity(new Date(2000, 0, 2));
    expect(later.map(({ state }) => state)).toEqual(["running", "built"]);
  });
});

describe("when an instance stops", () => {
  it("stops when the user presses Stop, saying so last in its log, and again changes nothing", async () => {
    const instance = await testbed.launchAndSettle();

    const stopped = await testbed.instances.stop(instance.id);
    const again = await testbed.instances.stop(instance.id);

    expect(stopped.state).toBe("stopped");
    expect(again).toEqual(stopped);
    expect((await logOf(instance.id)).trimEnd()).toMatch(/Stopped by you\.$/);
    expect(testbed.running.byPort(4400)).toBeUndefined();
    await expectRemoved(instance.id);
  });

  it("stops a Building one on Stop, Stopped", async () => {
    const launched = await launch();

    const stopped = await testbed.instances.stop(launched.id);
    await testbed.instances.settled();

    expect(stopped.state).toBe("stopped");
    expect((await testbed.instances.read(launched.id)).state).toBe("stopped");
    await expectRemoved(launched.id);
  });

  it("stops after the Idle time with no request, each request counting it again", async () => {
    const instance = await testbed.launchAndSettle();

    await testbed.schedule.advanceBy(20 * 60_000);
    testbed.running.recordActivity(instance.id);
    await testbed.schedule.advanceBy(20 * 60_000);
    expect((await testbed.instances.read(instance.id)).state).toBe("running");

    await testbed.schedule.advanceBy(11 * 60_000);

    expect((await testbed.instances.read(instance.id)).state).toBe("stopped");
    expect(await logOf(instance.id)).toContain("Stopped after 30 minutes with no request.");
    await expectRemoved(instance.id);
  });

  it.each(["done", "dropped"] as const)("stops when its Initiative is %s", async (state) => {
    const instance = await testbed.launchAndSettle();

    await testbed.events.publish(new InitiativeStateChanged(testbed.initiativeId, "active", state));
    await testbed.instances.settled();

    expect((await testbed.instances.read(instance.id)).state).toBe("stopped");
    expect(await logOf(instance.id)).toContain(
      `Stopped because the Initiative is ${state === "done" ? "Done" : "Dropped"}.`,
    );
    await expectRemoved(instance.id);
  });

  it("is stopped by the sweep as The Office starts, a Building one Failed", async () => {
    const running = await testbed.launchAndSettle();
    const building: TestInstance = {
      ...running,
      id: randomUUID(),
      state: "building",
      port: 4401,
      runningAt: undefined,
    };
    await mkdir(testbed.officeData.testInstanceFolder(building.id), { recursive: true });
    // As the last run left them: the rows, the runtime's resources and the checkouts.
    const restarted = testInstancesTestbed(
      environments.hostedServices,
      join(environments.folder, "office-data"),
    );
    await restarted.repository.add(running);
    await restarted.repository.add(building);

    await restarted.instances.sweep();

    expect(await restarted.instances.read(running.id)).toMatchObject({
      state: "stopped",
      port: undefined,
    });
    expect(await restarted.instances.read(building.id)).toMatchObject({
      state: "failed",
      port: undefined,
      failedReason: "The Office restarted while it was Building.",
    });
    expect(await logOf(running.id)).toContain("Stopped because The Office restarted.");
    expect(resourcesOf(running.id)).toEqual([]);
    expect(await restarted.files.leftCheckouts()).toEqual([]);
    expect(await exists(testbed.files.logOf(running.id))).toBe(true);
    // The first run's rows are gone with it: nothing is left for afterEach to stop.
    testbed.repository.rows.clear();
  });
});

describe("the log", () => {
  it("masks the target's Secret variables in what the app prints and in the module's own lines", async () => {
    const instance = await testbed.launchAndSettle();
    const project = runtime.upped[0]?.name ?? "";

    await runtime.emitLogs(project, `token is ${TARGET_SECRET}\n`);
    const log = await testbed.instances.readLog(instance.id, 0);

    expect(log.text).toContain("token is [secret API_TOKEN]");
    expect(log.text).not.toContain(TARGET_SECRET);
    expect(log.state).toBe("running");
    const rest = await testbed.instances.readLog(instance.id, log.nextOffset);
    expect(rest).toEqual({ text: "", nextOffset: log.nextOffset, state: "running" });
  });
});
