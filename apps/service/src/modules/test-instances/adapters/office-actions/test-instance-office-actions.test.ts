import { randomUUID } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { Test } from "@nestjs/testing";
import {
  LAUNCH_INITIATIVE_TEST_INSTANCE_ACTION,
  LAUNCH_PROJECT_TEST_INSTANCE_ACTION,
  LINK_BUILT_FILE_ACTION,
  OPEN_TEST_INSTANCE_ACTION,
  STOP_TEST_INSTANCE_ACTION,
  TEST_INSTANCE_OFFICE_ACTIONS,
} from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../../run-environments/index.fixtures.js";
import { TestInstanceHandOffs } from "../../application/test-instance-hand-offs.js";
import { OfficeHost } from "../../application/test-instance-proxy.js";
import { SessionPeople } from "../../ports/session-people.js";
import { WorkstationAddresses, type InterfaceAddress } from "../../ports/workstation-addresses.js";
import {
  INSTALL_TARGET,
  officeActionProviders,
  testInstancesTestbed,
  TESTBED_OFFICE_PORT,
  type TestInstancesTestbed,
} from "../../test-instances.fixtures.js";
import { TestInstanceOfficeActions } from "./test-instance-office-actions.js";

const ASKING_USER = { userId: "user-ann", name: "Ann Lee" };
const HAND_OFF = { token: "single-use-token", port: 4500 };
const LAN = "192.168.1.20";
const PUBLIC_ADDRESS = "https://office.example.com";

class SessionPeopleForTests extends SessionPeople {
  personInSession(): Promise<string | undefined> {
    return Promise.resolve("developer");
  }

  askedByInSession(): Promise<typeof ASKING_USER> {
    return Promise.resolve(ASKING_USER);
  }
}

class WorkstationForTests extends WorkstationAddresses {
  constructor(private readonly interfaces: readonly InterfaceAddress[]) {
    super();
  }

  list(): readonly InterfaceAddress[] {
    return this.interfaces;
  }
}

const LAN_INTERFACE: InterfaceAddress = { address: LAN, family: "IPv4", internal: false };

let runtime: ScriptedContainerRuntime;
let environments: RunEnvironmentsTestbed;
let testbed: TestInstancesTestbed;
let registry: OfficeToolRegistry;

async function startActions(
  options: {
    publicAddress?: string;
    interfaces?: readonly InterfaceAddress[];
    officeHost?: string;
  } = {},
): Promise<void> {
  const handOffs = { open: () => Promise.resolve(HAND_OFF) } as unknown as TestInstanceHandOffs;
  const providers = officeActionProviders(testbed, {
    handOffs,
    ...(options.publicAddress && { publicAddress: options.publicAddress }),
    workstation: new WorkstationForTests(options.interfaces ?? []),
    officeHost: new OfficeHost(options.officeHost ?? "0.0.0.0"),
  }).filter((each) => !("provide" in each) || each.provide !== SessionPeople);
  const module = await Test.createTestingModule({
    providers: [...providers, { provide: SessionPeople, useClass: SessionPeopleForTests }],
  }).compile();
  registry = module.get(OfficeToolRegistry);
  module.get(TestInstanceOfficeActions).onModuleInit();
}

beforeEach(async () => {
  runtime = new ScriptedContainerRuntime();
  runtime.keepExecsRunning();
  environments = await runEnvironmentsTestbed(runtime, undefined, undefined, {
    timeoutMs: 100,
    intervalMs: 5,
    answers: (port) => runtime.answers(port),
  });
  testbed = testInstancesTestbed(
    environments.hostedServices,
    join(environments.folder, "office-data"),
  );
  testbed.projects.onBuild = async ({ checkout }) => {
    const path = "app/build/outputs/apk/debug/app.apk";
    await mkdir(dirname(join(checkout, path)), { recursive: true });
    await writeFile(join(checkout, path), "apk bytes");
    return { exitCode: 0, endedBy: undefined };
  };
});

afterEach(async () => {
  for (const instance of await testbed.repository.active()) {
    await testbed.instances.stop(instance.id);
  }
  await testbed.instances.settled();
  await rm(environments.folder, { recursive: true, force: true });
});

/** The build runs on the workstation, as a Build to install does with the Run environment Off. */
function builtOnTheWorkstation() {
  testbed.project.runEnvironmentOn = false;
  return testbed.buildAndSettle();
}

function toolOf(name: string): OfficeTool {
  const [tool] = registry.named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${name} is not registered.`);
  return tool;
}

function call(name: string, input: unknown) {
  const tool = toolOf(name);
  return tool.run(tool.input.parse(input), anOfficeToolCall("session-1"));
}

describe("Test instances' Office actions", () => {
  it("are all registered as tools, in the group of their declaration", async () => {
    await startActions();

    for (const { name, group } of TEST_INSTANCE_OFFICE_ACTIONS) {
      expect(toolOf(name).authority?.group).toBe(group);
    }
  });

  it("launch on an Initiative as the person, recording the user who asked them", async () => {
    await startActions();

    const result = await call(LAUNCH_INITIATIVE_TEST_INSTANCE_ACTION.name, {
      initiativeId: testbed.initiativeId,
      projectId: "shop",
      targetKey: "web",
    });

    expect(result.isError).toBe(false);
    const [instance] = await testbed.repository.active();
    expect(instance?.launchedBy).toEqual({
      kind: "person",
      roleKey: "developer",
      askedBy: ASKING_USER,
    });
    expect(result.text).toContain(`"Web app" is launched on initiative/checkout`);
  });

  it("launch on a Project's branch and stop an instance, in words", async () => {
    await startActions();

    const launched = await call(LAUNCH_PROJECT_TEST_INSTANCE_ACTION.name, {
      projectId: "shop",
      branch: "initiative/checkout",
      targetKey: "web",
    });
    expect(launched.isError).toBe(false);
    const [instance] = await testbed.repository.active();
    if (!instance) throw new Error("Nothing was launched.");

    const stopped = await call(STOP_TEST_INSTANCE_ACTION.name, { instanceId: instance.id });

    expect(stopped.isError).toBe(false);
    expect(stopped.text).toContain('"Web app" on initiative/checkout is');
  });

  it("answer a refusal in words", async () => {
    await startActions();

    const result = await call(STOP_TEST_INSTANCE_ACTION.name, { instanceId: randomUUID() });

    expect(result.isError).toBe(true);
    expect(result.text).not.toBe("");
  });

  it("refuse an Install on a device over USB to a person, naming the Task page", async () => {
    await startActions();
    testbed.project.targets.push(INSTALL_TARGET);
    testbed.devices.devices.set("shop", [
      { id: INSTALL_TARGET.projectDeviceId, name: "Pixel 9", kind: "android-usb" },
    ]);

    const result = await call(LAUNCH_INITIATIVE_TEST_INSTANCE_ACTION.name, {
      initiativeId: testbed.initiativeId,
      projectId: "shop",
      targetKey: INSTALL_TARGET.key,
    });

    expect(result.isError).toBe(true);
    expect(result.text).toContain('"Pixel 9" is over USB');
    expect(result.text).toContain("from the Task page");
    expect(await testbed.repository.active()).toEqual([]);
  });

  describe("open_test_instance with no page", () => {
    it("answers a hand-off link at the workstation's LAN address", async () => {
      await startActions({ interfaces: [LAN_INTERFACE] });
      const instance = await testbed.launchAndSettle();

      const result = await call(OPEN_TEST_INSTANCE_ACTION.name, { instanceId: instance.id });

      expect(result.isError).toBe(false);
      expect(result.text).toContain(`http://${LAN}:${HAND_OFF.port}`);
      expect(result.text).toContain(`t=${HAND_OFF.token}`);
    });

    it("answers at The Office's public hostname when it has one", async () => {
      await startActions({
        publicAddress: PUBLIC_ADDRESS,
        interfaces: [LAN_INTERFACE],
      });
      const instance = await testbed.launchAndSettle();

      const result = await call(OPEN_TEST_INSTANCE_ACTION.name, { instanceId: instance.id });

      expect(result.text).toContain(`http://office.example.com:${HAND_OFF.port}`);
    });

    it("refuses a hostname that isn't offered, naming those that are", async () => {
      await startActions({ interfaces: [LAN_INTERFACE] });
      const instance = await testbed.launchAndSettle();

      const result = await call(OPEN_TEST_INSTANCE_ACTION.name, {
        instanceId: instance.id,
        hostname: "elsewhere.example",
      });

      expect(result.isError).toBe(true);
      expect(result.text).toContain("elsewhere.example");
      expect(result.text).toContain(LAN);
      expect(result.text).not.toContain(HAND_OFF.token);
    });
  });

  describe("link_built_file with no page", () => {
    it("links at the public address", async () => {
      await startActions({ publicAddress: PUBLIC_ADDRESS, interfaces: [LAN_INTERFACE] });
      const built = await builtOnTheWorkstation();

      const result = await call(LINK_BUILT_FILE_ACTION.name, {
        instanceId: built.id,
        name: "app.apk",
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain(`${PUBLIC_ADDRESS}/api/`);
    });

    it("links at the first LAN address at The Office's port without a public address", async () => {
      await startActions({ interfaces: [LAN_INTERFACE] });
      const built = await builtOnTheWorkstation();

      const result = await call(LINK_BUILT_FILE_ACTION.name, {
        instanceId: built.id,
        name: "app.apk",
      });

      expect(result.text).toContain(`http://${LAN}:${TESTBED_OFFICE_PORT}/api/`);
    });

    it("links at OFFICE_HOST when The Office listens at one address", async () => {
      await startActions({ officeHost: "10.1.1.70", interfaces: [LAN_INTERFACE] });
      const built = await builtOnTheWorkstation();

      const result = await call(LINK_BUILT_FILE_ACTION.name, {
        instanceId: built.id,
        name: "app.apk",
      });

      expect(result.text).toContain(`http://10.1.1.70:${TESTBED_OFFICE_PORT}/api/`);
      expect(result.text).not.toContain(LAN);
    });

    it("asks for the LAN address while The Office listens on loopback only", async () => {
      await startActions({ officeHost: "127.0.0.1", interfaces: [LAN_INTERFACE] });
      const built = await builtOnTheWorkstation();

      const result = await call(LINK_BUILT_FILE_ACTION.name, {
        instanceId: built.id,
        name: "app.apk",
      });

      expect(result.text).toContain("open The Office by its LAN address");
      expect(result.text).not.toContain(LAN);
    });

    it("asks the user to open The Office by its LAN address when it has none", async () => {
      await startActions();
      const built = await builtOnTheWorkstation();

      const result = await call(LINK_BUILT_FILE_ACTION.name, {
        instanceId: built.id,
        name: "app.apk",
      });

      expect(result.isError).toBe(false);
      expect(result.text).toContain("open The Office by its LAN address");
    });
  });
});
