import { randomUUID } from "node:crypto";
import { access, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { parse as parseYaml } from "yaml";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../run-environments/index.fixtures.js";
import { REMOVING_ENDED_BUILDS } from "./application/test-build-retention.js";
import { DEVCONTAINER_SERVICE_BUILDS_NOTHING } from "./domain/entry-point.js";
import { BUILD_TIMEOUT_MS } from "./domain/test-build.js";
import { TestInstanceRefused } from "./domain/test-instance-refused.js";
import type { TestInstance } from "./domain/test-instance.js";
import type { WorkstationBuildEnd } from "./ports/project-test-targets.js";
import {
  ANN,
  APK_PATTERN,
  BUILD_SECRET,
  BUILD_TARGET,
  PROJECT_SECRET,
  testInstancesTestbed,
  type TestInstancesTestbed,
} from "./test-instances.fixtures.js";

const APK = "app/build/outputs/apk/debug/app.apk";
const DAY_MS = 24 * 60 * 60_000;

let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
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

async function exists(path: string): Promise<boolean> {
  return access(path).then(
    () => true,
    () => false,
  );
}

function logOf(id: string): Promise<string> {
  return readFile(testbed.files.logOf(id), "utf8");
}

async function writeInto(folder: string, files: Readonly<Record<string, string>>): Promise<void> {
  for (const [path, text] of Object.entries(files)) {
    await mkdir(dirname(join(folder, path)), { recursive: true });
    await writeFile(join(folder, path), text);
  }
}

/** The checkout of the one instance Building. */
function buildingCheckout(): string {
  const building = [...testbed.repository.rows.values()].find(({ state }) => state === "building");
  if (!building) throw new Error("Nothing is Building.");
  return testbed.officeData.testInstanceFolder(building.id);
}

/**
 * The build, in the run environment or on the workstation, writes `files` into its checkout and
 * ends as `end` says, printing `output`.
 */
function buildMakes(
  files: Readonly<Record<string, string>>,
  end: WorkstationBuildEnd = { exitCode: 0, endedBy: undefined },
  output = "",
): void {
  runtime.onExec = async () => {
    await writeInto(buildingCheckout(), files);
    return {
      exitCode: end.exitCode,
      output,
      ...(end.endedBy === "timeout" ? { endedBy: "timeout" as const } : {}),
    };
  };
  testbed.projects.onBuild = async (build) => {
    await writeInto(build.checkout, files);
    return end;
  };
}

/** Every build keeps running until it is stopped. */
function buildsRunUntilStopped(): void {
  testbed.projects.onBuild = (build) =>
    new Promise((resolve) => {
      build.signal.addEventListener("abort", () =>
        resolve({ exitCode: undefined, endedBy: "stop" }),
      );
    });
}

async function until(condition: () => boolean): Promise<void> {
  for (let tries = 0; !condition(); tries++) {
    if (tries > 200) throw new Error("It never happened.");
    await sleep(5);
  }
}

function withTarget(change: Partial<typeof BUILD_TARGET>): void {
  testbed.project.targets = testbed.project.targets.map((target) =>
    target.key === BUILD_TARGET.key ? { ...target, ...change } : target,
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

function launchBuild(): Promise<TestInstance> {
  return testbed.instances.launch(
    testbed.initiativeId,
    { projectId: "shop", targetKey: BUILD_TARGET.key },
    ANN,
  );
}

describe("building a Build to install test instance", () => {
  it("answers it Building with no Proxy port, then Built with its files kept in test-builds/<id>/", async () => {
    buildMakes({ [APK]: "apk bytes" });

    const launched = await launchBuild();
    expect(launched).toMatchObject({
      kind: "build-to-install",
      state: "building",
      port: undefined,
    });
    await testbed.instances.settled();
    const instance = await testbed.instances.read(launched.id);

    expect(instance).toMatchObject({
      state: "built",
      files: [{ name: "app.apk", size: expect.any(Number) }],
      filesRemovedAt: undefined,
      commit: testbed.project.commit,
      endedAt: testbed.schedule.now(),
    });
    const kept = testbed.files.buildFilesOf(instance.id);
    expect(kept).toBe(join(environments.folder, "office-data", "test-builds", instance.id));
    expect(await readFile(join(kept, "app.apk"), "utf8")).toBe("apk bytes");
    expect(await logOf(instance.id)).toContain("[The Office] Built: app.apk.");
    expect(await exists(testbed.officeData.testInstanceFolder(instance.id))).toBe(false);
  });

  it("lists the Build to install target beside the Hosted one", async () => {
    const [project] = await testbed.instances.listFor(testbed.initiativeId);

    expect(project?.targets.map(({ key, kind }) => ({ key, kind }))).toEqual([
      { key: "web", kind: "hosted" },
      { key: "android", kind: "build-to-install" },
    ]);
  });

  it("refuses a kind that isn't launched yet, naming it", async () => {
    testbed.project.targets.push({ ...BUILD_TARGET, key: "phone", kind: "install-on-a-device" });

    const refusal = await refusalOf(
      testbed.instances.launch(
        testbed.initiativeId,
        { projectId: "shop", targetKey: "phone" },
        ANN,
      ),
    );

    expect(refusal.reasons).toEqual([
      "Android app can't be launched; only Hosted and Build to install test targets launch for now.",
    ]);
  });

  it("builds in the run environment when it is On: only the checkout and the cache volume mounted, only the target's variables", async () => {
    let override: { services: Record<string, { volumes?: { source: string }[] }> } = {
      services: {},
    };
    buildMakes({ [APK]: "apk" }, undefined, `signing with ${BUILD_SECRET}\n`);
    const scripted = runtime.onExec;
    runtime.onExec = async (execution) => {
      const [id] = [...testbed.repository.rows.keys()];
      const file = join(environments.folders.testInstanceFolder(id ?? ""), "office-override.yaml");
      override = parseYaml(await readFile(file, "utf8")) as typeof override;
      return scripted(execution);
    };

    const instance = await testbed.buildAndSettle();

    expect(instance.state).toBe("built");
    const checkout = testbed.officeData.testInstanceFolder(instance.id);
    const mounts = Object.values(override.services).flatMap(({ volumes }) =>
      (volumes ?? []).map(({ source }) => source),
    );
    expect(mounts).toEqual([checkout, "office-build-cache"]);
    expect(runtime.executions[0]?.arguments).toEqual(["./gradlew", "assembleDebug"]);
    expect(runtime.executions[0]?.timeoutMs).toBe(BUILD_TIMEOUT_MS);
    expect(runtime.upped.map(({ variables }) => variables)).toEqual([
      { OFFICE_VARIABLE_0: "debug", OFFICE_VARIABLE_1: BUILD_SECRET },
    ]);
    expect(JSON.stringify(override)).not.toContain(PROJECT_SECRET);
    expect(testbed.projects.builds).toEqual([]);
    const log = await logOf(instance.id);
    expect(log).toContain("signing with [secret SIGNING_TOKEN]");
    expect(log).not.toContain(BUILD_SECRET);
    // Its compose project is gone with the build; the cache volume stays for the next.
    expect(runtime.projects.size).toBe(0);
  });

  it("builds on the workstation when the Run environment is Off, with only the target's variables", async () => {
    testbed.project.runEnvironmentOn = false;
    buildMakes({ [APK]: "apk" });

    const instance = await testbed.buildAndSettle();

    expect(instance.state).toBe("built");
    expect(testbed.projects.builds).toEqual([
      {
        checkout: testbed.officeData.testInstanceFolder(instance.id),
        folder: ".",
        commandLine: `'./gradlew' 'assembleDebug'`,
        variables: [
          { name: "FLAVOUR", value: "debug", secret: false },
          { name: "SIGNING_TOKEN", value: BUILD_SECRET, secret: true },
        ],
        logFile: testbed.files.logOf(instance.id),
        timeoutMs: BUILD_TIMEOUT_MS,
        signal: expect.any(AbortSignal) as AbortSignal,
      },
    ]);
    expect(runtime.steps).toEqual([]);
  });
});

describe("a build failing", () => {
  it.each([
    [
      "ends with a non-zero exit code",
      { exitCode: 1, endedBy: undefined },
      "The build ended with exit code 1.",
    ],
    [
      "runs out of its time",
      { exitCode: undefined, endedBy: "timeout" },
      "The build ran out of its 60 minutes.",
    ],
    ["can't run", { exitCode: 127, endedBy: "could-not-run" }, "The build couldn't run."],
  ] as const)("fails when it %s, saying why in its log", async (_, end, reason) => {
    testbed.project.runEnvironmentOn = false;
    buildMakes({ [APK]: "apk" }, end);

    const instance = await testbed.buildAndSettle();

    expect(instance).toMatchObject({ state: "failed", failedReason: reason, files: [] });
    expect(await logOf(instance.id)).toContain(`Failed: ${reason}`);
    expect(await exists(testbed.files.buildFilesOf(instance.id))).toBe(false);
    expect(await exists(testbed.officeData.testInstanceFolder(instance.id))).toBe(false);
  });

  it("fails on a non-zero exit in the run environment too", async () => {
    buildMakes({}, { exitCode: 2, endedBy: undefined });

    const instance = await testbed.buildAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: "The build ended with exit code 2.",
    });
  });

  it("fails naming the patterns when no file matches", async () => {
    buildMakes({ "app/build/outputs/bundle/app.aab": "aab" });

    const instance = await testbed.buildAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: `No file matched ${APK_PATTERN}.`,
    });
    expect(await logOf(instance.id)).toContain(`Failed: No file matched ${APK_PATTERN}.`);
  });

  it("refuses a match that is a link resolving outside the checkout, copying nothing", async () => {
    const outside = join(environments.folder, "outside.apk");
    await writeFile(outside, "not the build's");
    buildMakes({ [APK]: "apk" });
    const scripted = runtime.onExec;
    runtime.onExec = async (execution) => {
      const checkout = buildingCheckout();
      const result = await scripted(execution);
      await symlink(outside, join(checkout, "app/build/outputs/apk/debug/linked.apk"));
      return result;
    };

    const instance = await testbed.buildAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason:
        "app/build/outputs/apk/debug/linked.apk resolves outside the checkout, so no file was kept.",
    });
    expect(await exists(testbed.files.buildFilesOf(instance.id))).toBe(false);
  });

  it("refuses a pattern leading out of the checkout, copying nothing", async () => {
    withTarget({ outputPatterns: [APK_PATTERN, "../*.apk"] });
    buildMakes({ [APK]: "apk" });

    const instance = await testbed.buildAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: "The output pattern ../*.apk leads outside the checkout.",
    });
    expect(await exists(testbed.files.buildFilesOf(instance.id))).toBe(false);
  });

  it("fails a devcontainer service as its entry point, which builds nothing", async () => {
    withTarget({ entryPoint: { kind: "devcontainer-service", service: "app" } });

    const instance = await testbed.buildAndSettle();

    expect(instance).toMatchObject({
      state: "failed",
      failedReason: DEVCONTAINER_SERVICE_BUILDS_NOTHING,
    });
  });
});

describe("a build stopping", () => {
  it("is Failed on Stop while Building, saying so once in its log", async () => {
    testbed.project.runEnvironmentOn = false;
    buildsRunUntilStopped();
    const launched = await launchBuild();
    await until(() => testbed.projects.builds.length === 1);

    const stopped = await testbed.instances.stop(launched.id);
    await testbed.instances.settled();

    expect(stopped).toMatchObject({ state: "failed", failedReason: "Stopped by you." });
    expect(await testbed.instances.read(launched.id)).toMatchObject({ state: "failed" });
    const log = await logOf(launched.id);
    expect(log.match(/Stopped by you\./g)).toHaveLength(1);
    expect(log).not.toContain("Failed:");
    expect(await exists(testbed.officeData.testInstanceFolder(launched.id))).toBe(false);
  });

  it("counts toward Test instances at once from its launch", async () => {
    testbed.project.runEnvironmentOn = false;
    buildsRunUntilStopped();
    await launchBuild();
    await launchBuild();

    const refusal = await refusalOf(launchBuild());

    expect(refusal.message).toBe(
      "2 test instances are building or running: Android app in Checkout, Android app in Checkout. " +
        "Stop one to launch another.",
    );
  });

  it("is Failed by the sweep as The Office starts, its kept files left", async () => {
    buildMakes({ [APK]: "apk" });
    const built = await testbed.buildAndSettle();
    const building: TestInstance = {
      ...built,
      id: randomUUID(),
      state: "building",
      files: [],
      endedAt: undefined,
    };
    const restarted = testInstancesTestbed(
      environments.hostedServices,
      join(environments.folder, "office-data"),
    );
    await restarted.repository.add(built);
    await restarted.repository.add(building);

    await restarted.instances.sweep();

    expect(await restarted.instances.read(building.id)).toMatchObject({
      state: "failed",
      failedReason: "The Office restarted while it was Building.",
    });
    expect(await restarted.instances.read(built.id)).toEqual(built);
    expect(await exists(join(testbed.files.buildFilesOf(built.id), "app.apk"))).toBe(true);
  });
});

describe("kept Build to install files", () => {
  it("removes the oldest build's files as a fourth is Built, its row and log saying so", async () => {
    buildMakes({ [APK]: "apk" });
    const builds: TestInstance[] = [];
    for (let count = 0; count < 4; count++) {
      builds.push(await testbed.buildAndSettle());
      await testbed.schedule.advanceBy(60_000);
    }

    const [oldest, ...newer] = await Promise.all(
      builds.map(({ id }) => testbed.instances.read(id)),
    );
    expect(oldest).toMatchObject({
      state: "built",
      files: [{ name: "app.apk", size: expect.any(Number) }],
    });
    expect(oldest?.filesRemovedAt).toBeInstanceOf(Date);
    expect(await exists(testbed.files.buildFilesOf(oldest?.id ?? ""))).toBe(false);
    expect(await logOf(oldest?.id ?? "")).toContain(
      "The files were removed: the newest 3 builds are kept.",
    );
    for (const build of newer) {
      expect(build.filesRemovedAt).toBeUndefined();
      expect(await exists(join(testbed.files.buildFilesOf(build.id), "app.apk"))).toBe(true);
    }
  });

  it.each(["done", "dropped"] as const)(
    "removes every build's files 7 days after the Initiative is %s, not at 6",
    async (state) => {
      buildMakes({ [APK]: "apk" });
      const build = await testbed.buildAndSettle();
      const initiative = await testbed.initiatives.find(testbed.initiativeId);
      if (!initiative) throw new Error("No Initiative.");
      testbed.initiatives.put({ ...initiative, state, endedAt: testbed.schedule.now() });
      testbed.retention.start();

      await testbed.schedule.advanceBy(6 * DAY_MS);
      await testbed.schedule.runDaily(REMOVING_ENDED_BUILDS);
      expect((await testbed.instances.read(build.id)).filesRemovedAt).toBeUndefined();
      expect(await exists(testbed.files.buildFilesOf(build.id))).toBe(true);

      await testbed.schedule.advanceBy(DAY_MS);
      await testbed.schedule.runDaily(REMOVING_ENDED_BUILDS);

      expect((await testbed.instances.read(build.id)).filesRemovedAt).toEqual(
        testbed.schedule.now(),
      );
      expect(await exists(testbed.files.buildFilesOf(build.id))).toBe(false);
      expect(await logOf(build.id)).toContain(
        `The files were removed: the Initiative has been ${state === "done" ? "Done" : "Dropped"} for 7 days.`,
      );
    },
  );
});
