import { Injectable, Logger } from "@nestjs/common";

/** One of a Project's devices in the user's words, never its address or Port (spec §2.13). */
export interface ProjectDeviceLine {
  readonly id: string;
  /** For example "Android phone over wireless debugging". */
  readonly kind: string;
  /** The user's name for it. */
  readonly name: string;
  /** For example "Paired", "Didn't answer", "Not paired", "Over USB" or "In use by <holder>". */
  readonly state: string;
}

export type ProjectDeviceLister = (projectId: string) => Promise<readonly ProjectDeviceLine[]>;

/**
 * A Project's devices, which the Devices module registers a lister for as it starts, so the
 * Project's record (`list_projects`) names them without Projects calling Devices.
 */
@Injectable()
export class ProjectDeviceLines {
  private readonly logger = new Logger(ProjectDeviceLines.name);
  private readonly listers: ProjectDeviceLister[] = [];

  register(lister: ProjectDeviceLister): void {
    this.listers.push(lister);
  }

  /** Every registered lister's devices; a lister that throws is logged and left out. */
  async of(projectId: string): Promise<readonly ProjectDeviceLine[]> {
    const lists = await Promise.all(
      this.listers.map(async (lister) => {
        try {
          return await lister(projectId);
        } catch (error) {
          this.logger.error(
            `Listing the devices of the Project ${projectId} failed: ${
              error instanceof Error ? error.message : String(error)
            }`,
          );
          return [];
        }
      }),
    );
    return lists.flat();
  }
}
