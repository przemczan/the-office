import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ConnectedDevice } from "../domain/connected-device.js";
import { ADB_MISSING, AdbInRunEnvironment, type AdbPlace } from "./adb-in-run-environment.js";

/** How long after adb dropped its connection it connects again. */
export const ADB_RECONNECT_DELAY_MS = 2_000;
/** At most one reconnect per device in this long, so a phone that keeps dropping isn't hammered. */
export const ADB_RECONNECT_INTERVAL_MS = 30_000;

/** A device Connected at the helper's endpoint, as adb connects to it. */
export type ConnectedAndroidPhone = ConnectedDevice & { readonly endpoint: string };

/**
 * An Android phone over USB in the run environment (spec §2.13, "Android phone over USB"): once
 * its helper is ready, adb is checked, the Project's key written and `adb connect` run to the
 * helper's endpoint, never waiting for the phone's own Allow; connected again when adb drops the
 * connection; `adb disconnect` as it disconnects.
 */
@Injectable()
export class AndroidUsbDevices {
  private readonly logger = new Logger(AndroidUsbDevices.name);
  /** When each device last connected again, for the interval between reconnects. */
  private readonly reconnectedAt = new Map<string, number>();

  constructor(
    private readonly adb: AdbInRunEnvironment,
    private readonly schedule: Schedule,
  ) {}

  /** The helper is ready at the endpoint: answers why the phone can't be used, or nothing. */
  async helperReady(device: ConnectedAndroidPhone): Promise<string | undefined> {
    const place = this.placeOf(device);
    const check = await this.adb.ensureAdb(place);
    if (check === "missing") return ADB_MISSING;
    if (check === "not-running") return undefined;
    const problem = await this.adb.writeKey(place);
    if (problem !== undefined) return problem;
    await this.adb.connect(place, device.endpoint);
    return undefined;
  }

  /**
   * adb's last connection to the helper closed, as when an Agent ran `adb kill-server`: connects
   * again after `ADB_RECONNECT_DELAY_MS` while the device is still Connected at that endpoint, at
   * most once per `ADB_RECONNECT_INTERVAL_MS`.
   */
  connectionsClosed(
    device: ConnectedAndroidPhone,
    current: (id: string) => Promise<ConnectedDevice | undefined>,
  ): void {
    const now = this.schedule.now().getTime();
    const last = this.reconnectedAt.get(device.id);
    if (last !== undefined && now - last < ADB_RECONNECT_INTERVAL_MS) return;
    this.reconnectedAt.set(device.id, now);
    this.schedule.once(
      "android-usb-reconnect",
      new Date(now + ADB_RECONNECT_DELAY_MS),
      async () => {
        const kept = await current(device.id);
        if (kept?.state !== "connected" || kept.endpoint !== device.endpoint) return;
        await this.adb.connect(this.placeOf(device), device.endpoint);
      },
    );
  }

  /** The device was disconnected: adb forgets its serial, best effort. */
  async disconnected(device: ConnectedAndroidPhone): Promise<void> {
    this.reconnectedAt.delete(device.id);
    await this.adb.disconnect(this.placeOf(device), device.endpoint).catch((error: unknown) => {
      this.logger.warn(
        `adb disconnect ${device.endpoint} in the Task ${device.taskId} failed.`,
        error,
      );
    });
  }

  private placeOf(device: ConnectedAndroidPhone): AdbPlace {
    return this.adb.inTask(device.taskId, device.projectId);
  }
}
