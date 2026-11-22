import { Injectable } from "@nestjs/common";
import { join } from "node:path";
import { OfficeDataDirectory } from "../../../platform/office-data/office-data-directory.js";
import { instanceIdOf } from "../domain/run-environment.js";

/** Where run environments keep their files in the Office data directory, and which Office this is. */
@Injectable()
export class RunEnvironmentFolders {
  readonly instance: string;
  /**
   * The Office device helper's files, copied from the release (`DeviceHelperFiles`) and mounted
   * read-only in every Task's run environment; outside `run-environments/`, as spec §5.5 names it.
   */
  readonly deviceHelper: string;
  private readonly root: string;

  constructor(officeData: OfficeDataDirectory) {
    this.instance = instanceIdOf(officeData.path);
    this.deviceHelper = officeData.folder("device-helper");
    this.root = officeData.folder("run-environments");
  }

  /** Each Task's files: the compose file The Office puts over the repository's. */
  get tasks(): string {
    return join(this.root, "tasks");
  }

  taskFolder(taskId: string): string {
    return join(this.tasks, taskId);
  }

  /** Where an attached program's standard error goes unless its caller names a file. */
  attachedLog(taskId: string): string {
    return join(this.taskFolder(taskId), "attached.log");
  }

  /** Each Hosted Test instance's files: the compose file The Office puts over its checkout's. */
  get testInstances(): string {
    return join(this.root, "test-instances");
  }

  testInstanceFolder(testInstanceId: string): string {
    return join(this.testInstances, testInstanceId);
  }

  /** Each pairing environment's files: the compose file The Office puts over the definition's. */
  get pairings(): string {
    return join(this.root, "pairings");
  }

  pairingFolder(deviceId: string): string {
    return join(this.pairings, deviceId);
  }

  /** Where a Project command's output goes while it runs, read back once it ends. */
  get commandOutputs(): string {
    return join(this.root, "command-outputs");
  }

  /** The build context of an image while it is built. */
  imageBuildFolder(image: string): string {
    return join(this.root, "image-builds", image.replace(/[^a-zA-Z0-9_.-]/g, "_"));
  }

  get imageBuilds(): string {
    return join(this.root, "image-builds");
  }
}
