import { Injectable, Logger } from "@nestjs/common";
import { Schedule } from "../../../platform/schedule/schedule.js";
import type { ConnectedDevice } from "../domain/connected-device.js";
import { adbSerialAt, type WirelessAddress } from "../domain/wireless-address.js";
import { ADB_MISSING, AdbInRunEnvironment, type AdbPlace } from "./adb-in-run-environment.js";

/** How long pairing may take once the run environment runs: adb's check, the key, pair and connect. */
export const PAIRING_TIMEOUT_MS = 30_000;
/** How long a start waits for a paired phone to connect again, as it waits for a helper. */
export const WIRELESS_RECONNECT_TIMEOUT_MS = 10_000;

/** Said when the run environment stopped before adb could run. */
const STOPPED_WHILE_PAIRING = "The run environment stopped while pairing; pair it again.";

/** Where to pair with a phone and connect to it, from its Wireless debugging screen. */
export interface PhoneToPair {
  readonly address: WirelessAddress;
  /** The connect port on the Wireless debugging screen. */
  readonly port: number;
  /** The port of "Pair device with pairing code". */
  readonly pairingPort: number;
}

/** A device whose Task's run environment adb runs in. */
export type PhoneOfTask = Pick<ConnectedDevice, "id" | "taskId" | "projectId">;

/** A phone over wireless debugging that was paired: its adb serial, `<address>:<port>`. */
export type PairedPhone = PhoneOfTask & { readonly endpoint: string };

/** How a pairing or a reconnect ended. */
export type WirelessEnd =
  | { readonly kind: "connected"; readonly endpoint: string; readonly model: string | undefined }
  /** The phone didn't answer at its serial, as when it left the network or its port changed. */
  | { readonly kind: "unanswered" }
  | { readonly kind: "failed"; readonly problem: string }
  /** The run environment isn't running, so nothing was tried. */
  | { readonly kind: "not-running" };

/**
 * An Android phone over wireless debugging (spec §2.13, "Android phone over wireless debugging"):
 * adb in the run environment pairs with the phone by its pairing code, with the Project's adb key,
 * and connects to it directly, with no relay and no helper; at each later start it only connects
 * again, which the phone allows for the key it paired with. The pairing code goes to `adb pair`'s
 * standard input and nowhere else.
 */
@Injectable()
export class WirelessDevices {
  private readonly logger = new Logger(WirelessDevices.name);

  constructor(
    private readonly adb: AdbInRunEnvironment,
    private readonly schedule: Schedule,
  ) {}

  /** adb's check, the Project's key, `adb pair` and `adb connect` in the Task's run environment. */
  pair(phone: PhoneOfTask, target: PhoneToPair, pairingCode: string): Promise<WirelessEnd> {
    return this.pairIn(this.placeOf(phone), target, pairingCode);
  }

  /**
   * adb's check, the Project's key, `adb pair` and `adb connect` where adb runs, then the model,
   * within `PAIRING_TIMEOUT_MS`; `connected` is told once adb connected, before the model is read.
   */
  pairIn(
    place: AdbPlace,
    target: PhoneToPair,
    pairingCode: string,
    connected?: () => Promise<void>,
  ): Promise<WirelessEnd> {
    return this.within(
      PAIRING_TIMEOUT_MS,
      {
        kind: "failed",
        problem: `The phone didn't pair within ${PAIRING_TIMEOUT_MS / 1000} seconds. Check its address and ports, then pair it again with a new code.`,
      },
      async () => {
        const ready = await this.adbReady(place);
        if (ready !== undefined)
          return ready.kind === "not-running" ? stoppedWhilePairing() : ready;
        const pairingTarget = adbSerialAt(target.address, target.pairingPort);
        const problem = await this.adb.pair(place, pairingTarget, pairingCode);
        if (problem !== undefined) return { kind: "failed", problem };
        const endpoint = adbSerialAt(target.address, target.port);
        if (!(await this.adb.connect(place, endpoint))) {
          return {
            kind: "failed",
            problem: `adb paired with the phone but couldn't connect to it at ${endpoint}. Check the port its Wireless debugging screen shows, then pair it again.`,
          };
        }
        await connected?.();
        return { kind: "connected", endpoint, model: await this.adb.modelOf(place, endpoint) };
      },
    );
  }

  /**
   * adb's check, the Project's key and `adb connect` to the paired phone, never pairing, within
   * `WIRELESS_RECONNECT_TIMEOUT_MS`; never throws.
   */
  async reconnect(phone: PairedPhone): Promise<WirelessEnd> {
    try {
      return await this.within(WIRELESS_RECONNECT_TIMEOUT_MS, { kind: "unanswered" }, async () => {
        const place = this.placeOf(phone);
        const ready = await this.adbReady(place);
        if (ready !== undefined) return ready;
        if (!(await this.adb.connect(place, phone.endpoint))) return { kind: "unanswered" };
        const model = await this.adb.modelOf(place, phone.endpoint);
        return { kind: "connected", endpoint: phone.endpoint, model };
      });
    } catch (error) {
      this.logger.error(`adb didn't connect again to the device ${phone.id}.`, error);
      return { kind: "unanswered" };
    }
  }

  /** The phone was disconnected: adb forgets its serial, best effort. */
  async disconnected(phone: PairedPhone): Promise<void> {
    await this.disconnectIn(this.placeOf(phone), phone.endpoint);
  }

  /** adb forgets the serial where it runs, best effort. */
  async disconnectIn(place: AdbPlace, endpoint: string): Promise<void> {
    await this.adb.disconnect(place, endpoint).catch((error: unknown) => {
      this.logger.warn(`adb disconnect ${endpoint} in ${place.label} failed.`, error);
    });
  }

  private placeOf(phone: PhoneOfTask): AdbPlace {
    return this.adb.inTask(phone.taskId, phone.projectId);
  }

  /** adb is there and the Project's key written: nothing, or how it ended instead. */
  private async adbReady(place: AdbPlace): Promise<WirelessEnd | undefined> {
    const check = await this.adb.ensureAdb(place);
    if (check === "missing") return { kind: "failed", problem: ADB_MISSING };
    if (check === "not-running") return { kind: "not-running" };
    const problem = await this.adb.writeKey(place);
    return problem === undefined ? undefined : { kind: "failed", problem };
  }

  /** The work's end, or `late` once `ms` have passed; the steps left stop at their own timeouts. */
  private async within(
    ms: number,
    late: WirelessEnd,
    work: () => Promise<WirelessEnd>,
  ): Promise<WirelessEnd> {
    const settles: { timedOut?: (end: WirelessEnd) => void } = {};
    const timeout = new Promise<WirelessEnd>((resolve) => {
      settles.timedOut = resolve;
    });
    const wait = this.schedule.once(
      "wireless-device-timeout",
      new Date(this.schedule.now().getTime() + ms),
      () => {
        settles.timedOut?.(late);
        return Promise.resolve();
      },
    );
    try {
      return await Promise.race([work(), timeout]);
    } finally {
      wait.cancel();
    }
  }
}

function stoppedWhilePairing(): WirelessEnd {
  return { kind: "failed", problem: STOPPED_WHILE_PAIRING };
}
