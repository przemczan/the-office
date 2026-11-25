import { randomUUID } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
  type ScriptedAttachedProcess,
} from "../run-environments/index.fixtures.js";
import { INSTALL_RAN_OUT, INSTALL_TIMEOUT_MS, NO_APK } from "./domain/device-install.js";
import { RESTARTED_WHILE_INSTALLING } from "./domain/stop-reason.js";
import { TestInstanceStateChanged } from "./domain/test-instance-events.js";
import { TestInstanceRefused } from "./domain/test-instance-refused.js";
import { launchedInstance, type TestInstance } from "./domain/test-instance.js";
import {
  ANN,
  APK_PATTERN,
  BUILD_TARGET,
  INSTALL_TARGET,
  PIXEL,
  testInstancesTestbed,
  WEB_TARGET,
  type TestInstancesTestbed,
} from "./test-instances.fixtures.js";

const APK = "app/build/outputs/apk/debug/app.apk";
const SERIAL = "192.168.1.20:5555";
const ADB_REFUSAL =
  "Performing Streamed Install\nadb: failed to install /office-test-build/app.apk: Failure [INSTALL_FAILED_UPDATE_INCOMPATIBLE: Existing package com.example.shop signatures do not match newer version; ignoring!]\n";

let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;
let moves: TestInstanceStateChanged[];

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  environments = await runEnvironmentsTestbed(runtime);
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
  testbed.project.targets.push(INSTALL_TARGET);
  moves = [];
  testbed.events.subscribe(TestInstanceStateChanged, (event) => {
    moves.push(event);
  });
  adbAnswers("Performing Streamed Install\nSuccess\n");
});

afterEach(async () => {
  for (const instance of await testbed.repository.active()) {
    await testbed.instances.stop(instance.id);
  }
  await testbed.instances.settled();
  await rm(environments.folder, { recursive: true, force: true });
});

function logOf(id: string): Promise<string> {
  return readFile(testbed.files.logOf(id), "utf8");
}

async function writeInto(folder: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
}

/** The Build to install instance Building now, if any. */
function buildingBuild(): TestInstance | undefined {
  return [...testbed.repository.rows.values()].find(
    ({ kind, state }) => kind === "build-to-install" && state === "building",
  );
}

/** Every build in the run environment writes `files` into its checkout and ends as `exitCode`. */
function buildMakes(files: Readonly<Record<string, string>>, exitCode = 0): void {
  runtime.onExec = async () => {
    const build = buildingBuild();
    if (build) await writeInto(testbed.officeData.testInstanceFolder(build.id), files);
    return { exitCode };
  };
}

/** Every adb install prints `output` and ends with `exitCode`; others end at once. */
function adbAnswers(output: string, exitCode = 0): void {
  runtime.onAttach = (process) => {
    if (!isInstall(process)) return;
    setImmediate(() => {
      process.print(output);
      process.end(exitCode);
    });
  };
}

/** Every adb install runs until it is stopped. */
function adbNeverEnds(): void {
  runtime.onAttach = () => undefined;
}

function isInstall(process: ScriptedAttachedProcess): boolean {
  return process.attachment.arguments.some(
    (argument) => argument === "install" || argument === "install-multiple",
  );
}

function adbInstalls(): ScriptedAttachedProcess[] {
  return runtime.attached.filter(isInstall);
}

async function until(condition: () => boolean | Promise<boolean>): Promise<void> {
  for (let tries = 0; !(await condition()); tries++) {
    if (tries > 400) throw new Error("It never happened.");
    await sleep(5);
  }
}

/** A promise that resolves once `open` is called. */
function gate(): { promise: Promise<void>; open: () => void } {
  const opened: (() => void)[] = [];
  const promise = new Promise<void>((resolve) => {
    opened.push(resolve);
  });
  return { promise, open: () => opened.forEach((resolve) => resolve()) };
}

function launchInstall(): Promise<TestInstance> {
  return testbed.instances.launchOnInitiative(
    testbed.initiativeId,
    { projectId: "shop", targetKey: INSTALL_TARGET.key },
    ANN,
  );
}

async function installAndSettle(): Promise<TestInstance> {
  const launched = await launchInstall();
  await testbed.instances.settled();
  return testbed.instances.read(launched.id);
}

async function refusalOf(launching: Promise<unknown>): Promise<TestInstanceRefused> {
  const error: unknown = await launching.then(
    () => undefined,
    (refused: unknown) => refused,
  );
  expect(error).toBeInstanceOf(TestInstanceRefused);
  return error as TestInstanceRefused;
}

function withBuildPatterns(outputPatterns: readonly string[]): void {
  testbed.project.targets = testbed.project.targets.map((target) =>
    target.key === BUILD_TARGET.key && target.kind !== "install-on-a-device"
      ? { ...target, outputPatterns }
      : target,
  );
}

describe("launching an Install on a device test instance", () => {
  it("answers it Building with its device and no port", async () => {
    buildMakes({ [APK]: "apk" });

    const launched = await launchInstall();

    expect(launched).toMatchObject({
      kind: "install-on-a-device",
      state: "building",
      port: undefined,
      device: { projectDeviceId: PIXEL.id, name: "Pixel", kind: "android-wireless" },
    });
  });

  it("is refused while the Project's Run environment is Off", async () => {
    testbed.project.runEnvironmentOn = false;

    const refusal = await refusalOf(launchInstall());

    expect(refusal.reasons).toEqual([
      "Turn the Project's Run environment On to install on a device.",
    ]);
  });

  it("is refused while its device is in use, naming the holder", async () => {
    testbed.devices.inUse.set(PIXEL.id, "Release on main");

    const refusal = await refusalOf(launchInstall());

    expect(refusal.reasons).toEqual(["Pixel is in use by Release on main."]);
    expect(testbed.repository.rows.size).toBe(0);
  });

  it("is refused when its Build to install target is gone, naming it", async () => {
    testbed.project.targets = testbed.project.targets.filter(({ key }) => key !== BUILD_TARGET.key);

    const refusal = await refusalOf(launchInstall());

    expect(refusal.reasons).toEqual([
      "The Build to install target android this target installs is gone; pick another in the Project's Test targets.",
    ]);
  });

  it("lists the target with what it installs and its device's name now", async () => {
    const listed = await testbed.instances.listForProject("shop");

    expect(listed.targets.find(({ key }) => key === INSTALL_TARGET.key)).toEqual({
      key: "phone",
      name: "Install on Pixel",
      kind: "install-on-a-device",
      entryPoint: undefined,
      installs: {
        buildTargetKey: "android",
        buildTargetName: "Android app",
        projectDeviceId: PIXEL.id,
        device: { projectDeviceId: PIXEL.id, name: "Pixel", kind: "android-wireless" },
      },
    });
  });
});

describe("its build", () => {
  it("launches a build of its target on the same branch, Built for it, then installs its APK", async () => {
    buildMakes({ [APK]: "apk bytes" });

    const instance = await installAndSettle();

    const build = [...testbed.repository.rows.values()].find(
      ({ kind }) => kind === "build-to-install",
    );
    expect(build).toMatchObject({
      state: "built",
      targetKey: "android",
      branch: "initiative/checkout",
      initiativeId: testbed.initiativeId,
      builtFor: { targetKey: "phone", targetName: "Install on Pixel" },
    });
    expect(instance).toMatchObject({
      state: "installed",
      buildInstanceId: build?.id,
      endedAt: testbed.schedule.now(),
    });
    expect(adbInstalls().map(({ attachment }) => attachment.arguments.slice(4))).toEqual([
      ["-s", SERIAL, "install", "-r", "/office-test-build/app.apk"],
    ]);
    const log = await logOf(instance.id);
    expect(log).toContain(`Building Android app first: the Test instance ${build?.id}`);
    expect(log).toContain("Success");
    expect(log).toContain("[The Office] Installed on Pixel.");
    expect(
      moves.filter(({ instanceId }) => instanceId === instance.id).map(({ to }) => to),
    ).toEqual(["installing", "installed"]);
    expect(moves.find(({ to }) => to === "installed")?.deviceName).toBe("Pixel");
    expect(moves.find(({ to }) => to === "built")?.builtFor).toBe("Install on Pixel");
  });

  it("holds the device in its own environment for the install alone, then lets go of it", async () => {
    buildMakes({ [APK]: "apk" });

    const instance = await installAndSettle();

    expect(testbed.devices.holds).toEqual([
      expect.objectContaining({
        projectId: "shop",
        projectDeviceId: PIXEL.id,
        instanceId: instance.id,
        holderName: "Install on Pixel in Checkout",
        startedBy: ANN.user,
        relayTab: undefined,
      }),
    ]);
    expect(testbed.devices.letGoOf).toHaveLength(1);
    expect(testbed.devices.open.size).toBe(0);
    expect([...runtime.projects.keys()].some((name) => name.includes(instance.id))).toBe(false);
  });

  it("fails as its build fails, in the build's words", async () => {
    buildMakes({}, 2);

    const instance = await installAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: "The build failed: The build ended with exit code 2.",
    });
    expect(testbed.devices.holds).toEqual([]);
  });

  it("counts as one with its build toward Test instances at once", async () => {
    testbed.settings.settings = { ...testbed.settings.settings, testInstancesAtOnce: 1 };
    runtime.keepExecsRunning();
    await launchInstall();
    await until(() => buildingBuild() !== undefined);

    const refusal = await refusalOf(
      testbed.instances.launchOnInitiative(
        testbed.initiativeId,
        { projectId: "shop", targetKey: WEB_TARGET.key },
        ANN,
      ),
    );

    expect(refusal.reasons).toEqual([
      "1 test instance is building, installing or running: Install on Pixel in Checkout. Stop one to launch another.",
    ]);
  });

  it("fails as it would start Installing when its device was taken while the build ran, the build kept", async () => {
    const { promise: building, open: finishBuild } = gate();
    runtime.onExec = async () => {
      const build = buildingBuild();
      if (build) await writeInto(testbed.officeData.testInstanceFolder(build.id), { [APK]: "apk" });
      await building;
      return { exitCode: 0 };
    };
    const launched = await launchInstall();
    await until(() => buildingBuild() !== undefined);
    testbed.devices.inUse.set(PIXEL.id, "Release on main");
    finishBuild();
    await testbed.instances.settled();

    expect(await testbed.instances.read(launched.id)).toMatchObject({
      state: "failed",
      failedReason: "Pixel is in use by Release on main.",
    });
    const build = [...testbed.repository.rows.values()].find(
      ({ kind }) => kind === "build-to-install",
    );
    expect(build).toMatchObject({ state: "built", filesRemovedAt: undefined });
  });
});

describe("reusing Built files", () => {
  it("installs the newest build of the branch at once when it ran the same commit, its log naming it", async () => {
    buildMakes({ [APK]: "apk" });
    const built = await testbed.buildAndSettle();

    const instance = await installAndSettle();

    expect(instance).toMatchObject({ state: "installed", buildInstanceId: built.id });
    expect(
      [...testbed.repository.rows.values()].filter(({ kind }) => kind === "build-to-install"),
    ).toHaveLength(1);
    expect(
      moves.filter(({ instanceId }) => instanceId === instance.id).map(({ to }) => to),
    ).toEqual(["installing", "installed"]);
    expect(await logOf(instance.id)).toContain(
      `[The Office] Reusing the files Built from c0ffee0 on 2003-04-05 at 10:00 UTC. Its build: the Test instance ${built.id}.`,
    );
  });

  it("builds them again when the branch has moved on since", async () => {
    buildMakes({ [APK]: "apk" });
    const built = await testbed.buildAndSettle();
    testbed.project.commit = "c0ffee0000000000000000000000000000000002";

    const instance = await installAndSettle();

    expect(instance.state).toBe("installed");
    expect(instance.buildInstanceId).not.toBe(built.id);
  });

  it("builds them again once that build's files were removed", async () => {
    buildMakes({ [APK]: "apk" });
    const built = await testbed.buildAndSettle();
    testbed.repository.rows.set(built.id, { ...built, filesRemovedAt: testbed.schedule.now() });

    const instance = await installAndSettle();

    expect(instance.buildInstanceId).not.toBe(built.id);
  });
});

describe("installing", () => {
  it("installs the split APKs of one app with install-multiple, naming the other files as ignored", async () => {
    withBuildPatterns([APK_PATTERN, "app/build/outputs/mapping/*.txt"]);
    buildMakes({
      "app/build/outputs/apk/debug/base.apk": "base",
      "app/build/outputs/apk/debug/split_config.arm64_v8a.apk": "split",
      "app/build/outputs/mapping/mapping.txt": "map",
    });

    const instance = await installAndSettle();

    expect(instance.state).toBe("installed");
    expect(adbInstalls()[0]?.attachment.arguments.slice(4)).toEqual([
      "-s",
      SERIAL,
      "install-multiple",
      "-r",
      "/office-test-build/base.apk",
      "/office-test-build/split_config.arm64_v8a.apk",
    ]);
    expect(await logOf(instance.id)).toContain(
      "[The Office] Not installing mapping.txt: only .apk files are installed.",
    );
  });

  it("fails with the phone's refusal", async () => {
    buildMakes({ [APK]: "apk" });
    adbAnswers(ADB_REFUSAL, 1);

    const instance = await installAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: "The phone refused the install: INSTALL_FAILED_UPDATE_INCOMPATIBLE.",
    });
    expect(await logOf(instance.id)).toContain("signatures do not match");
    expect(testbed.devices.open.size).toBe(0);
  });

  it("fails when the build made no .apk, holding no device", async () => {
    withBuildPatterns(["app/build/outputs/mapping/*.txt"]);
    buildMakes({ "app/build/outputs/mapping/mapping.txt": "map" });

    const instance = await installAndSettle();

    expect(instance).toMatchObject({ state: "failed", failedReason: NO_APK });
    expect(testbed.devices.holds).toEqual([]);
  });

  it("fails in Devices' words when the device can't be held", async () => {
    buildMakes({ [APK]: "apk" });
    testbed.devices.onHold = () =>
      Promise.resolve({ held: false, holdId: randomUUID(), problem: "Pixel didn't answer." });

    const instance = await installAndSettle();

    expect(instance).toMatchObject({ state: "failed", failedReason: "Pixel didn't answer." });
    expect(adbInstalls()).toEqual([]);
  });

  it("fails once the install runs past its 5 minutes, letting go of the device", async () => {
    buildMakes({ [APK]: "apk" });
    adbNeverEnds();
    const launched = await launchInstall();
    await until(() => adbInstalls().length === 1);

    await testbed.schedule.advanceBy(INSTALL_TIMEOUT_MS);
    await testbed.instances.settled();

    expect(await testbed.instances.read(launched.id)).toMatchObject({
      state: "failed",
      failedReason: INSTALL_RAN_OUT,
    });
    expect(adbInstalls()[0]?.stopped).toBe(true);
    expect(testbed.devices.open.size).toBe(0);
  });

  it("fails when its hold ends under it, as the Run environment turned Off does", async () => {
    buildMakes({ [APK]: "apk" });
    adbNeverEnds();
    const launched = await launchInstall();
    await until(() => adbInstalls().length === 1);

    testbed.devices.endHold(launched.id);
    await testbed.instances.settled();

    expect(await testbed.instances.read(launched.id)).toMatchObject({
      state: "failed",
      failedReason: "Pixel was disconnected before the install ended.",
    });
  });
});

describe("stopping an Install on a device test instance", () => {
  it("stops it while Building, and the build it launched with it", async () => {
    runtime.keepExecsRunning();
    const launched = await launchInstall();
    await until(() => buildingBuild() !== undefined);
    const build = buildingBuild();

    const stopped = await testbed.instances.stop(launched.id);
    await testbed.instances.settled();

    expect(stopped).toMatchObject({ state: "failed", failedReason: "Stopped by you." });
    expect(await testbed.instances.read(build?.id ?? "")).toMatchObject({
      state: "failed",
      failedReason: "Stopped by you.",
    });
    expect(testbed.devices.holds).toEqual([]);
    expect(moves.find(({ instanceId }) => instanceId === launched.id)?.stoppedBy).toBe("by-user");
  });

  it("stops it while Installing, letting go of the device and keeping the build", async () => {
    buildMakes({ [APK]: "apk" });
    adbNeverEnds();
    const launched = await launchInstall();
    await until(() => adbInstalls().length === 1);

    const stopped = await testbed.instances.stop(launched.id);
    await testbed.instances.settled();

    expect(stopped).toMatchObject({ state: "failed", failedReason: "Stopped by you." });
    expect(testbed.devices.letGoOf).toHaveLength(1);
    expect(testbed.devices.open.size).toBe(0);
    expect(await testbed.instances.read(stopped.buildInstanceId ?? "")).toMatchObject({
      state: "built",
    });
    expect([...runtime.projects.keys()].some((name) => name.includes(launched.id))).toBe(false);
  });

  it("is Failed by the sweep when The Office restarted while it was Installing", async () => {
    const installing: TestInstance = {
      ...launchedInstance({
        id: randomUUID(),
        initiativeId: testbed.initiativeId,
        projectId: "shop",
        branch: "initiative/checkout",
        targetKey: INSTALL_TARGET.key,
        targetName: INSTALL_TARGET.name,
        launchedBy: ANN,
        at: testbed.schedule.now(),
        kind: "install-on-a-device",
        device: { projectDeviceId: PIXEL.id, name: PIXEL.name, kind: PIXEL.kind },
      }),
      state: "installing",
      buildInstanceId: randomUUID(),
    };
    await testbed.repository.add(installing);

    await testbed.instances.sweep();

    expect(await testbed.instances.read(installing.id)).toMatchObject({
      state: "failed",
      failedReason: RESTARTED_WHILE_INSTALLING,
    });
    expect(await logOf(installing.id)).toContain(RESTARTED_WHILE_INSTALLING);
  });
});
