import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import { sql, type SQL } from "drizzle-orm";
import { DATABASE, type Database } from "../../../../platform/database/database.js";
import {
  connectingDevice,
  deviceBaudRateSet,
  deviceConnected,
  deviceDisconnected,
  deviceNoticed,
  deviceRoundTripMeasured,
  heldDevice,
  type ConnectedDevice,
  type RunHolder,
} from "../../domain/connected-device.js";
import { PostgresConnectedDeviceRepository } from "./postgres-connected-device-repository.js";

let app: INestApplication;
let repository: PostgresConnectedDeviceRepository;
let database: Database;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresConnectedDeviceRepository],
  }));
  repository = app.get(PostgresConnectedDeviceRepository);
  database = app.get(DATABASE);
});

afterAll(async () => {
  await app.close();
});

/** The constraint that refused the statement; undefined when it ran. */
async function constraintRefusing(statement: SQL): Promise<string | undefined> {
  try {
    await database.execute(statement);
    return undefined;
  } catch (error) {
    const cause: unknown = error instanceof Error ? (error.cause ?? error) : error;
    return typeof cause === "object" && cause !== null && "constraint" in cause
      ? String(cause.constraint)
      : String(error);
  }
}

/** A device of this test's own Task and Project, under a key no other file's rows hold. */
function aDevice(taskId: string, deviceKey: string, at: Date, projectId = "shop"): ConnectedDevice {
  return connectingDevice({
    id: randomUUID(),
    taskId,
    projectId,
    kind: "android-usb",
    name: "Pixel 9",
    deviceKey,
    connectedBy: { userId: "user-ann", name: "Ann Lee" },
    connectedAt: at,
  }).device;
}

describe("PostgresConnectedDeviceRepository", () => {
  it("refuses a second open record with the same device key, answering the one that holds it", async () => {
    const key = `usb:${randomUUID()}`;
    const first = aDevice(randomUUID(), key, new Date("2004-01-01T10:00:00Z"));
    const second = aDevice(randomUUID(), key, new Date("2004-01-01T10:01:00Z"));

    expect(await repository.insert(first)).toEqual({});
    expect(await repository.insert(second)).toEqual({ heldBy: first });
    expect(await repository.find(second.id)).toBeUndefined();
  });

  it("takes the same device key again once the record holding it is Disconnected", async () => {
    const key = `usb:${randomUUID()}`;
    const taskId = randomUUID();
    const first = aDevice(taskId, key, new Date("2004-01-02T10:00:00Z"));
    await repository.insert(first);
    await repository.update(first.id, (device) =>
      deviceDisconnected(device, { because: "tab-closed", at: new Date("2004-01-02T10:05:00Z") }),
    );

    const again = aDevice(taskId, key, new Date("2004-01-02T10:06:00Z"));
    expect(await repository.insert(again)).toEqual({});

    expect((await repository.listOfTask(taskId)).map(({ id }) => id)).toEqual([again.id, first.id]);
    expect((await repository.openOfTask(taskId)).map(({ id }) => id)).toEqual([again.id]);
  });

  it("keeps a change, lists the open ones of a Project and of all, and skips a change to nothing", async () => {
    const projectId = `project-${randomUUID()}`;
    const device = aDevice(
      randomUUID(),
      `usb:${randomUUID()}`,
      new Date("2004-01-03T10:00:00Z"),
      projectId,
    );
    await repository.insert(device);

    const changed = await repository.update(device.id, (kept) =>
      deviceConnected(kept, "127.0.0.1:41234"),
    );
    expect(changed?.device.state).toBe("connected");
    expect(
      await repository.update(device.id, (kept) => deviceConnected(kept, "127.0.0.1:41234")),
    ).toBeUndefined();
    expect(await repository.find(device.id)).toEqual({
      ...device,
      state: "connected",
      everConnected: true,
      endpoint: "127.0.0.1:41234",
    });

    expect((await repository.openOfProject(projectId)).map(({ id }) => id)).toEqual([device.id]);
    expect((await repository.allOpen()).map(({ id }) => id)).toContain(device.id);
  });

  it("keeps the Project device a lent record came from, and finds the open one naming it", async () => {
    const projectDeviceId = randomUUID();
    const lent = connectingDevice({
      id: randomUUID(),
      taskId: randomUUID(),
      projectId: "shop",
      projectDeviceId,
      kind: "serial-usb",
      name: "Arduino Uno",
      deviceKey: `usb:${randomUUID()}`,
      connectedBy: { userId: "user-ann", name: "Ann Lee" },
      connectedAt: new Date("2004-01-05T10:00:00Z"),
    }).device;
    const own = aDevice(randomUUID(), `usb:${randomUUID()}`, new Date("2004-01-05T10:01:00Z"));
    await repository.insert(lent);
    await repository.insert(own);

    expect(await repository.find(lent.id)).toEqual(lent);
    expect((await repository.find(own.id))?.projectDeviceId).toBeNull();
    expect(await repository.openOfProjectDevice(projectDeviceId)).toEqual(lent);

    await repository.update(lent.id, (device) =>
      deviceDisconnected(device, { because: "by-user", at: new Date("2004-01-05T10:05:00Z") }),
    );
    expect(await repository.openOfProjectDevice(projectDeviceId)).toBeUndefined();
    expect((await repository.find(lent.id))?.projectDeviceId).toBe(projectDeviceId);
  });

  it("keeps a serial board's RFC 2217 address, baud rate, round trip and notice", async () => {
    const device = {
      ...aDevice(randomUUID(), `usb:${randomUUID()}`, new Date("2004-01-04T10:00:00Z")),
      kind: "serial-usb" as const,
    };
    await repository.insert(device);
    expect(await repository.find(device.id)).toMatchObject({
      rfc2217Url: null,
      baudRate: null,
      roundTripMs: null,
      notice: null,
    });

    await repository.update(device.id, (kept) =>
      deviceConnected(kept, "/dev/ttyACM0", kept.name, "rfc2217://127.0.0.1:2217"),
    );
    await repository.update(device.id, (kept) => deviceBaudRateSet(kept, 115_200));
    await repository.update(device.id, (kept) => deviceRoundTripMeasured(kept, 312));
    await repository.update(device.id, (kept) => deviceNoticed(kept, "port-busy"));

    expect(await repository.find(device.id)).toEqual({
      ...device,
      state: "connected",
      everConnected: true,
      endpoint: "/dev/ttyACM0",
      rfc2217Url: "rfc2217://127.0.0.1:2217",
      baudRate: 115_200,
      roundTripMs: 312,
      notice: "port-busy",
    });
  });

  it("keeps a run's hold with its holder, name, relay tab and whether it was ever Connected", async () => {
    const holders: RunHolder[] = [
      { kind: "action-run", actionRunId: randomUUID(), name: "Install on my phone" },
      { kind: "test-instance", testInstanceId: randomUUID(), name: "Install on a device" },
    ];
    for (const holder of holders) {
      const { device } = heldDevice({
        id: randomUUID(),
        runHolder: holder,
        projectId: "shop",
        projectDeviceId: randomUUID(),
        kind: "android-usb",
        name: "Pixel 9",
        deviceKey: `usb:${randomUUID()}`,
        relayTab: randomUUID(),
        connectedBy: { userId: "user-ann", name: "Ann Lee" },
        connectedAt: new Date("2004-01-06T10:00:00Z"),
      });
      await repository.insert(device);

      expect(await repository.find(device.id)).toEqual(device);
      expect(device).toMatchObject({ taskId: null, everConnected: false });
      await repository.update(device.id, (kept) => deviceConnected(kept, "127.0.0.1:41234"));
      await repository.update(device.id, (kept) =>
        deviceDisconnected(kept, { because: "run-ended", at: new Date("2004-01-06T10:05:00Z") }),
      );
      expect(await repository.find(device.id)).toMatchObject({
        runHolder: holder,
        everConnected: true,
        state: "disconnected",
        disconnectedBecause: "run-ended",
      });
    }
  });

  it("refuses a record with no holder, or with two", async () => {
    const device = aDevice(randomUUID(), `usb:${randomUUID()}`, new Date("2004-01-07T10:00:00Z"));
    await repository.insert(device);

    expect(
      await constraintRefusing(
        sql`update connected_devices set task_id = null where id = ${device.id}`,
      ),
    ).toBe("connected_devices_one_holder");
    expect(
      await constraintRefusing(
        sql`update connected_devices set action_run_id = ${randomUUID()} where id = ${device.id}`,
      ),
    ).toBe("connected_devices_one_holder");
    expect((await repository.find(device.id))?.taskId).toBe(device.taskId);
  });
});
