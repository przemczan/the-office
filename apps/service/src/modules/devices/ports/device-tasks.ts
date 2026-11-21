/** A Task as connecting a device to it weighs it. */
export interface DeviceTask {
  readonly id: string;
  readonly title: string;
  readonly projectId: string;
  /** Its state's key, such as "in-progress", "done" or "dropped". */
  readonly state: string;
}

/** Work's Tasks, read by id. */
export abstract class DeviceTasks {
  /** The Task, archived ones too; undefined when there is none. */
  abstract find(taskId: string): Promise<DeviceTask | undefined>;
}
