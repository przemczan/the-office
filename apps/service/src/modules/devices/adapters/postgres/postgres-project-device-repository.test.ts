import { randomUUID } from "node:crypto";
import type { INestApplication } from "@nestjs/common";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { startTestApplication } from "../../../../../test/test-application.js";
import {
  pairingCutOff,
  pairingStarted,
  pairingSucceeded,
  projectDeviceRenamed,
  usbProjectDevice,
  wirelessProjectDevice,
  type ProjectDevice,
} from "../../domain/project-device.js";
import { ProjectDeviceChanged } from "../../domain/project-device-events.js";
import { ProjectDeviceRefused } from "../../domain/project-device-refused.js";
import { PostgresProjectDeviceRepository } from "./postgres-project-device-repository.js";

let app: INestApplication;
let repository: PostgresProjectDeviceRepository;

beforeAll(async () => {
  ({ app } = await startTestApplication({
    database: true,
    providers: [PostgresProjectDeviceRepository],
  }));
  repository = app.get(PostgresProjectDeviceRepository);
});

afterAll(async () => {
  await app.close();
});

const ANN = { userId: "user-ann", name: "Ann Lee" };

function aBoard(projectId: string, deviceKey: string, at: Date): ProjectDevice {
  return usbProjectDevice({
    id: randomUUID(),
    projectId,
    kind: "serial-usb",
    name: "Arduino Uno",
    deviceKey,
    addedBy: ANN,
    addedAt: at,
  }).device;
}

function aPhone(projectId: string, address: string, at: Date): ProjectDevice {
  return wirelessProjectDevice({
    id: randomUUID(),
    projectId,
    address,
    deviceKey: `android-wireless:${address}`,
    port: 41_234,
    addedBy: ANN,
    addedAt: at,
  }).device;
}

describe("PostgresProjectDeviceRepository", () => {
  it("keeps devices in the order added, a device key unique per Project only", async () => {
    const projectId = `project-${randomUUID()}`;
    const otherProject = `project-${randomUUID()}`;
    const key = `usb:${randomUUID()}`;
    const first = aBoard(projectId, key, new Date("2004-02-01T10:00:00Z"));
    const phone = aPhone(projectId, "192.168.1.20", new Date("2004-02-01T10:01:00Z"));

    expect(await repository.insert(first)).toBe("kept");
    expect(await repository.insert(phone)).toBe("kept");
    expect(await repository.insert(aBoard(projectId, key, new Date("2004-02-01T10:02:00Z")))).toBe(
      "device-key-taken",
    );
    expect(
      await repository.insert(aBoard(otherProject, key, new Date("2004-02-01T10:03:00Z"))),
    ).toBe("kept");

    expect(await repository.listOf(projectId)).toEqual([first, phone]);
    expect(await repository.find(phone.id)).toEqual(phone);
  });

  it("keeps a change, skips one to nothing, and refuses a new device key the Project has", async () => {
    const projectId = `project-${randomUUID()}`;
    const phone = aPhone(projectId, "192.168.1.20", new Date("2004-02-02T10:00:00Z"));
    const other = aPhone(projectId, "192.168.1.21", new Date("2004-02-02T10:01:00Z"));
    await repository.insert(phone);
    await repository.insert(other);

    const paired = await repository.update(phone.id, (device) =>
      pairingSucceeded(device, "Pixel 9"),
    );
    expect(paired).toMatchObject({ kind: "changed", change: { device: { name: "Pixel 9" } } });
    expect(
      await repository.update(phone.id, (device) => projectDeviceRenamed(device, "Pixel 9")),
    ).toEqual({ kind: "unchanged" });
    expect(
      await repository.update(phone.id, (device) =>
        pairingStarted(device, {
          address: "192.168.1.21",
          deviceKey: "android-wireless:192.168.1.21",
          port: 40_000,
        }),
      ),
    ).toEqual({ kind: "device-key-taken" });
    expect(await repository.find(phone.id)).toMatchObject({
      address: "192.168.1.20",
      state: "paired",
      lastUse: null,
    });
    await expect(
      repository.update(phone.id, (device) => projectDeviceRenamed(device, " ")),
    ).rejects.toBeInstanceOf(ProjectDeviceRefused);
    expect(await repository.update(randomUUID(), pairingCutOff)).toEqual({ kind: "missing" });
  });

  it("keeps a last use, lists the pairing ones, and removes a device", async () => {
    const projectId = `project-${randomUUID()}`;
    const phone = aPhone(projectId, "192.168.1.20", new Date("2004-02-03T10:00:00Z"));
    await repository.insert(phone);
    const lastUse = {
      holder: { kind: "task", taskId: randomUUID(), title: "Install on the phone" },
      endedAt: "2004-02-03T11:00:00.000Z",
      endedBecause: "device-unplugged",
    } as const;
    await repository.update(phone.id, (device) => ({
      device: { ...device, lastUse },
      event: new ProjectDeviceChanged(device.projectId, device.id),
    }));

    expect((await repository.find(phone.id))?.lastUse).toEqual(lastUse);
    expect((await repository.pairing()).map(({ id }) => id)).toContain(phone.id);

    expect(await repository.remove(phone.id)).toBe(true);
    expect(await repository.remove(phone.id)).toBe(false);
    expect(await repository.find(phone.id)).toBeUndefined();
  });
});
