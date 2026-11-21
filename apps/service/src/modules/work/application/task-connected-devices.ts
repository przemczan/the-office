import { Injectable, Logger } from "@nestjs/common";

/** One of a Task's Connected devices that isn't Disconnected, in the user's words. */
export interface TaskConnectedDevice {
  /** For example "Android phone over USB". */
  readonly kind: string;
  /** As the device reports it. */
  readonly name: string;
  /** For example "Connected", "Waiting for the run environment" or "Connecting". */
  readonly state: string;
  /** Whether commands reach it now (state Connected). */
  readonly connected: boolean;
  /** For example "127.0.0.1:41234" while Connected. */
  readonly endpoint: string | null;
  /** More about it in short words, each after a "; ": "115200 baud", "round trip 40 ms". */
  readonly details?: readonly string[];
}

export type TaskConnectedDevicesLister = (
  taskId: string,
) => Promise<readonly TaskConnectedDevice[]>;

/**
 * One device as a line: "<kind> «<name>»: <state>", with ", at <endpoint>" when it has one, then
 * each detail after a "; ".
 */
export function connectedDeviceLine(device: TaskConnectedDevice): string {
  const line = `${device.kind} «${device.name}»: ${device.state}`;
  const placed = device.endpoint === null ? line : `${line}, at ${device.endpoint}`;
  return [placed, ...(device.details ?? [])].join("; ");
}

/**
 * The Task's Connected devices, which the Devices module registers a lister for as it starts, so
 * Work's records and Pipelines' Briefs name them without calling Devices.
 */
@Injectable()
export class TaskConnectedDevices {
  private readonly logger = new Logger(TaskConnectedDevices.name);
  private readonly listers: TaskConnectedDevicesLister[] = [];

  register(lister: TaskConnectedDevicesLister): void {
    this.listers.push(lister);
  }

  /** Every registered lister's devices; a lister that throws is logged and left out. */
  async of(taskId: string): Promise<readonly TaskConnectedDevice[]> {
    const lists = await Promise.all(
      this.listers.map(async (lister) => {
        try {
          return await lister(taskId);
        } catch (error) {
          this.logger.error(
            `Listing the Connected devices of the Task ${taskId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [];
        }
      }),
    );
    return lists.flat();
  }

  async linesOf(taskId: string): Promise<readonly string[]> {
    return (await this.of(taskId)).map(connectedDeviceLine);
  }
}
