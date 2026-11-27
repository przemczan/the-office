import { rm } from "node:fs/promises";
import { Test } from "@nestjs/testing";
import { DEVICE_OFFICE_ACTIONS, LEND_PROJECT_DEVICE_ACTION } from "@the-office/contracts";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { anOfficeToolCall, RUN_EVERY_CALL } from "../../../engine/index.fixtures.js";
import { OfficeToolRegistry, type OfficeTool } from "../../../engine/index.js";
import {
  runEnvironmentsTestbed,
  ScriptedContainerRuntime,
  type RunEnvironmentsTestbed,
} from "../../../run-environments/index.fixtures.js";
import { devicesTestbed, PROJECT_ID, type DevicesTestbed } from "../../devices.fixtures.js";
import { ProjectDevices } from "../../application/project-devices.js";
import { SessionPeople } from "../../ports/session-people.js";
import { DeviceOfficeActions } from "./device-office-actions.js";

const TASK_ID = "00000000-0000-4000-8000-00000000d201";
const ASKING_USER = { userId: "user-ann", name: "Ann Lee" };
const ADDRESS = "192.168.1.20";
const PORT = 41_234;
const SERIAL = `${ADDRESS}:${PORT}`;
const PHONE = {
  kind: "android-wireless",
  address: ADDRESS,
  port: PORT,
  pairingPort: 37_000,
  pairingCode: "482913",
} as const;
const BOARD = { kind: "serial-usb", name: "Arduino Uno", deviceKey: "usb:2341:0043:1" } as const;
const USER = { userId: "u", name: "U" };

class SessionPeopleForTests extends SessionPeople {
  personInSession(): Promise<string | undefined> {
    return Promise.resolve("developer");
  }

  askedByInSession(): Promise<typeof ASKING_USER> {
    return Promise.resolve(ASKING_USER);
  }
}

let testbed: DevicesTestbed<RunEnvironmentsTestbed>;
let registry: OfficeToolRegistry;

beforeEach(async () => {
  const runtime = new ScriptedContainerRuntime();
  testbed = await devicesTestbed(runtime, await runEnvironmentsTestbed(runtime));
  await testbed.addTask(TASK_ID, "Install on the phone");
  const module = await Test.createTestingModule({
    providers: [
      { provide: ProjectDevices, useValue: testbed.projectDevices },
      { provide: SessionPeople, useClass: SessionPeopleForTests },
      OfficeToolRegistry,
      DeviceOfficeActions,
    ],
  }).compile();
  registry = module.get(OfficeToolRegistry);
  module.get(DeviceOfficeActions).onModuleInit();
});

afterEach(async () => {
  await testbed.projectDevices.settled();
  await rm(testbed.environments.folder, { recursive: true, force: true });
});

function toolOf(name: string): OfficeTool {
  const [tool] = registry.named([name], RUN_EVERY_CALL);
  if (!tool) throw new Error(`${name} is not registered.`);
  return tool;
}

function lend(projectDeviceId: string) {
  const tool = toolOf(LEND_PROJECT_DEVICE_ACTION.name);
  return tool.run(
    tool.input.parse({ taskId: TASK_ID, projectDeviceId }),
    anOfficeToolCall("session-1"),
  );
}

async function pairedPhone(name?: string): Promise<string> {
  const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, USER);
  await testbed.projectDevices.settled();
  if (name !== undefined) await testbed.projectDevices.change(device.id, { name });
  return device.id;
}

describe("Devices' Office actions", () => {
  it("are all registered as tools, in the group of their declaration", () => {
    for (const { name, group } of DEVICE_OFFICE_ACTIONS) {
      expect(toolOf(name).authority?.group).toBe(group);
    }
  });

  it("lend a phone to a Task as the person, recording the user who asked them", async () => {
    const id = await pairedPhone("Pixel");

    const result = await lend(id);

    expect(result.isError).toBe(false);
    const [lent] = await testbed.repository.listOfTask(TASK_ID);
    expect(lent?.connectedBy).toEqual({ ...ASKING_USER, person: "developer" });
  });

  it("show an Agent the device's kind, name and state and a phone's adb serial, never its Address or Port", async () => {
    const id = await pairedPhone("Pixel");

    const { text } = await lend(id);

    expect(text).toContain("Pixel (android-wireless)");
    expect(text).toContain(`adb serial ${SERIAL}`);
    const withoutSerial = text.replaceAll(SERIAL, "");
    expect(withoutSerial).not.toContain(ADDRESS);
    expect(withoutSerial).not.toContain(String(PORT));
  });

  it("call a phone nobody has named by what it is, never by its address", async () => {
    const id = await pairedPhone(ADDRESS);

    const { text } = await lend(id);

    expect(text).toContain("an unnamed phone (android-wireless)");
    expect(text.replaceAll(SERIAL, "")).not.toContain(ADDRESS);
  });

  it("leave the address out of a refusal", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, PHONE, USER);

    const result = await lend(device.id);

    expect(result.isError).toBe(true);
    expect(result.text).not.toContain(ADDRESS);
    expect(result.text).not.toContain(String(PORT));
  });

  it("refuse a device over USB to a person, naming the Task page", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, USER);

    const result = await lend(device.id);

    expect(result.isError).toBe(true);
    expect(result.text).toContain('"Arduino Uno" is over USB');
    expect(result.text).toContain("lends it from the Task page");
    expect(await testbed.repository.listOfTask(TASK_ID)).toEqual([]);
  });

  it("still lend a device over USB to the user, as before", async () => {
    const { device } = await testbed.projectDevices.add(PROJECT_ID, BOARD, USER);

    const lent = await testbed.projectDevices.lend(TASK_ID, device.id, ASKING_USER);

    expect(lent.connectedBy).toEqual(ASKING_USER);
  });
});
