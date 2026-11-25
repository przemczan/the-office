import { readFile, rm } from "node:fs/promises";
import { afterEach, describe, expect, it } from "vitest";
import { OfficeTestInstance } from "../../platform/test-instance/office-test-instance.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import {
  ANN,
  actionsTestbed,
  BOB,
  DEPLOY_SECRET,
  FIX_TIP,
  MAIN_TIP,
  PIXEL_ID,
  type ActionsTestbed,
} from "./actions.fixtures.js";
import { RunEnvironmentsCommandRuns } from "./adapters/run-environments/run-environments-command-runs.js";
import { startedRun, failedRun, type ActionRun } from "./domain/action-run.js";
import {
  ActionRunsRemoved,
  ActionRunStarted,
  ActionRunStateChanged,
  ActionSettingsChanged,
} from "./domain/action-run-events.js";
import type { WorkstationRunEnd } from "./ports/action-projects.js";

let testbed: ActionsTestbed;
let environments: RunEnvironmentsTestbed | undefined;

afterEach(async () => {
  await testbed.runs.settled();
  await rm(testbed.folder, { recursive: true, force: true });
  if (environments !== undefined) await rm(environments.folder, { recursive: true, force: true });
  environments = undefined;
});

const FROM_MAIN = { source: { kind: "branch", branch: "main" } } as const;

/** Holds every workstation run until it is stopped, as a long command does. */
function holdWorkstationRuns(): void {
  testbed.projects.onWorkstation = (run) =>
    new Promise<WorkstationRunEnd>((resolve) => {
      run.signal.addEventListener("abort", () => {
        resolve({ name: run.commands.at(-1)?.name ?? "", outcome: "stopped", exitCode: undefined });
      });
    });
}

async function settledRun(id: string): Promise<ActionRun> {
  await testbed.runs.settled();
  return testbed.runs.read(id);
}

async function logOf(id: string): Promise<string> {
  return (await testbed.runs.readLog(id, 0)).text;
}

describe("a Project command run on the workstation", () => {
  it("answers Running at once, runs the commands with what The Office sets, and Succeeds", async () => {
    testbed = await actionsTestbed();

    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    expect(started).toMatchObject({
      status: { kind: "project-command", state: "running" },
      outcome: undefined,
      branch: "main",
      commit: MAIN_TIP,
      ranFrom: { kind: "branch" },
      startedBy: ANN,
    });
    const ended = await settledRun(started.id);
    expect(ended).toMatchObject({
      status: { state: "succeeded" },
      outcome: "succeeded",
      exitCode: 0,
      endedAt: testbed.schedule.now(),
    });
    const [run] = testbed.projects.workstationRuns;
    expect(run?.commands).toEqual([
      { name: "Install", commandLine: "npm ci" },
      { name: "Build web", commandLine: "npm run build" },
    ]);
    expect(run?.variables).toEqual([
      { name: "OFFICE_ACTION", value: "build-web" },
      { name: "OFFICE_ACTION_BRANCH", value: "main" },
      { name: "OFFICE_ACTION_COMMIT", value: MAIN_TIP },
    ]);
    expect(run?.timeoutMs).toBe(60 * 60_000);
    const log = await logOf(started.id);
    expect(log).toContain("[The Office] Checking out main at c0ffee0.");
    expect(log.trimEnd().endsWith("[The Office] Succeeded.")).toBe(true);
    expect(testbed.projects.removedCheckouts).toContain(started.id);
    const changes = testbed.published.filter((event) => event instanceof ActionRunStateChanged);
    expect(testbed.published.some((event) => event instanceof ActionRunStarted)).toBe(true);
    expect(changes).toEqual([
      expect.objectContaining({
        runId: started.id,
        actionName: "Build web",
        kind: "project-command",
        branch: "main",
        from: "running",
        to: "succeeded",
        outcome: "succeeded",
      }),
    ]);
  });

  it("fails naming the exit code, the command's own or one's before it", async () => {
    testbed = await actionsTestbed();
    testbed.projects.onWorkstation = () =>
      Promise.resolve({ name: "Build web", outcome: "failed", exitCode: 1 });
    const own = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    expect(await settledRun(own.id)).toMatchObject({
      outcome: "failed",
      exitCode: 1,
      endedBecause: "The command ended with exit code 1.",
    });

    testbed.projects.onWorkstation = () =>
      Promise.resolve({ name: "Install", outcome: "failed", exitCode: 2 });
    const before = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    expect(await settledRun(before.id)).toMatchObject({
      outcome: "failed",
      endedBecause: "Install, run before the command, ended with exit code 2.",
    });
    expect(await logOf(before.id)).toContain(
      "[The Office] Failed: Install, run before the command, ended with exit code 2.",
    );
  });

  it("fails at its time limit, in its minutes", async () => {
    testbed = await actionsTestbed();
    testbed.projects.onWorkstation = (run) =>
      Promise.resolve({
        name: run.commands[0]?.name ?? "",
        outcome: "timed-out",
        exitCode: undefined,
      });

    const started = await testbed.runs.start("shop", "lint", FROM_MAIN, ANN);

    expect(await settledRun(started.id)).toMatchObject({
      outcome: "failed",
      endedBecause: "The run ran out of its 5 minutes.",
    });
    expect(testbed.projects.workstationRuns[0]?.timeoutMs).toBe(5 * 60_000);
  });

  it("fails at its start naming a command the Project no longer has", async () => {
    testbed = await actionsTestbed();
    testbed.shop.commands = testbed.shop.commands.filter(({ key }) => key !== "install");

    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    expect(await settledRun(started.id)).toMatchObject({
      outcome: "failed",
      endedBecause:
        "The Project's command install is gone; pick the commands again in the Project's Actions.",
    });
    expect(testbed.projects.workstationRuns).toEqual([]);
  });

  it("masks the Project's Secret variables in its log, read from an offset", async () => {
    testbed = await actionsTestbed();
    testbed.projects.onWorkstation = async (run, print) => {
      await print(`deploying with ${DEPLOY_SECRET} → ok\n`);
      return { name: run.commands.at(-1)?.name ?? "", outcome: "passed", exitCode: 0 };
    };

    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    await testbed.runs.settled();

    const whole = await logOf(started.id);
    expect(whole).toContain("deploying with [secret DEPLOY_TOKEN] → ok");
    expect(whole).not.toContain(DEPLOY_SECRET);
    const offset = Buffer.byteLength(whole.slice(0, whole.indexOf("→")));
    const rest = await testbed.runs.readLog(started.id, offset + 1);
    // From inside "→", whose 3 bytes aren't cut: the read starts after it.
    expect(rest.text.startsWith("→")).toBe(false);
    expect(rest.nextOffset).toBe(Buffer.byteLength(whole));
    expect(rest.run.outcome).toBe("succeeded");
  });

  it("stops on the user's Stop, naming them, its checkout removed and its log kept", async () => {
    testbed = await actionsTestbed();
    holdWorkstationRuns();
    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    await testbed.schedule.advanceBy(0);
    await new Promise((resolve) => setTimeout(resolve, 10));
    // A scheduled Office update waits for it while it runs (spec §5.1.2).
    expect(testbed.busyWork.list()).toEqual([
      { kind: "action-run", label: "The Action Build web on Shop" },
    ]);
    // Activity lists it while it runs (spec §2.14).
    expect(await testbed.runs.runningCommandRuns()).toEqual([
      {
        id: started.id,
        projectId: "shop",
        actionKey: "build-web",
        actionName: "Build web",
        branch: "main",
        startedBy: ANN.name,
        startedAt: started.startedAt,
      },
    ]);

    const stopped = await testbed.runs.stop(started.id, { kind: "by-user", user: BOB });

    expect(stopped).toMatchObject({
      outcome: "stopped",
      status: { state: "stopped" },
      endedBecause: "Stopped by Bob Kay.",
      stoppedBy: "by-user",
    });
    await testbed.runs.settled();
    expect(await testbed.runs.read(started.id)).toMatchObject({ outcome: "stopped" });
    expect(testbed.projects.removedCheckouts).toContain(started.id);
    expect(testbed.busyWork.list()).toEqual([]);
    expect(await testbed.runs.runningCommandRuns()).toEqual([]);
    const log = await logOf(started.id);
    expect(log).toContain("[The Office] Stopped by Bob Kay.");
    expect(log).not.toContain("Failed");
  });
});

/** The testbed over Run environments' own command runs on `runtime`, the Shop's Run environment On. */
async function onRunEnvironment(runtime: ScriptedContainerRuntime): Promise<void> {
  environments = await runEnvironmentsTestbed(runtime);
  testbed = await actionsTestbed(
    new RunEnvironmentsCommandRuns(environments.actionRunEnvironments),
  );
  testbed.shop.project = { ...testbed.shop.project, runEnvironmentOn: true };
}

describe("a Project command run in the run environment", () => {
  it("runs each command in its own compose project, masked, and Succeeds", async () => {
    const runtime = new ScriptedContainerRuntime();
    runtime.onExec = () => Promise.resolve({ exitCode: 0, output: `token ${DEPLOY_SECRET}\n` });
    await onRunEnvironment(runtime);

    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    expect(await settledRun(started.id)).toMatchObject({ outcome: "succeeded" });
    expect(runtime.executions).toHaveLength(2);
    expect(testbed.projects.workstationRuns).toEqual([]);
    const log = await logOf(started.id);
    expect(log).toContain("Running Install.");
    expect(log).toContain("token [secret DEPLOY_TOKEN]");
    expect(log).not.toContain(DEPLOY_SECRET);
  });

  it("fails with the problems of an invalid .devcontainer/", async () => {
    const runtime = new ScriptedContainerRuntime();
    await onRunEnvironment(runtime);
    const main = testbed.shop.branches["main"];
    if (main === undefined) throw new Error("No main.");
    testbed.shop.branches["main"] = { ...main, files: { "README.md": "no definition" } };

    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    const ended = await settledRun(started.id);
    expect(ended.outcome).toBe("failed");
    expect(ended.endedBecause).toContain(
      "The run environment definition on this branch isn't valid.",
    );
  });

  it("stops on Stop, its compose project removed", async () => {
    const runtime = new ScriptedContainerRuntime();
    runtime.keepExecsRunning();
    await onRunEnvironment(runtime);
    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    for (let tries = 0; tries < 100 && runtime.executions.length === 0; tries++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    await testbed.runs.stop(started.id, { kind: "by-user", user: ANN });

    expect(await settledRun(started.id)).toMatchObject({
      outcome: "stopped",
      endedBecause: "Stopped by Ann Lee.",
    });
    expect(runtime.steps.some((step) => step.startsWith("down "))).toBe(true);
  });
});

/** Waits until the run's commands run, held running. */
async function untilExecuting(runtime: ScriptedContainerRuntime): Promise<void> {
  for (let tries = 0; tries < 100 && runtime.executions.length === 0; tries++) {
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe("a Project command run holding a Project device", () => {
  const RELAY_TAB = "5a1b0000-0000-4000-8000-000000000001";
  const WITH_TAB = { ...FROM_MAIN, relayTab: RELAY_TAB } as const;

  it("holds it before its commands, which get ANDROID_SERIAL, and lets go of it as it ends", async () => {
    const runtime = new ScriptedContainerRuntime();
    await onRunEnvironment(runtime);

    const started = await testbed.runs.start("shop", "install-app", WITH_TAB, ANN);

    expect(started.deviceName).toBe("Pixel 9");
    expect(await settledRun(started.id)).toMatchObject({
      outcome: "succeeded",
      deviceName: "Pixel 9",
    });
    expect(testbed.devices.holds).toEqual([
      {
        holdId: "hold-1",
        projectDeviceId: PIXEL_ID,
        actionRunId: started.id,
        holderName: "Install app on main",
        relayTab: RELAY_TAB,
        ended: "run-ended",
      },
    ]);
    const [execution] = runtime.executions;
    expect(JSON.stringify(execution?.variables)).toContain("127.0.0.1:41234");
    // Each value by its carrier, the script naming it.
    expect(execution?.script).toContain("ANDROID_SERIAL");
    expect(await logOf(started.id)).toContain("Holding Pixel 9.");
  });

  it("lets go of it on Stop", async () => {
    const runtime = new ScriptedContainerRuntime();
    runtime.keepExecsRunning();
    await onRunEnvironment(runtime);
    const started = await testbed.runs.start("shop", "install-app", WITH_TAB, ANN);
    await untilExecuting(runtime);

    await testbed.runs.stop(started.id, { kind: "by-user", user: ANN });

    expect(await settledRun(started.id)).toMatchObject({ outcome: "stopped" });
    expect(testbed.devices.holds[0]?.ended).toBe("run-ended");
  });

  it("is refused while the device is held, naming the holder, or by a run starting here", async () => {
    const runtime = new ScriptedContainerRuntime();
    runtime.keepExecsRunning();
    await onRunEnvironment(runtime);
    testbed.devices.heldElsewhere.set(PIXEL_ID, "the Task «Fix the cart»");

    await expect(testbed.runs.start("shop", "install-app", WITH_TAB, ANN)).rejects.toMatchObject({
      reasons: ["Pixel 9 is in use by the Task «Fix the cart»."],
    });
    expect(testbed.repository.runs.size).toBe(0);

    testbed.devices.heldElsewhere.clear();
    const first = await testbed.runs.start("shop", "install-app", WITH_TAB, ANN);
    const shop = testbed.shop.actions.find(({ key }) => key === "install-app");
    if (shop === undefined) throw new Error("No install-app.");
    testbed.shop.actions.push({ ...shop, key: "install-again", name: "Install again" });
    await expect(testbed.runs.start("shop", "install-again", WITH_TAB, BOB)).rejects.toMatchObject({
      reasons: ["Pixel 9 is in use by Install app on main."],
    });
    await testbed.runs.stop(first.id, { kind: "by-user", user: ANN });
  });

  it("fails in Devices' words when the hold isn't made, nothing run", async () => {
    const runtime = new ScriptedContainerRuntime();
    await onRunEnvironment(runtime);
    testbed.devices.holdProblem =
      "Pixel 9 isn't plugged into this computer, or the browser can't open it.";

    const started = await testbed.runs.start("shop", "install-app", WITH_TAB, ANN);

    expect(await settledRun(started.id)).toMatchObject({
      outcome: "failed",
      endedBecause: "Pixel 9 isn't plugged into this computer, or the browser can't open it.",
    });
    expect(runtime.executions).toEqual([]);
  });

  it("fails naming why when its hold ends from outside", async () => {
    const runtime = new ScriptedContainerRuntime();
    runtime.keepExecsRunning();
    await onRunEnvironment(runtime);
    const started = await testbed.runs.start("shop", "install-app", WITH_TAB, ANN);
    await untilExecuting(runtime);

    testbed.devices.endFromOutside("hold-1", "Run environment turned Off");

    expect(await settledRun(started.id)).toMatchObject({
      outcome: "failed",
      endedBecause: "Pixel 9 was let go of: Run environment turned Off.",
    });
    expect(runtime.steps.some((step) => step.startsWith("down "))).toBe(true);
    expect(await logOf(started.id)).toContain(
      "Failed: Pixel 9 was let go of: Run environment turned Off.",
    );
  });

  it("is refused with Run environment Off, and fails at its start when the device is gone", async () => {
    testbed = await actionsTestbed();

    await expect(testbed.runs.start("shop", "install-app", FROM_MAIN, ANN)).rejects.toMatchObject({
      reasons: ["Install app holds Pixel 9, which needs Run environment On."],
    });

    testbed.devices.devices.clear();
    const gone = await testbed.runs.start("shop", "install-app", FROM_MAIN, ANN);
    expect(gone).toMatchObject({
      outcome: "failed",
      endedBecause: `The Project's device ${PIXEL_ID} is gone; pick the device again in the Project's Actions.`,
    });
    expect(testbed.projects.workstationRuns).toEqual([]);
  });
});

describe("a start", () => {
  it("refuses a second run of an Action while one runs, started one at a time", async () => {
    testbed = await actionsTestbed();
    holdWorkstationRuns();

    const both = await Promise.allSettled([
      testbed.runs.start("shop", "build-web", FROM_MAIN, ANN),
      testbed.runs.start("shop", "build-web", FROM_MAIN, BOB),
    ]);

    expect(both.map(({ status }) => status)).toEqual(["fulfilled", "rejected"]);
    expect(both[1]).toMatchObject({
      reason: { reasons: ["Build web is running already, started by Ann Lee just now."] },
    });
    await testbed.runs.stopEachCommandRun({ kind: "restart" });
  });

  it("refuses a command run over Actions at once, naming the runs; other kinds don't count", async () => {
    testbed = await actionsTestbed();
    holdWorkstationRuns();
    await testbed.limits.change({ actionsAtOnce: 1 });
    await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    await expect(
      testbed.runs.start("shop", "lint", { source: { kind: "branch", branch: "fix-login" } }, ANN),
    ).rejects.toMatchObject({
      reasons: ["1 Action is running: Build web on main. Stop one to start another."],
    });
    await expect(
      testbed.runs.start("shop", "install-phone", FROM_MAIN, ANN),
    ).resolves.toMatchObject({ status: { kind: "test-target" } });
    expect(testbed.published.some((event) => event instanceof ActionSettingsChanged)).toBe(true);
    await testbed.runs.stopEachCommandRun({ kind: "restart" });
  });

  it("refuses Actions at once outside its bounds", async () => {
    testbed = await actionsTestbed();
    await expect(testbed.limits.change({ actionsAtOnce: 7 })).rejects.toMatchObject({
      reasons: ["Actions at once is a whole number from 1 to 6."],
    });
  });

  it("refuses a Leaves the workstation Action off the base branch, without its commit or moved", async () => {
    testbed = await actionsTestbed();
    const deploy = (start: Parameters<ActionsTestbed["runs"]["start"]>[2]) =>
      testbed.runs.start("shop", "deploy", start, ANN);

    await expect(
      deploy({ source: { kind: "branch", branch: "fix-login" }, commit: FIX_TIP }),
    ).rejects.toMatchObject({
      reasons: ["Deploy leaves the workstation, so it runs only from main, not from fix-login."],
    });
    await expect(
      deploy({ source: { kind: "task", taskId: testbed.taskId }, commit: FIX_TIP }),
    ).rejects.toMatchObject({
      reasons: [
        "Deploy leaves the workstation, so it runs only from main, not from the Task «Fix the cart».",
      ],
    });
    await expect(deploy(FROM_MAIN)).rejects.toMatchObject({
      reasons: [
        "Deploy leaves the workstation: start it from its Run window, which shows the commit it will run.",
      ],
    });
    await expect(deploy({ ...FROM_MAIN, commit: "f00ba12" })).rejects.toMatchObject({
      reasons: ["main moved to c0ffee0 since you looked. Run it again to run that commit."],
    });
    await expect(deploy({ ...FROM_MAIN, commit: MAIN_TIP.slice(0, 7) })).resolves.toMatchObject({
      commit: MAIN_TIP,
    });
  });

  it("is refused while the fire alarm is on, the Actions are off, or in a test instance of The Office", async () => {
    testbed = await actionsTestbed();
    testbed.sources.alarmOn = true;
    await expect(testbed.runs.start("shop", "lint", FROM_MAIN, ANN)).rejects.toMatchObject({
      reasons: ["The fire alarm is on."],
    });
    testbed.sources.alarmOn = false;
    testbed.shop.project = { ...testbed.shop.project, actionsOn: false };
    await expect(testbed.runs.start("shop", "lint", FROM_MAIN, ANN)).rejects.toMatchObject({
      reasons: ["Actions are switched off for «Shop»."],
    });
    await rm(testbed.folder, { recursive: true, force: true });

    testbed = await actionsTestbed(undefined, new OfficeTestInstance(true));
    await expect(testbed.runs.start("shop", "lint", FROM_MAIN, ANN)).rejects.toMatchObject({
      reasons: ["A test instance of The Office (OFFICE_TEST_INSTANCE) doesn't run Actions."],
    });
    expect(testbed.repository.runs.size).toBe(0);
  });

  it("runs from a Task's branch or an Initiative's, recording what it ran from", async () => {
    testbed = await actionsTestbed();
    const fromTask = await testbed.runs.start(
      "shop",
      "build-web",
      { source: { kind: "task", taskId: testbed.taskId } },
      ANN,
    );
    expect(fromTask).toMatchObject({
      branch: `office/${testbed.taskId}`,
      ranFrom: { kind: "task", taskId: testbed.taskId, title: "Fix the cart" },
    });
    await testbed.runs.settled();
    const fromInitiative = await testbed.runs.start(
      "shop",
      "lint",
      { source: { kind: "initiative", initiativeId: testbed.initiativeId } },
      ANN,
    );
    expect(fromInitiative).toMatchObject({
      branch: "initiative/checkout",
      ranFrom: { kind: "initiative", initiativeId: testbed.initiativeId, name: "Checkout" },
    });
    expect(
      await testbed.runs.sourceTip("shop", { kind: "task", taskId: testbed.taskId }),
    ).toMatchObject({
      kind: "tip",
      branch: `office/${testbed.taskId}`,
      subject: "Work on the Task",
    });
    expect(await testbed.runs.sourceTip("shop", { kind: "branch", branch: "gone" })).toEqual({
      kind: "problem",
      problem: "Neither the repository nor its remote has gone.",
    });
  });
});

describe("a Test target run", () => {
  it("launches its target run as the Action and follows its instance to Built", async () => {
    testbed = await actionsTestbed();

    const started = await testbed.runs.start("shop", "install-phone", FROM_MAIN, ANN);

    expect(started).toMatchObject({ status: { kind: "test-target", state: "building" } });
    const [instance] = [...testbed.testInstances.instances.values()];
    expect(instance).toMatchObject({
      runAs: { actionKey: "install-phone", actionName: "Install on my phone" },
      by: ANN,
    });
    testbed.testInstances.move(instance?.id ?? "", { state: "built", commit: MAIN_TIP });
    expect(await settledRun(started.id)).toMatchObject({
      status: { state: "built" },
      outcome: "succeeded",
      testInstanceId: instance?.id,
    });
  });

  it("counts Installed as succeeded, Installing as running, and passes the start's relay tab", async () => {
    testbed = await actionsTestbed();
    const relayTab = "5a1b0000-0000-4000-8000-000000000002";

    const started = await testbed.runs.start(
      "shop",
      "install-phone",
      { ...FROM_MAIN, relayTab },
      ANN,
    );

    const [instance] = [...testbed.testInstances.instances.values()];
    expect(instance?.relayTab).toBe(relayTab);
    testbed.testInstances.move(instance?.id ?? "", { state: "installing" });
    expect(await settledRun(started.id)).toMatchObject({
      status: { state: "installing" },
      outcome: undefined,
    });
    testbed.testInstances.move(instance?.id ?? "", { state: "installed" });
    expect(await settledRun(started.id)).toMatchObject({
      status: { state: "installed" },
      outcome: "succeeded",
    });
  });

  it("stops its instance on Stop, ending Stopped", async () => {
    testbed = await actionsTestbed();
    const started = await testbed.runs.start("shop", "install-phone", FROM_MAIN, ANN);

    const stopped = await testbed.runs.stop(started.id, { kind: "by-user", user: BOB });

    expect(stopped).toMatchObject({
      status: { state: "failed" },
      outcome: "stopped",
      endedBecause: "Stopped by Bob Kay.",
    });
  });

  it("fails at its start when its target is gone, and a launch refused refuses the start", async () => {
    testbed = await actionsTestbed();
    testbed.shop.targetKeys = [];
    const gone = await testbed.runs.start("shop", "install-phone", FROM_MAIN, ANN);
    expect(gone).toMatchObject({
      outcome: "failed",
      endedBecause:
        "The Project's test target android is gone; pick the target again in the Project's Actions.",
    });

    testbed.shop.targetKeys = ["android"];
    testbed.testInstances.refusal = "2 test instances are running: Web app on main.";
    await expect(testbed.runs.start("shop", "install-phone", FROM_MAIN, ANN)).rejects.toMatchObject(
      { reasons: ["2 test instances are running: Web app on main."] },
    );
    expect(testbed.repository.runs.size).toBe(1);
  });
});

describe("a Workflow run", () => {
  const CI_RUN = {
    id: 4242,
    number: 17,
    workflowName: "Nightly",
    url: "https://github.com/ann/shop/actions/runs/4242",
    commit: "be70000000000000000000000000000000000009",
    status: "queued",
  } as const;

  it("starts on the code host, is Starting until its CI run shows, then follows it", async () => {
    testbed = await actionsTestbed();

    const started = await testbed.runs.start("shop", "nightly", FROM_MAIN, ANN);
    await testbed.runs.settled();

    expect(started).toMatchObject({
      status: { kind: "workflow", state: "starting" },
      commit: undefined,
    });
    expect(testbed.host.starts).toEqual([
      expect.objectContaining({ file: "nightly.yml", branch: "main", inputs: {} }),
    ]);
    await testbed.schedule.advanceBy(5_000);
    expect((await testbed.runs.read(started.id)).status.state).toBe("starting");

    testbed.host.show(CI_RUN);
    await testbed.schedule.advanceBy(5_000);
    expect(await testbed.runs.read(started.id)).toMatchObject({
      status: { state: "queued" },
      commit: CI_RUN.commit,
      note: "It ran be70000: main moved as it started.",
      ciRun: { id: 4242, number: 17, workflowName: "Nightly", url: CI_RUN.url },
      outcome: undefined,
    });

    testbed.host.ciRuns.set(4242, { ...CI_RUN, status: "succeeded" });
    await testbed.schedule.advanceBy(15_000);
    expect(await testbed.runs.read(started.id)).toMatchObject({
      status: { state: "succeeded" },
      outcome: "succeeded",
    });
    const log = await logOf(started.id);
    expect(log).toContain("Starting the Workflow nightly.yml on main.");
    expect(log).toContain("Its inputs: none; the Workflow's defaults apply.");
    expect(log).toContain(`Its run: Nightly #17, ${CI_RUN.url}`);
    await expect(
      testbed.runs.stop(started.id, { kind: "by-user", user: ANN }),
    ).rejects.toMatchObject({ name: "ActionRunRefused" });
  });

  it("never follows a CI run another run of the Workflow follows already", async () => {
    testbed = await actionsTestbed();
    const first = await testbed.runs.start("shop", "nightly", FROM_MAIN, ANN);
    await testbed.runs.settled();
    testbed.host.show({ ...CI_RUN, status: "succeeded" });
    await testbed.schedule.advanceBy(5_000);
    expect((await testbed.runs.read(first.id)).ciRun?.id).toBe(4242);

    const second = await testbed.runs.start("shop", "nightly", FROM_MAIN, ANN);
    await testbed.runs.settled();
    await testbed.schedule.advanceBy(5_000);
    expect(await testbed.runs.read(second.id)).toMatchObject({
      status: { state: "starting" },
      ciRun: undefined,
    });

    testbed.host.show({ ...CI_RUN, id: 4243, number: 18 });
    await testbed.schedule.advanceBy(5_000);
    expect((await testbed.runs.read(second.id)).ciRun).toMatchObject({ id: 4243, number: 18 });
  });

  it("fails when its CI run doesn't show in 60 seconds, linking the Workflow's runs", async () => {
    testbed = await actionsTestbed();
    const started = await testbed.runs.start(
      "shop",
      "release",
      { ...FROM_MAIN, commit: MAIN_TIP },
      ANN,
    );
    await testbed.runs.settled();
    expect(testbed.host.starts[0]?.inputs).toEqual({ dry_run: "false" });

    await testbed.schedule.advanceBy(65_000);

    expect(await testbed.runs.read(started.id)).toMatchObject({
      outcome: "failed",
      endedBecause: "GitHub didn't show the run in 60 seconds; it may still run there.",
      workflowRunsUrl: "https://github.com/ann/shop/actions/workflows/release.yml",
    });
  });

  it("fails in the code host's words, and is refused from a branch the remote lacks", async () => {
    testbed = await actionsTestbed();
    testbed.host.refusal = "nightly.yml declares no start by hand on main.";
    const started = await testbed.runs.start("shop", "nightly", FROM_MAIN, ANN);
    expect(await settledRun(started.id)).toMatchObject({
      outcome: "failed",
      endedBecause: "nightly.yml declares no start by hand on main.",
    });

    await expect(
      testbed.runs.start(
        "shop",
        "nightly",
        { source: { kind: "task", taskId: testbed.taskId } },
        ANN,
      ),
    ).rejects.toMatchObject({
      reasons: [
        `The remote has no branch office/${testbed.taskId}, and a Workflow runs on the code host: push office/${testbed.taskId} first.`,
      ],
    });
  });
});

describe("the runs kept, the reactions and the sweep", () => {
  it("keeps the newest 20 runs of an Action, removing an older one and its log as a newer one ends", async () => {
    testbed = await actionsTestbed();
    for (let index = 0; index < 20; index++) {
      const run = startedRun({
        id: `00000000-0000-4000-8000-${String(index).padStart(12, "0")}`,
        projectId: "shop",
        actionKey: "build-web",
        actionName: "Build web",
        kind: "project-command",
        ranFrom: { kind: "branch" },
        branch: "main",
        startCommit: MAIN_TIP,
        startedBy: ANN,
        at: new Date(Date.UTC(2003, 0, 1 + index)),
      });
      await testbed.repository.add(failedRun(run, "Old.", run.startedAt) ?? run);
      await testbed.logs.note(run.id, "Old.");
    }
    const oldest = "00000000-0000-4000-8000-000000000000";

    const started = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    await testbed.runs.settled();

    const [history] = await testbed.runs.list("shop");
    expect(history?.runs).toHaveLength(20);
    expect(history?.runs[0]?.id).toBe(started.id);
    expect(await testbed.repository.find(oldest)).toBeUndefined();
    await expect(readFile(testbed.projects.logFileOf(oldest))).rejects.toThrow(/ENOENT/);
    const removed = testbed.published.filter((event) => event instanceof ActionRunsRemoved);
    expect(removed).toEqual([
      expect.objectContaining({ actionKey: "build-web", runIds: [oldest] }),
    ]);
  });

  it("stops the command runs under the fire alarm's ASAP and as Actions are switched off", async () => {
    testbed = await actionsTestbed();
    holdWorkstationRuns();
    const build = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);
    const phone = await testbed.runs.start("shop", "install-phone", FROM_MAIN, ANN);

    testbed.signals.alarmSoundedAsap();
    await testbed.runs.settled();

    expect(await testbed.runs.read(build.id)).toMatchObject({
      outcome: "stopped",
      endedBecause: "Stopped by the fire alarm.",
      stoppedBy: "fire-alarm",
    });
    expect((await testbed.runs.read(phone.id)).outcome).toBeUndefined();

    const lint = await testbed.runs.start("shop", "lint", FROM_MAIN, ANN);
    testbed.signals.actionsSwitchedOff("shop");
    await testbed.runs.settled();
    expect(await testbed.runs.read(lint.id)).toMatchObject({
      outcome: "stopped",
      endedBecause: "Actions were switched off for «Shop».",
    });
  });

  it("removes a removed Action's runs and logs, stopping a running one first", async () => {
    testbed = await actionsTestbed();
    holdWorkstationRuns();
    const build = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    testbed.signals.actionsRemoved("shop", ["build-web"]);
    await testbed.runs.settled();

    expect(await testbed.repository.find(build.id)).toBeUndefined();
    expect(testbed.projects.removedCheckouts).toContain(build.id);
  });

  it("sweeps a command run left running as The Office starts", async () => {
    testbed = await actionsTestbed();
    const run = startedRun({
      id: "00000000-0000-4000-8000-0000000000aa",
      projectId: "shop",
      actionKey: "lint",
      actionName: "Lint",
      kind: "project-command",
      ranFrom: { kind: "branch" },
      branch: "main",
      startCommit: MAIN_TIP,
      startedBy: ANN,
      at: testbed.schedule.now(),
    });
    await testbed.repository.add(run);
    holdWorkstationRuns();
    const startedSince = await testbed.runs.start("shop", "build-web", FROM_MAIN, ANN);

    await testbed.runs.sweep();

    expect(await testbed.runs.read(run.id)).toMatchObject({
      outcome: "stopped",
      endedBecause: "The Office restarted while it ran.",
      stoppedBy: "restart",
    });
    expect(await logOf(run.id)).toContain("[The Office] The Office restarted while it ran.");
    expect(await testbed.runs.read(startedSince.id)).toMatchObject({
      status: { state: "running" },
      outcome: undefined,
    });
    expect(testbed.projects.removedCheckouts).not.toContain(startedSince.id);
    await testbed.runs.stop(startedSince.id, { kind: "by-user", user: ANN });
  });

  it("answers each Action's last run for the Project's record", async () => {
    testbed = await actionsTestbed();
    const started = await testbed.runs.start("shop", "lint", FROM_MAIN, ANN);
    await testbed.runs.settled();

    expect(await testbed.runs.lastRuns("shop")).toEqual(
      new Map([["lint", { state: "Succeeded", startedAt: started.startedAt }]]),
    );
  });
});
